import type { ParkWeather } from '../contracts/weather.js';
import type { Database } from '../db/database.js';
import { reserveRequestWindow } from '../db/request-budget.js';
import { createBoundedTtlCache } from '../trip-planner/bounded-cache.js';
import { HOUR, upcomingWeatherTimes } from './clock.js';
import { type Coverage, type Point, parseFmiCoverage, pointKey } from './fmi-xml.js';

const MINUTE = 60_000;
const DAY = 24 * HOUR;
const DAILY_REQUEST_LIMIT = 9_000;
const PEAK_REQUEST_LIMIT = 250;
const MAX_WEATHER_BYTES = 512 * 1024;
const EARTH_RADIUS_METRES = 6_371_000;
const SEARCH_RADIUS_METRES = 30_000;
const radians = (degrees: number) => (degrees * Math.PI) / 180;
const degrees = (angle: number) => (angle * 180) / Math.PI;
const iso = (time: number) => new Date(time).toISOString();

const distance = (a: Point, b: Point) => {
  const h =
    Math.sin(radians(b.lat - a.lat) / 2) ** 2 +
    Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(radians(b.lon - a.lon) / 2) ** 2;
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.sqrt(Math.min(h, 1)));
};

const boundingBox = ({ lat, lon }: Point) => {
  const radius = SEARCH_RADIUS_METRES / EARTH_RADIUS_METRES;
  const latDelta = degrees(radius);
  const lonDelta = degrees(Math.asin(radius / Math.cos(radians(lat))));
  return [lon - lonDelta, lat - latDelta, lon + lonDelta, lat + latDelta].join(',');
};

const fetchCoverage = async (query: string, parameters: Record<string, string>) => {
  const url = new URL('https://opendata.fmi.fi/wfs');
  url.search = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    storedquery_id: query,
    ...parameters
  }).toString();
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(3_000) });
  if (!response.ok || !response.body) throw new Error('FMI request failed');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let xml = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_WEATHER_BYTES) {
      await reader.cancel();
      throw new Error('FMI response exceeds the weather size limit');
    }
    xml += decoder.decode(value, { stream: true });
  }
  return parseFmiCoverage(xml + decoder.decode());
};

type CachedCoverage = { coverage: Coverage[]; fetchedAt: number };

const createProductCache = (ttl: number, reserve: () => Promise<boolean>) => {
  const results = createBoundedTtlCache<CachedCoverage>({
    maxEntries: 512,
    maxBytes: 16 * 1024 * 1024,
    estimateBytes: ({ coverage }) =>
      coverage.reduce(
        (bytes, { stations, rows }) =>
          bytes +
          stations.length * 256 +
          rows.reduce((total, row) => total + 256 + row.values.size * 64, 0),
        0
      ),
    now: () => Date.now()
  });
  const backoff = createBoundedTtlCache<boolean>({ maxEntries: 512, now: () => Date.now() });
  const pending = new Map<string, Promise<CachedCoverage | undefined>>();
  return (key: string, load: () => Promise<Coverage[]>) => {
    const cached = results.get(key);
    if ((cached && Date.now() < cached.fetchedAt + ttl) || backoff.get(key)) {
      return Promise.resolve(cached);
    }

    const inFlight = pending.get(key);
    if (inFlight) return inFlight;
    if (pending.size >= 8) return Promise.resolve(cached);

    const next = (async () => {
      try {
        if (!(await reserve())) throw new Error('FMI request budget unavailable');
        const value = { coverage: await load(), fetchedAt: Date.now() };
        results.set(key, value, 3 * HOUR);
        return value;
      } catch {
        backoff.set(key, true, MINUTE);
        return results.get(key);
      } finally {
        pending.delete(key);
      }
    })();
    pending.set(key, next);
    return next;
  };
};

const observedMetrics = [
  ['temperature', 't2m', 30 * MINUTE],
  ['wind', 'ws_10min', 30 * MINUTE],
  ['precipitation', 'r_1h', 75 * MINUTE]
] as const;

const getWindDirection = (speed: number, degrees: number | undefined) =>
  speed > 0 && degrees !== undefined && degrees >= 0 && degrees <= 360 ? degrees : undefined;

type Observation = NonNullable<ParkWeather['observation']>;
type Slots = NonNullable<ParkWeather['forecast']>['slots'];

