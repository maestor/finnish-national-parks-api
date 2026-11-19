import { eq } from 'drizzle-orm';
import { afterEach, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import type { ParkWeather } from '../../src/contracts/weather.js';
import { parks, tripPlannerBudgetWindows } from '../../src/db/schema.js';
import { createSessionToken } from '../../src/http/session.js';
import { upcomingWeatherTimes } from '../../src/weather/clock.js';
import { createWeatherReader } from '../../src/weather/park-weather.js';
import { createLipasPark } from '../fixtures/lipas.js';
import { importPublishedParkFixtures } from '../helpers/import-published-park-fixtures.js';
import { createTestDatabase } from '../helpers/test-db.js';

const auth = {
  cookieName: '__session',
  frontendUrl: 'http://localhost:4300',
  jwtSecret: 'weather-test-jwt-secret-at-least-32-characters'
};
const empty = '<wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0"/>';
const fmiException = '<ows:ExceptionReport xmlns:ows="http://www.opengis.net/ows/1.1"/>';
const xml = (
  body: string
) => `<wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0" xmlns:gml="http://www.opengis.net/gml/3.2" xmlns:gmlcov="http://www.opengis.net/gmlcov/1.0" xmlns:swe="http://www.opengis.net/swe/2.0" xmlns:om="http://www.opengis.net/om/2.0" xmlns:target="http://xml.fmi.fi/namespace/om/atmosphericfeatures/1.1" xmlns:xlink="http://www.w3.org/1999/xlink">
<wfs:member>${body}</wfs:member></wfs:FeatureCollection>`;
const epoch = (time: string) => Date.parse(`2026-11-19T${time}:00Z`) / 1000;
const coverage = (fields: string[], positions: string, tuples: string) => `
<gmlcov:MultiPointCoverage>
<gmlcov:positions>${positions}</gmlcov:positions>
<gml:doubleOrNilReasonTupleList>${tuples}</gml:doubleOrNilReasonTupleList>
${fields.map((field) => `<swe:field name="${field}"/>`).join('')}
</gmlcov:MultiPointCoverage>`;
const station = (id: number, name: string, point: string) => `
<target:Location><gml:identifier codeSpace="http://xml.fmi.fi/namespace/stationcode/fmisid">${id}</gml:identifier>
<gml:name codeSpace="http://xml.fmi.fi/namespace/locationcode/name">${name}</gml:name>
<target:representativePoint xlink:href="#point-${id}"/></target:Location>
<gml:Point gml:id="point-${id}"><gml:pos>${point}</gml:pos></gml:Point>`;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('serves independently expiring weather only for visible parks', async () => {
  const db = await createTestDatabase();
  try {
    await importPublishedParkFixtures({
      database: db.database,
      expectedActiveCount: 1,
      now: () => '2026-11-19T06:30:00Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({ items: [createLipasPark()] })
    });
    await db.database.update(parks).set({ markerLat: 69.0386896, markerLon: 20.8452485 });
    const park = await db.database.query.parks.findFirst();
    const path = `/api/parks/${park?.slug}/weather`;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-19T06:30:00Z'));
    const near = '69.04277 20.85091';
    const far = '69.03905 20.81379';
    const observation = xml(
      station(102017, 'Enontekiö Kilpisjärvi Saana', near) +
        station(102016, 'Enontekiö Kilpisjärvi kyläkeskus', far) +
        station(102018, 'Puutteellinen piste', '69.1') +
        '<target:Location><gml:identifier>123</gml:identifier></target:Location>' +
        coverage(
          ['r_1h', 't2m', 'ws_10min', 'wd_10min', 'FeelsLike'],
          `${far} ${epoch('06:30')} ${near} ${epoch('06:00')} ${near} ${epoch('06:20')} ${near} ${epoch('06:30')} ${near} ${epoch('06:10')} ${near} ${epoch('06:40')} 99 123 ${epoch('06:30')}`,
          '1.2 -3.5 0.8 45 -4.1 -1 NaN NaN NaN NaN NaN NaN 1.3 315 -7 NaN -5.8 NaN 180 -6.2 -99 -9.1 -99 90 -10 NaN NaN NaN NaN NaN 5 5 5 0 1'
        ) +
        '<gmlcov:MultiPointCoverage/>'
    );
    const forecast = xml(
      `<om:resultTime><gml:timePosition>2026-11-19T06:05:00Z</gml:timePosition></om:resultTime>
      <om:parameter><om:NamedValue><om:name xlink:href="http://xml.fmi.fi/inspire/process/harmonie_scandinavia_surface"/>
      <om:value><gml:timePosition>2026-11-19T03:00:00Z</gml:timePosition></om:value></om:NamedValue></om:parameter>
      <gmlcov:MultiPointCoverage/>` +
        coverage(
          ['Precipitation1h', 'WindSpeedMS', 'Temperature'],
          `69.03869 20.84525 ${epoch('07:00')}`,
          '-99 -99 NaN'
        ) +
        coverage(
          [
            'Precipitation1h',
            'WindSpeedMS',
            'Temperature',
            'WindDirection',
            'WeatherSymbol3',
            'FeelsLike'
          ],
          `69.03869 20.84525 ${epoch('07:00')} 69.03869 20.84525 ${epoch('10:00')} 69.03869 20.84525 ${epoch('13:00')}`,
          '0 1.94 -3.4 90 31 0 NaN 2.5 -4.4 999 2.5 NaN 0 NaN NaN 45 NaN -9.3'
        )
    );
    let mode = 'valid';
    const fetcher = vi.fn(async (url: URL) => {
      if (mode === 'failure') return new Response(fmiException);
      if (mode === 'empty') return new Response(empty);
      return new Response(url.searchParams.has('bbox') ? observation : forecast);
    });
    vi.stubGlobal('fetch', fetcher);
    const apiKey = 'weather-test-api-key';
    const app = createApp({ apiKey, auth, database: db.database });
    const headers = { authorization: `Bearer ${apiKey}` };
    const requestWeather = () => app.request(path, { headers });
    expect((await app.request(path)).status).toBe(401);
    const [response, concurrent] = await Promise.all([requestWeather(), requestWeather()]);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const weather = await response.json();
    expect(await concurrent.json()).toEqual(weather);
    expect(weather).toMatchObject({
      observation: {
        station: { id: '102017', name: 'Enontekiö Kilpisjärvi Saana', distanceMetres: 507 },
        temperature: { value: -5.8, time: '2026-11-19T06:30:00.000Z', feelsLikeTemperature: -6.2 },
        wind: { value: 1.3, time: '2026-11-19T06:20:00.000Z', directionDegrees: 315 },
        precipitation: { value: -1, time: '2026-11-19T06:00:00.000Z' }
      },
      forecast: {
        modelRunTime: '2026-11-19T03:00:00.000Z',
        point: { lat: 69.03869, lon: 20.84525 },
        slots: [
          {
            time: '2026-11-19T07:00:00.000Z',
            temperature: -3.4,
            feelsLikeTemperature: 0,
            wind: 1.94,
            windDirectionDegrees: 90,
            weatherSymbol: 31,
            precipitation: 0
          },
          { time: '2026-11-19T10:00:00.000Z', temperature: -4.4, wind: 2.5 },
          { time: '2026-11-19T13:00:00.000Z', precipitation: 0 }
        ]
      }
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect((weather as ParkWeather).forecast?.slots[1]).not.toHaveProperty('windDirectionDegrees');
    expect((weather as ParkWeather).forecast?.slots[2]).not.toHaveProperty('windDirectionDegrees');
    expect((weather as ParkWeather).forecast?.slots[1]).not.toHaveProperty('weatherSymbol');
    expect((weather as ParkWeather).forecast?.slots[2]).not.toHaveProperty('weatherSymbol');
    expect((weather as ParkWeather).forecast?.slots[1]).not.toHaveProperty('feelsLikeTemperature');
    expect((weather as ParkWeather).forecast?.slots[2]).not.toHaveProperty('feelsLikeTemperature');
    mode = 'failure';
    clock.mockReturnValue(Date.parse('2026-11-19T07:00:00Z'));
    const later = (await (await requestWeather()).json()) as ParkWeather;
    expect(later.observation).not.toHaveProperty('wind');
    expect(later.forecast?.slots).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(3);
    await requestWeather();
    expect(fetcher).toHaveBeenCalledTimes(3);

    mode = 'empty';
    clock.mockReturnValue(Date.parse('2026-11-19T11:00:00Z'));
    expect(await (await requestWeather()).json()).toEqual({});
    await db.database.update(parks).set({ removed: true });
    expect((await requestWeather()).status).toBe(404);
    expect((await app.request('/api/parks/unknown/weather', { headers })).status).toBe(404);
    expect(fetcher).toHaveBeenCalledTimes(5);

    const token = await createSessionToken(
      { email: 'admin@example.test', name: 'Admin', picture: '', role: 'admin', sub: 'admin' },
      new TextEncoder().encode(auth.jwtSecret)
    );
    const privateResponse = await app.request(path, {
      headers: { ...headers, cookie: `__session=${token}` }
    });
    expect(privateResponse.status).toBe(200);
    expect(privateResponse.headers.get('cache-control')).toBe('private, no-store');
    expect(await privateResponse.json()).toEqual({});
  } finally {
    await db.dispose();
  }
});

it.each([
  ['2026-11-19T06:30:00Z', ['07:00', '10:00', '13:00', '16:00']],
  ['2026-11-19T07:00:00Z', ['10:00', '13:00', '16:00', '19:00']],
  ['2026-11-19T21:59:00Z', ['22:00', '01:00', '04:00', '07:00']],
  ['2026-03-28T22:00:00Z', ['03:00', '06:00', '09:00', '12:00']],
  ['2026-10-25T00:00:00Z', ['04:00', '07:00', '10:00', '13:00']],
  ['2026-10-24T21:00:00Z', ['00:00', '04:00', '07:00', '10:00']]
])('selects four distinct future Helsinki clock markers after %s', (requestTime, expected) => {
  const now = Date.parse(requestTime);
  const times = upcomingWeatherTimes(now);
  expect(times.every((time) => time > now)).toBe(true);
  expect(times.map((time) => new Date(time).toISOString().slice(11, 16))).toEqual(expected);
  expect(times.every((time, index) => index === 0 || time > times[index - 1]!)).toBe(true);
});

it('keeps the usable product when FMI returns a partial result, without borrowing rain from another station', async () => {
  const db = await createTestDatabase();
  try {
    await importPublishedParkFixtures({
      database: db.database,
      expectedActiveCount: 2,
      now: () => '2026-11-19T06:30:00Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark({ name: 'Rosalan Viikinkikeskus' }),
          createLipasPark({ 'lipas-id': 98765, name: 'Ruotsinkylän tutkimusmetsä' })
        ]
      })
    });
    const [rosala, ruotsinkyla] = await db.database.query.parks.findMany({
      orderBy: (table, { asc }) => [asc(table.slug)]
    });
    await db.database
      .update(parks)
      .set({ markerLat: 59.8522174, markerLon: 22.4158092 })
      .where(eq(parks.id, rosala!.id));
    await db.database
      .update(parks)
      .set({ markerLat: 60.361854, markerLon: 24.988811 })
      .where(eq(parks.id, ruotsinkyla!.id));

    const vano = '59.86949 22.19343';
    const rus = '59.77363 22.94868';
    const observation = xml(
      station(100932, 'Hanko Russarö', rus) +
        station(100945, 'Kemiönsaari Vänö', vano) +
        coverage(
          ['t2m', 'ws_10min', 'r_1h'],
          `${rus} ${epoch('06:30')} ${vano} ${epoch('06:00')} ${vano} ${epoch('06:30')}`,
          '5 7 1.8 NaN NaN 0 4.6 8.7 NaN'
        )
    );
    const forecast = xml(
      '<om:parameter><om:NamedValue><om:name xlink:href="http://xml.fmi.fi/inspire/process/harmonie_scandinavia_surface"/><om:value><gml:timePosition>2026-11-19T03:00:00Z</gml:timePosition></om:value></om:NamedValue></om:parameter>' +
        coverage(
          ['Temperature', 'WindSpeedMS', 'Precipitation1h'],
          `60.36185 24.98881 ${epoch('07:00')}`,
          '3.5 5.08 0.8'
        )
    );
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-19T06:30:00Z'));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL) => {
        if (url.searchParams.get('latlon') === '60.361854,24.988811') return new Response(forecast);
        const bbox = url.searchParams.get('bbox');
        if (bbox && Number(bbox.split(',')[1]) < 60) return new Response(observation);
        return new Response('', { status: 503 });
      })
    );
    const app = createApp({ database: db.database });

    const rosalaWeather = await (await app.request(`/api/parks/${rosala?.slug}/weather`)).json();
    expect(rosalaWeather).toMatchObject({
      observation: {
        station: { id: '100945', name: 'Kemiönsaari Vänö', distanceMetres: 12563 },
        temperature: { value: 4.6 },
        wind: { value: 8.7 },
        precipitation: { value: 0 }
      }
    });
    expect(rosalaWeather).not.toHaveProperty('forecast');

    const ruotsinkylaWeather = await (
      await app.request(`/api/parks/${ruotsinkyla?.slug}/weather`)
    ).json();
    expect(ruotsinkylaWeather).toMatchObject({
      forecast: {
        slots: [
          { time: '2026-11-19T07:00:00.000Z', temperature: 3.5, wind: 5.08, precipitation: 0.8 }
        ]
      }
    });
    expect(ruotsinkylaWeather).not.toHaveProperty('observation');
  } finally {
    await db.dispose();
  }
});

