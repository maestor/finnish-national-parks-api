import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import {
  adminHomeFeaturedVisitResponseSchema,
  publicHomeSummaryResponseSchema
} from '../../src/contracts/parks.js';
import { createTripStopImage, createVisitImage } from '../../src/db/repositories.js';
import { parkVisits, trips } from '../../src/db/schema.js';
import { createSessionToken } from '../../src/http/session.js';
import { importParks } from '../../src/importer/import-parks.js';
import { createMemoryStorage } from '../../src/storage/memory-storage.js';
import { createLipasPark, parkTypeFixtures } from '../fixtures/lipas.js';
import { createTestDatabase } from '../helpers/test-db.js';

const auth = {
  cookieName: '__session',
  frontendUrl: 'http://localhost:4300',
  googleClientId: 'test-client',
  googleClientSecret: 'test-secret',
  jwtSecret: 'test-jwt-secret-at-least-32-characters-long'
};

// Scenario inventory: HTTP selection/publication, media lifecycle, catalog/magnet
// changes and conditional validators live here; archive tests cover shared excerpts
// and covers; resource-baseline protects response size and conditional SQL work.
describe('home memories API', () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: ReturnType<typeof createApp>;
  let cookie: string;
  const publicMediaUrl = vi.fn(
    async (key: string) => `https://api.example.test/assets/media/${key}`
  );
  beforeEach(async () => {
    publicMediaUrl.mockClear();
    db = await createTestDatabase();
    cookie = `__session=${await createSessionToken({ email: 'admin@example.com', name: 'Admin', picture: '', role: 'admin', sub: 'admin' }, new TextEncoder().encode(auth.jwtSecret))}`;
    await importParks({
      database: db.database,
      expectedActiveCount: 1,
      now: () => '2026-05-01T09:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({ items: [createLipasPark()] })
    });
    app = createApp({
      auth,
      database: db.database,
      storage: createMemoryStorage(),
      getPublicMediaUrl: publicMediaUrl
    });
  });
  afterEach(async () => {
    await db.dispose();
  });
  const write = async (path: string, body: object, method = 'POST') => {
    const response = await app.request(path, {
      method,
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const text = await response.text();
    expect(response.status, text).toBeLessThan(300);
    return (text ? JSON.parse(text) : {}) as { id: number; slug: string };
  };
  const visit = (body: object) =>
    write('/api/parks/akasmannyn-kansallispuisto/visits', { status: 'published', ...body });

  it('features only visible parks with at least two published visits and keeps unavailable selections clearable', async () => {
    const path = '/api/admin/home-featured-park';
    const slug = 'akasmannyn-kansallispuisto';
    expect(await (await app.request(path, { headers: { cookie } })).json()).toEqual({
      parkSlug: null,
      candidates: []
    });
    const first = await visit({ visitedOn: '2026-06-01' });
    const second = await visit({ visitedOn: '2026-07-01', status: 'draft' });
    const select = (parkSlug: string | null) => write(path, { parkSlug }, 'PATCH');
    const candidates = async () => await (await app.request(path, { headers: { cookie } })).json();
    expect(await candidates()).toHaveProperty('candidates', []);
    await write(`/api/visits/${second.id}`, { status: 'published' }, 'PATCH');
    expect(await candidates()).toMatchObject({ candidates: [{ slug, visitCount: 2 }] });
    await write(
      `/api/parks/${slug}`,
      { description: '# Otsikko\n\nTuttu metsä.', establishmentYear: 1990, areaKm2: 12 },
      'PATCH'
    );
    const cover = await image(first.id, 'park-cover');
    await write(
      `/api/admin/parks/${slug}/featured-image`,
      { featuredImage: { imageId: cover.id, source: 'visit-image' } },
      'PATCH'
    );
    const before = await summary();
    await select(slug);
    const selected = await summary();
    expect(selected.etag).not.toBe(before.etag);
    expect(selected.body).toHaveProperty(
      'featuredPark',
      expect.objectContaining({
        slug,
        descriptionExcerpt: 'Tuttu metsä.',
        visitCount: 2,
        establishmentYear: 1990,
        areaKm2: 12,
        featuredImage: expect.objectContaining({ width: 1200, height: 800 })
      })
    );
    const extra = await visit({ visitedOn: '2026-09-01' });
    expect((await summary()).body).toHaveProperty('featuredPark.visitCount', 3);
    await write(`/api/visits/${extra.id}`, { status: 'draft' }, 'PATCH');
    expect((await summary()).body).toHaveProperty('featuredPark.visitCount', 2);
    const unavailableMedia = createApp({
      auth,
      database: db.database,
      getPublicMediaUrl: async () => ''
    });
    expect(await (await unavailableMedia.request('/api/home-summary')).json()).toHaveProperty(
      'featuredPark.featuredImage',
      null
    );
    await write(`/api/visits/${second.id}`, { status: 'draft' }, 'PATCH');
    expect((await summary()).body).toHaveProperty('featuredPark', null);
    expect(await candidates()).toEqual({ parkSlug: slug, candidates: [] });
    await write(`/api/visits/${second.id}`, { status: 'published' }, 'PATCH');
    await write(`/api/parks/${slug}/removed`, { removed: true }, 'PATCH');
    expect((await summary()).body).toHaveProperty('featuredPark', null);
    await write(`/api/parks/${slug}/removed`, { removed: false }, 'PATCH');
    await write(`/api/visits/${first.id}`, { status: 'draft' }, 'PATCH');
    await visit({ visitedOn: '2026-08-01' });
    expect((await summary()).body).toHaveProperty(
      'featuredPark',
      expect.objectContaining({ featuredImage: null })
    );
    await select(null);
    expect((await summary()).body).toHaveProperty('featuredPark', null);
    await select(slug);
    await write(`/api/parks/${slug}`, { description: null }, 'PATCH');
    expect((await summary()).body).toHaveProperty(
      'featuredPark',
      expect.objectContaining({ descriptionExcerpt: null })
    );
    await db.client.execute('DELETE FROM park_visits');
    await db.client.execute("DELETE FROM parks WHERE slug = 'akasmannyn-kansallispuisto'");
    expect(await candidates()).toEqual({ parkSlug: null, candidates: [] });
    expect((await summary()).body).toHaveProperty('featuredPark', null);
  });

  it('protects featured parks and rejects malformed, missing, single-visit and hidden parks', async () => {
    const path = '/api/admin/home-featured-park';
    const patch = (body: object, headers: Record<string, string> = { cookie }) =>
      app.request(path, {
        method: 'PATCH',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
    for (const method of ['GET', 'PATCH']) {
      const options = {
        method,
        headers: { 'content-type': 'application/json' },
        ...(method === 'PATCH' ? { body: JSON.stringify({ parkSlug: null }) } : {})
      };
      expect((await app.request(path, options)).status).toBe(401);
      expect((await createApp({ database: db.database }).request(path, options)).status).toBe(503);
    }
    for (const body of [{}, { parkSlug: 1 }, { parkSlug: '' }])
      expect((await patch(body)).status).toBe(400);
    expect((await patch({ parkSlug: 'missing' })).status).toBe(422);
    await visit({ visitedOn: '2026-06-01' });
    expect((await patch({ parkSlug: 'akasmannyn-kansallispuisto' })).status).toBe(422);
    await visit({ visitedOn: '2026-07-01' });
    await write('/api/parks/akasmannyn-kansallispuisto/removed', { removed: true }, 'PATCH');
    expect((await patch({ parkSlug: 'akasmannyn-kansallispuisto' })).status).toBe(422);
  });

  it('lets admins select, replace and clear a public visit with fresh home validators', async () => {
    const path = '/api/admin/home-featured-visit';
    const initial = await summary();
    expect(initial.body).toHaveProperty('featuredVisit', null);
    const empty = await app.request(path, { headers: { cookie } });
    expect(await empty.json()).toEqual({ visitId: null, candidates: [] });
    expect(empty.headers.get('cache-control')).toBe('private, no-store');
    const trip = await write('/api/trips', { name: 'Salainen retki', status: 'draft' });
    const record = await visit({
      visitedOn: '2026-06-01',
      tripId: trip.id,
      note: 'Muisto',
      route: 'Rantapolku, 4 km'
    });
    const other = await visit({ visitedOn: '2026-07-01' });
    await visit({ visitedOn: '2026-08-01', status: 'draft' });
    await image(record.id, 'cover');
    const before = await summary();
    const candidates = adminHomeFeaturedVisitResponseSchema.parse(
      await (await app.request(path, { headers: { cookie } })).json()
    );
    expect(candidates).toMatchObject({
      visitId: null,
      candidates: [{ id: other.id }, { id: record.id }]
    });
    expect(candidates.candidates).toHaveLength(2);
    await write(path, { visitId: record.id }, 'PATCH');
    const selected = await summary();
    expect(selected.etag).not.toBe(before.etag);
    expect(selected.body.featuredVisit).toMatchObject({
      id: record.id,
      route: 'Rantapolku, 4 km',
      descriptionExcerpt: 'Muisto',
      imageCount: 1,
      featuredImage: { width: 1200, height: 800 }
    });
    expect(JSON.stringify(selected.body.featuredVisit)).not.toContain('Salainen');
    expect(await (await app.request(path, { headers: { cookie } })).json()).toHaveProperty(
      'visitId',
      record.id
    );
    await write(`/api/visits/${record.id}`, { status: 'draft' }, 'PATCH');
    expect((await summary()).body.featuredVisit).toBeNull();
    await write(`/api/visits/${record.id}`, { status: 'published' }, 'PATCH');
    await write('/api/parks/akasmannyn-kansallispuisto/removed', { removed: true }, 'PATCH');
    expect((await summary()).body.featuredVisit).toBeNull();
    await write('/api/parks/akasmannyn-kansallispuisto/removed', { removed: false }, 'PATCH');
    await write(path, { visitId: other.id }, 'PATCH');
    expect((await summary()).body.featuredVisit).toMatchObject({
      id: other.id,
      route: null,
      featuredImage: null
    });
    await write(path, { visitId: null }, 'PATCH');
    const cleared = await summary();
    expect(cleared.body.featuredVisit).toBeNull();
    expect(cleared.etag).not.toBe(selected.etag);
    await write(path, { visitId: other.id }, 'PATCH');
    expect(
      (await app.request(`/api/visits/${other.id}`, { method: 'DELETE', headers: { cookie } }))
        .status
    ).toBe(204);
    expect((await summary()).body.featuredVisit).toBeNull();
    expect(await (await app.request(path, { headers: { cookie } })).json()).toHaveProperty(
      'visitId',
      null
    );
  });

  it('omits complete Markdown headings from visit previews while preserving the full note', async () => {
    const note =
      '# Käynnin otsikko\n\nRauhallinen päivä luonnossa.\n\n## Muistiinpanoja ##\n\nPolku jatkui järven rantaan. #muisto ja C# säilyvät.';
    const record = await visit({ visitedOn: '2026-09-12', note });
    await write('/api/admin/home-featured-visit', { visitId: record.id }, 'PATCH');
    const result = await summary();
    const excerpt =
      'Rauhallinen päivä luonnossa. Polku jatkui järven rantaan. #muisto ja C# säilyvät.';
    expect(result.body.featuredVisit?.descriptionExcerpt).toBe(excerpt);
    expect(result.body.latestStandaloneVisit?.descriptionExcerpt).toBe(excerpt);
    const detail = await (await app.request(`/api/visits/${record.id}`)).json();
    expect(detail).toHaveProperty('note', note);
  });

  it('rejects unauthorized, invalid and unavailable featured-visit selections', async () => {
    const path = '/api/admin/home-featured-visit';
    const draft = await visit({ visitedOn: '2026-06-01', status: 'draft' });
    for (const method of ['GET', 'PATCH']) {
      const options =
        method === 'PATCH'
          ? {
              body: JSON.stringify({ visitId: null }),
              headers: { 'content-type': 'application/json' }
            }
          : {};
      expect((await app.request(path, { ...options, method })).status).toBe(401);
      const unconfigured = createApp({ database: db.database });
      expect((await unconfigured.request(path, { ...options, method })).status).toBe(503);
    }
    for (const visitId of [draft.id, 99999]) {
      expect(
        (
          await app.request(path, {
            method: 'PATCH',
            headers: { cookie, 'content-type': 'application/json' },
            body: JSON.stringify({ visitId })
          })
        ).status
      ).toBe(422);
    }
    for (const body of [{}, { visitId: 0 }, { visitId: '1' }]) {
      expect(
        (
          await app.request(path, {
            method: 'PATCH',
            headers: { cookie, 'content-type': 'application/json' },
            body: JSON.stringify(body)
          })
        ).status
      ).toBe(400);
    }
    const record = await visit({ visitedOn: '2026-06-02' });
    await write('/api/parks/akasmannyn-kansallispuisto/removed', { removed: true }, 'PATCH');
    expect(
      (
        await app.request(path, {
          method: 'PATCH',
          headers: { cookie, 'content-type': 'application/json' },
          body: JSON.stringify({ visitId: record.id })
        })
      ).status
    ).toBe(422);
    expect((await summary()).body.featuredVisit).toBeNull();
  });

  it('selects by visit date and public trip association without returning legacy lists', async () => {
    const trip = await write('/api/trips', {
      name: 'Kesäretki',
      status: 'published',
      description: '  Retki\n luonnossa '
    });
    const draft = await write('/api/trips', { name: 'Salainen retki', status: 'draft' });
    await visit({ visitedOn: '2026-07-15', tripId: trip.id });
    const standalone = await visit({
      visitedOn: '2026-08-01',
      tripId: draft.id,
      route: 'Järvikierros, 6 km',
      note: '  Oma\n muisto '
    });
    await visit({ visitedOn: '2026-01-01' });
    await visit({ visitedOn: '2026-05-01' });
    await visit({ visitedOn: '2025-10-01' });
    await visit({ visitedOn: '2026-12-01', status: 'draft' });
    const response = await app.request('/api/home-summary');
    const raw = await response.json();
    const body = publicHomeSummaryResponseSchema.parse(raw);
    expect(raw).toEqual(body);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(body).toMatchObject({
      latestTrip: {
        id: trip.id,
        name: 'Kesäretki',
        dateRange: { start: '2026-07-15', end: '2026-07-15' },
        visitCount: 1,
        stopCount: 0,
        descriptionExcerpt: 'Retki luonnossa',
        featuredImage: null
      },
      latestStandaloneVisit: {
        id: standalone.id,
        park: { slug: 'akasmannyn-kansallispuisto' },
        visitedOn: '2026-08-01',
        route: 'Järvikierros, 6 km',
        descriptionExcerpt: 'Oma muisto',
        featuredImage: null,
        imageCount: 0
      },
      totalVisits: 5,
      seasonalVisitCounts: { autumn: 1, spring: 1, summer: 2, winter: 1 },
      uniqueVisitedParks: 1,
      magnetProgress: { visitedParks: 1, totalParks: 1 }
    });
    expect(Object.keys(body).sort()).toEqual(
      [
        'featuredVisit',
        'featuredPark',
        'latestTrip',
        'latestStandaloneVisit',
        'magnetProgress',
        'progressByCategory',
        'progressByType',
        'seasonalVisitCounts',
        'totalVisits',
        'uniqueVisitedParks',
        'updatedAt',
        'version'
      ].sort()
    );
    expect(JSON.stringify(body)).not.toContain('Salainen');
    expect(body.latestStandaloneVisit).not.toHaveProperty('tripId');
  });
  const summary = async () => {
    const response = await app.request('/api/home-summary');
    expect(response.status).toBe(200);
    const raw = await response.json();
    const body = publicHomeSummaryResponseSchema.parse(raw);
    expect(raw).toEqual(body);
    return { body, etag: response.headers.get('etag')! };
  };
  const image = (visitId: number, name: string, displayOrder = 0, dimensions = true) =>
    createVisitImage(db.database, {
      visitId,
      createdAt: '2026-05-01T10:00:00.000Z',
      updatedAt: '2026-05-01T10:00:00.000Z',
      displayOrder,
      fullKey: `visits/${visitId}/${name}.jpg`,
      thumbKey: `visits/${visitId}/${name}-thumb.jpg`,
      mimeType: 'image/jpeg',
      fullWidth: dimensions ? 1200 : null,
      fullHeight: dimensions ? 800 : null
    });

  it('updates both selections and validators through publication, assignment and park visibility', async () => {
    const trip = await write('/api/trips', { name: 'Yksityinen', status: 'draft' });
    const older = await visit({ visitedOn: '2026-06-01' });
    const newer = await visit({ visitedOn: '2026-07-01', tripId: trip.id });
    const first = await summary();
    expect(first.body.latestStandaloneVisit?.id).toBe(newer.id);
    expect(first.body.latestTrip).toBeNull();
    await write(`/api/trips/${trip.id}`, { status: 'published' }, 'PATCH');
    const published = await summary();
    expect(published.etag).not.toBe(first.etag);
    expect(published.body.latestStandaloneVisit?.id).toBe(older.id);
    expect(published.body.latestTrip?.id).toBe(trip.id);
    await write(`/api/visits/${older.id}`, { tripId: trip.id }, 'PATCH');
    expect((await summary()).body.latestStandaloneVisit).toBeNull();
    await write(`/api/trips/${trip.id}`, { status: 'draft' }, 'PATCH');
    expect((await summary()).body.latestStandaloneVisit?.id).toBe(newer.id);
    await write(`/api/visits/${newer.id}`, { status: 'draft' }, 'PATCH');
    expect((await summary()).body.latestStandaloneVisit?.id).toBe(older.id);
    await write('/api/parks/akasmannyn-kansallispuisto/removed', { removed: true }, 'PATCH');
    const hidden = await summary();
    expect(hidden.body).toMatchObject({
      latestTrip: null,
      latestStandaloneVisit: null,
      totalVisits: 0,
      uniqueVisitedParks: 0,
      magnetProgress: { totalParks: 0, visitedParks: 0 },
      progressByType: [],
      progressByCategory: []
    });
  });

  it('uses deterministic visit ties and dated-first trip ordering including stops and undated records', async () => {
    const first = await visit({ visitedOn: '2026-06-01' });
    const second = await visit({ visitedOn: '2026-06-01' });
    await db.database.update(parkVisits).set({ createdAt: '2026-05-01T10:00:00.000Z' });
    expect((await summary()).body.latestStandaloneVisit?.id).toBe(second.id);
    await db.database
      .update(parkVisits)
      .set({ createdAt: '2026-05-02T10:00:00.000Z' })
      .where(eq(parkVisits.id, first.id));
    expect((await summary()).body.latestStandaloneVisit?.id).toBe(first.id);
    const older = await write('/api/trips', { name: 'Vanha', status: 'published' });
    const newer = await write('/api/trips', { name: 'Uusi', status: 'published' });
    await db.database.update(trips).set({ createdAt: '2026-05-01T10:00:00.000Z' });
    expect((await summary()).body.latestTrip).toMatchObject({
      id: newer.id,
      dateRange: null,
      visitCount: 0
    });
    await db.database
      .update(trips)
      .set({ createdAt: '2026-05-02T10:00:00.000Z' })
      .where(eq(trips.id, older.id));
    expect((await summary()).body.latestTrip?.id).toBe(older.id);
    await write(`/api/visits/${second.id}`, { tripId: newer.id }, 'PATCH');
    const last = await visit({ visitedOn: '2026-06-05', tripId: newer.id });
    const stop = await write(`/api/trips/${newer.id}/stops`, {
      location: { coordinate: { lat: 60, lon: 24 }, label: 'Helsinki' },
      tripStopOrder: 2,
      visitedOn: '2026-06-03'
    });
    await write(`/api/visits/${last.id}`, { status: 'draft' }, 'PATCH');
    const selected = (await summary()).body.latestTrip;
    expect(selected).toMatchObject({
      id: newer.id,
      dateRange: { start: '2026-06-01', end: '2026-06-03' },
      stopCount: 1,
      visitCount: 1
    });
    const archive = (await (await app.request('/api/trips/archive')).json()) as { trips: object[] };
    expect(archive.trips[0]).toMatchObject(selected!);
    await write(`/api/trip-stops/${stop.id}`, { visitedOn: '2026-06-02' }, 'PATCH');
    expect((await summary()).body.latestTrip?.dateRange).toEqual({
      start: '2026-06-01',
      end: '2026-06-02'
    });
    await visit({ visitedOn: '2026-06-01', tripId: older.id });
    await db.database.update(trips).set({ createdAt: '2026-05-01T10:00:00.000Z' });
    expect((await summary()).body.latestTrip?.id).toBe(newer.id);
  });

  it('selects ordered stable visit media and responds to reordering, deleting and note changes', async () => {
    const record = await visit({ visitedOn: '2026-06-01', note: '😀'.repeat(300) });
    const beforeMedia = await summary();
    const first = await image(record.id, 'first');
    const second = await image(record.id, 'second', 0, false);
    const initial = await summary();
    expect(initial.etag).not.toBe(beforeMedia.etag);
    publicMediaUrl.mockClear();
    const conditional = await app.request('/api/home-summary', {
      headers: { 'if-none-match': initial.etag }
    });
    expect(conditional.status).toBe(304);
    expect(publicMediaUrl).not.toHaveBeenCalled();
    expect(initial.body.latestStandaloneVisit).toMatchObject({
      imageCount: 2,
      descriptionExcerpt: `${'😀'.repeat(239)}…`,
      featuredImage: {
        url: `https://api.example.test/assets/media/${first.fullKey}`,
        width: 1200,
        height: 800
      }
    });
    await write(
      `/api/visits/${record.id}/images/reorder`,
      { imageIds: [second.id, first.id] },
      'PATCH'
    );
    const reordered = await summary();
    expect(reordered.etag).not.toBe(initial.etag);
    expect(reordered.body.latestStandaloneVisit?.featuredImage).toEqual({
      url: `https://api.example.test/assets/media/${second.fullKey}`,
      width: null,
      height: null
    });
    const deleted = await app.request(`/api/visits/${record.id}/images/${second.id}`, {
      method: 'DELETE',
      headers: { cookie }
    });
    expect(deleted.status).toBe(204);
    expect((await summary()).body.latestStandaloneVisit).toMatchObject({
      imageCount: 1,
      featuredImage: { url: `https://api.example.test/assets/media/${first.fullKey}` }
    });
    await write(`/api/visits/${record.id}`, { note: '   ' }, 'PATCH');
    expect((await summary()).body.latestStandaloneVisit?.descriptionExcerpt).toBeNull();
    const unavailable = createApp({
      auth,
      database: db.database,
      getPublicMediaUrl: async () => ''
    });
    const withoutMedia = publicHomeSummaryResponseSchema.parse(
      await (await unavailable.request('/api/home-summary')).json()
    );
    expect(withoutMedia.latestStandaloneVisit?.featuredImage).toBeNull();
  });

  it('shares public cover ownership checks with the archive and permits stop covers', async () => {
    const trip = await write('/api/trips', { name: 'Retki', status: 'published' });
    const record = await visit({ visitedOn: '2026-06-01', tripId: trip.id });
    const cover = await image(record.id, 'cover');
    const select = (featuredImage: object | null) =>
      write(`/api/admin/trips/${trip.id}/featured-image`, { featuredImage }, 'PATCH');
    await select({ imageId: cover.id, source: 'visit-image' });
    const beforeEdit = await summary();
    await write(
      `/api/trips/${trip.id}`,
      { name: 'Uusi nimi', description: 'Uusi kuvaus' },
      'PATCH'
    );
    const edited = await summary();
    expect(edited.etag).not.toBe(beforeEdit.etag);
    expect(edited.body.latestTrip).toMatchObject({
      name: 'Uusi nimi',
      descriptionExcerpt: 'Uusi kuvaus'
    });
    expect((await summary()).body.latestTrip?.featuredImage).toMatchObject({
      width: 1200,
      height: 800
    });
    await write(`/api/visits/${record.id}`, { status: 'draft' }, 'PATCH');
    expect((await summary()).body.latestTrip?.featuredImage).toBeNull();
    const archive = (await (await app.request('/api/trips/archive')).json()) as {
      trips: { featuredImage: unknown }[];
    };
    expect(archive.trips[0]?.featuredImage).toBeNull();
    await write(`/api/visits/${record.id}`, { status: 'published', tripId: null }, 'PATCH');
    expect((await summary()).body.latestTrip?.featuredImage).toBeNull();
    await write(`/api/visits/${record.id}`, { tripId: trip.id }, 'PATCH');
    const stop = await write(`/api/trips/${trip.id}/stops`, {
      location: { coordinate: { lat: 60, lon: 24 }, label: 'Helsinki' },
      tripStopOrder: 2,
      visitedOn: '2026-06-01'
    });
    const stopImage = await createTripStopImage(db.database, {
      tripStopId: stop.id,
      displayOrder: 0,
      fullKey: 'trips/stop/full.jpg',
      thumbKey: 'trips/stop/thumb.jpg',
      mimeType: 'image/jpeg',
      createdAt: '2026-06-01T10:00:00.000Z',
      updatedAt: '2026-06-01T10:00:00.000Z'
    });
    await select({ imageId: stopImage.id, source: 'trip-stop-image' });
    expect((await summary()).body.latestTrip?.featuredImage).toEqual({
      url: 'https://api.example.test/assets/media/trips/stop/full.jpg',
      width: null,
      height: null
    });
    await select(null);
    expect((await summary()).body.latestTrip?.featuredImage).toBeNull();
  });

  it('counts distinct combined magnet places and invalidates validators on catalog changes', async () => {
    const empty = await summary();
    expect(empty.body).toMatchObject({
      latestTrip: null,
      latestStandaloneVisit: null,
      magnetProgress: { totalParks: 1, visitedParks: 0 }
    });
    await importParks({
      database: db.database,
      expectedActiveCount: 3,
      now: () => '2026-05-02T09:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark(),
          createLipasPark({
            'lipas-id': 12346,
            name: 'Magneettipaikka',
            type: { 'type-code': parkTypeFixtures.outdoorRecreationArea.typeCode }
          }),
          createLipasPark({
            'lipas-id': 12347,
            name: 'Muu paikka',
            type: { 'type-code': parkTypeFixtures.outdoorRecreationArea.typeCode }
          })
        ]
      })
    });
    await write('/api/parks/akasmannyn-kansallispuisto', { hasMagnet: false }, 'PATCH');
    await write('/api/parks/magneettipaikka', { hasMagnet: true }, 'PATCH');
    await write('/api/parks/magneettipaikka/visits', {
      status: 'published',
      visitedOn: '2026-06-01'
    });
    await write('/api/parks/magneettipaikka/visits', {
      status: 'published',
      visitedOn: '2026-06-02'
    });
    await write('/api/parks/muu-paikka/visits', { status: 'published', visitedOn: '2026-06-01' });
    const current = await summary();
    expect(current.body.magnetProgress).toEqual({ totalParks: 2, visitedParks: 1 });
    expect(current.etag).not.toBe(empty.etag);
    expect(current.body.progressByType[0]?.type).not.toHaveProperty('id');
    await write('/api/parks/muu-paikka', { hasMagnet: true }, 'PATCH');
    const changed = await summary();
    expect(changed.etag).not.toBe(current.etag);
    expect(changed.body.magnetProgress).toEqual({ totalParks: 3, visitedParks: 2 });
    const cached = await app.request('/api/home-summary', {
      headers: { 'if-none-match': changed.etag }
    });
    expect(cached.status).toBe(304);
    expect(await cached.text()).toBe('');
    const oldShape = await app.request('/api/home-summary', {
      headers: { 'if-none-match': changed.etag.replace('public-summary:v4:', 'public-summary:v3:') }
    });
    expect(oldShape.status).toBe(200);
  });

  it('surfaces database read failures through the HTTP error boundary', async () => {
    const failure = vi
      .spyOn(db.database, 'batch')
      .mockRejectedValueOnce(new Error('Database unavailable'));
    expect((await app.request('/api/home-summary')).status).toBe(500);
    failure.mockRestore();
  });
});