const observationAt = (data: CachedCoverage, point: Point, now: number) => {
  const candidates = new Map<string, { distanceMetres: number; observation: Observation }>();
  for (const { stations, rows } of data.coverage) {
    const nearby = new Map<string, Observation>();
    for (const station of stations) {
      const distanceMetres = distance(point, station);
      if (distanceMetres > SEARCH_RADIUS_METRES) continue;
      let candidate = candidates.get(station.id);
      if (!candidate) {
        const observation: Observation = {
          station: { ...station, distanceMetres: Math.round(distanceMetres) }
        };
        candidate = { distanceMetres, observation };
        candidates.set(station.id, candidate);
      }
      nearby.set(pointKey(station), candidate.observation);
    }
    for (const row of rows) {
      const observation = nearby.get(pointKey(row));
      if (!observation || row.time > now) continue;
      for (const [metric, field, lifetime] of observedMetrics) {
        const value = row.values.get(field);
        if (
          value !== undefined &&
          now < row.time + lifetime &&
          (metric === 'temperature' ||
            value >= 0 ||
            (metric === 'precipitation' && value === -1)) &&
          (!observation[metric] || observation[metric].time < iso(row.time))
        ) {
          const directionDegrees =
            metric === 'wind' ? getWindDirection(value, row.values.get('wd_10min')) : undefined;
          const feelsLikeTemperature =
            metric === 'temperature' ? row.values.get('feelslike') : undefined;
          observation[metric] = {
            value,
            time: iso(row.time),
            expiresAt: iso(row.time + lifetime),
            ...(directionDegrees !== undefined ? { directionDegrees } : {}),
            ...(feelsLikeTemperature !== undefined ? { feelsLikeTemperature } : {})
          };
        }
      }
    }
  }
  return [...candidates.values()]
    .sort((a, b) => a.distanceMetres - b.distanceMetres)
    .find(({ observation }) =>
      observedMetrics.some(([metric]) => observation[metric] !== undefined)
    )?.observation;
};

const forecastAt = (data: CachedCoverage, now: number) => {
  const times = upcomingWeatherTimes(now);
  for (const { rows, modelRunTime } of data.coverage) {
    const point = rows[0];
    if (modelRunTime === undefined || !point) continue;
    const slots: Slots = [];
    for (const time of times) {
      const row = rows.find(
        (candidate) => candidate.time === time && pointKey(candidate) === pointKey(point)
      );
      if (!row) continue;
      const temperature = row.values.get('temperature');
      const feelsLikeTemperature =
        temperature === undefined ? undefined : row.values.get('feelslike');
      const wind = row.values.get('windspeedms');
      const precipitation = row.values.get('precipitation1h');
      const windDirectionDegrees =
        wind === undefined ? undefined : getWindDirection(wind, row.values.get('winddirection'));
      const readings = {
        ...(temperature !== undefined ? { temperature } : {}),
        ...(feelsLikeTemperature !== undefined ? { feelsLikeTemperature } : {}),
        ...(wind !== undefined && wind >= 0 ? { wind } : {}),
        ...(windDirectionDegrees !== undefined ? { windDirectionDegrees } : {}),
        ...(precipitation !== undefined && precipitation >= 0 ? { precipitation } : {})
      };
      if (Object.keys(readings).length > 0) {
        const weatherSymbol = row.values.get('weathersymbol3');
        slots.push({
          time: iso(time),
          ...readings,
          ...(weatherSymbol !== undefined && Number.isInteger(weatherSymbol)
            ? { weatherSymbol }
            : {})
        });
      }
    }
    if (slots.length > 0) {
      return {
        point: { lat: point.lat, lon: point.lon },
        modelRunTime: iso(modelRunTime),
        expiresAt: iso(data.fetchedAt + 3 * HOUR),
        slots
      };
    }
  }
  return undefined;
};

export const createWeatherReader = (database: Database) => {
  const reserveAttempt = async () => {
    const now = Date.now();
    const peakWindow = Math.floor(now / (5 * MINUTE)) * 5 * MINUTE;
    const dayWindow = Math.floor(now / DAY) * DAY;

    return database.transaction(
      async (transaction) =>
        (await reserveRequestWindow(transaction, 'fmi:peak', peakWindow, 1, PEAK_REQUEST_LIMIT)) &&
        (await reserveRequestWindow(transaction, 'fmi:day', dayWindow, 1, DAILY_REQUEST_LIMIT))
    );
  };

  // libSQL permits a single local write transaction at a time. Only the
  // reservations are serialized; the two upstream products still load in parallel.
  let reservationQueue: Promise<unknown> = Promise.resolve();
  const reserve = () => {
    const reservation = reservationQueue.then(reserveAttempt, reserveAttempt);
    reservationQueue = reservation;
    return reservation;
  };

  const observations = createProductCache(10 * MINUTE, reserve);
  const forecasts = createProductCache(HOUR, reserve);

  return async (point: Point): Promise<ParkWeather> => {
    const now = Date.now();
    const hour = Math.floor(now / HOUR) * HOUR;
    const key = pointKey(point);
    const [observationData, forecastData] = await Promise.all([
      observations(key, () =>
        fetchCoverage('fmi::observations::weather::multipointcoverage', {
          bbox: boundingBox(point),
          starttime: iso(now - 90 * MINUTE),
          endtime: iso(now),
          parameters: 't2m,ws_10min,wd_10min,r_1h,FeelsLike'
        })
      ),
      forecasts(key, () =>
        fetchCoverage('fmi::forecast::harmonie::surface::point::multipointcoverage', {
          latlon: key,
          starttime: iso(hour),
          endtime: iso(hour + 16 * HOUR),
          timestep: '60',
          parameters:
            'Temperature,FeelsLike,WindSpeedMS,WindDirection,Precipitation1h,WeatherSymbol3'
        })
      )
    ]);

    const servedAt = Date.now();
    const observation = observationData && observationAt(observationData, point, servedAt);
    const forecast = forecastData && forecastAt(forecastData, servedAt);
    return {
      ...(observation ? { observation } : {}),
      ...(forecast ? { forecast } : {})
    };
  };
};