it.each(['daily limit', 'five-minute limit'])(
  'skips new FMI calls once the shared %s is reached',
  async (limit) => {
    const db = await createTestDatabase();
    try {
      const now = Date.parse('2026-11-19T06:30:00Z');
      vi.spyOn(Date, 'now').mockReturnValue(now);
      await db.database.insert(tripPlannerBudgetWindows).values(
        limit === 'daily limit'
          ? {
              key: 'fmi:day',
              requestCount: 9000,
              windowStartedAt: Date.parse('2026-11-19T00:00Z')
            }
          : { key: 'fmi:peak', requestCount: 250, windowStartedAt: now }
      );
      const fetcher = vi.fn();
      vi.stubGlobal('fetch', fetcher);
      expect(await createWeatherReader(db.database)({ lat: 69, lon: 20 })).toEqual({});
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      await db.dispose();
    }
  }
);

it('bounds concurrent cold lookups and discards invalid or oversized provider responses', async () => {
  const db = await createTestDatabase();
  try {
    let finish: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const fetcher = vi.fn(async (url: URL) => {
      await pending;
      if (url.searchParams.has('bbox')) {
        return new Response(
          xml(coverage(['t2m'], '69 20 1795068000', '3.3')).padEnd(513 * 1024, ' ')
        );
      }
      if (url.searchParams.get('latlon') === '69,20') {
        return new Response(xml(coverage(['Temperature'], '69 20 1795068000', '3.3 5.0')));
      }
      return new Response(`<!DOCTYPE FeatureCollection>${empty}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const readWeather = createWeatherReader(db.database);
    const simultaneous = Array.from({ length: 8 }, (_, index) =>
      readWeather({ lat: 69, lon: 20 + index / 10 })
    );
    try {
      expect(await readWeather({ lat: 69, lon: 21 })).toEqual({});
    } finally {
      finish();
    }
    expect(await Promise.all(simultaneous)).toEqual(Array.from({ length: 8 }, () => ({})));
    expect(fetcher).toHaveBeenCalledTimes(16);
  } finally {
    await db.dispose();
  }
});
