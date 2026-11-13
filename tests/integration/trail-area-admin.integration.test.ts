import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import {
  trailAreaCandidateSchema,
  trailAreaLinkSchema,
  trailAreaValidationFailureSchema,
  trailLinkedAreaSchema
} from '../../src/contracts/trail-areas.js';
import {
  createTrip,
  createVisit,
  createVisitImage,
  findPublicMediaKey
} from '../../src/db/repositories.js';
import { parks, parkVisits, trailAreaLinks, visitTrails } from '../../src/db/schema.js';
import { createSessionToken } from '../../src/http/session.js';
import { importParks } from '../../src/importer/import-parks.js';
import { reconcileTrailAreas } from '../../src/importer/reconcile-trail-areas.js';
import { createLipasHikingTrail, createLipasPark, createLipasTrail } from '../fixtures/lipas.js';
import { createTestDatabase } from '../helpers/test-db.js';

const independentTrail = () =>
  createLipasTrail({
    location: {
      geometries: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: [
                [35, 66],
                [35.1, 66.1]
              ]
            }
          }
        ]
      }
    }
  });
const auth = {
  cookieName: '__session',
  frontendUrl: 'http://localhost:4300',
  googleClientId: 'test',
  googleClientSecret: 'test',
  jwtSecret: 'test-jwt-secret-at-least-32-characters-long'
};
describe('admin trail relationships', () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let cookie: string;
  beforeEach(async () => {
    db = await createTestDatabase();
    const token = await createSessionToken(
      { email: 'admin@example.com', name: 'Admin', picture: '', role: 'admin', sub: 'admin' },
      new TextEncoder().encode(auth.jwtSecret)
    );
    cookie = `__session=${token}`;
    await importParks({
      database: db.database,
      sourceUrl: 'https://example.test',
      fetchSource: async () => ({ items: [createLipasPark(), independentTrail()] })
    });
  });
  afterEach(async () => {
    await db.dispose();
  });
  it('includes linked visit trails in public trips and admin previews', async () => {
    const app = createApp({ auth, database: db.database });
    const trail = (await db.database.select().from(parks).where(eq(parks.lipasId, 440401)))[0]!;
    const slug = 'akasmannyn-kansallispuisto';
    await db.database.update(parks).set({ removed: false }).where(eq(parks.slug, slug));
    const headers = { cookie, 'content-type': 'application/json' };
    await app.request(`/api/admin/parks/${slug}/trails/${trail.id}`, { method: 'PUT', headers });
    const trip = await createTrip(db.database, { name: 'Testiretki', status: 'published' });
    const response = await app.request(`/api/parks/${slug}/visits`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        visitedOn: '2026-11-12',
        status: 'published',
        tripId: trip.id,
        trailIds: [trail.id]
      })
    });
    expect(response.status).toBe(201);
    for (const path of [`/api/trips/slug/${trip.slug}`, `/api/admin/trips/${trip.id}/preview`]) {
      const result = await app.request(path, { headers });
      expect(result.status).toBe(200);
      expect(await result.json()).toMatchObject({
        itinerary: [{ visit: { trails: [{ id: trail.id, name: trail.name, slug: trail.slug }] } }]
      });
    }
  });
  it('roundtrips visit trails and blocks unlink until every draft and published visit releases it', async () => {
    const app = createApp({ auth, database: db.database });
    const trail = (await db.database.select().from(parks).where(eq(parks.lipasId, 440401)))[0]!;
    const slug = 'akasmannyn-kansallispuisto';
    await db.database.update(parks).set({ removed: false }).where(eq(parks.slug, slug));
    const path = `/api/admin/parks/${slug}/trails/${trail.id}`;
    const headers = { cookie, 'content-type': 'application/json' };
    await app.request(path, { method: 'PUT', headers });
    const ids: number[] = [];
    for (const status of ['draft', 'published']) {
      const created = await app.request(`/api/parks/${slug}/visits`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          visitedOn: '2026-11-12',
          status,
          route: 'Original route',
          trailIds: [trail.id]
        })
      });
      expect(created.status).toBe(201);
      const visit = (await created.json()) as { id: number };
      expect(visit).toMatchObject({
        trails: [{ id: trail.id, name: trail.name, slug: trail.slug }],
        route: 'Original route'
      });
      ids.push(visit.id);
    }
    const publicVisits = await app.request(`/api/parks/${slug}/visits`);
    expect(await publicVisits.json()).toMatchObject({
      visits: [{ id: ids[1], trails: [{ id: trail.id }] }]
    });
    expect((await app.request(path, { method: 'DELETE' })).status).toBe(401);
    const blocked = await app.request(path, { method: 'DELETE', headers });
    expect(blocked.status).toBe(409);
    expect(blocked.headers.get('cache-control')).toContain('no-store');
    expect(await blocked.json()).toMatchObject({
      code: 'TRAIL_HAS_VISITS',
      visits: expect.arrayContaining(ids.map((id) => ({ id, visitedOn: '2026-11-12' })))
    });
    for (const id of ids) {
      const read = await app.request(`/api/admin/visits/${id}`, { headers });
      expect(await read.json()).toMatchObject({ trails: [{ id: trail.id }] });
      const edited = await app.request(`/api/visits/${id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ trailIds: [] })
      });
      expect(edited.status).toBe(200);
      expect(await edited.json()).toMatchObject({ trails: [], route: 'Original route' });
      if (id === ids[0]) {
        const stillBlocked = await app.request(path, { method: 'DELETE', headers });
        expect(stillBlocked.status).toBe(409);
        expect(await stillBlocked.json()).toMatchObject({
          visits: [{ id: ids[1], visitedOn: '2026-11-12' }]
        });
      }
    }
    expect((await app.request(path, { method: 'DELETE', headers })).status).toBe(200);
  });
  it('rejects unavailable and wrong-park trails atomically and preserves assignments when omitted', async () => {
    const app = createApp({ auth, database: db.database });
    const headers = { cookie, 'content-type': 'application/json' };
    const slug = 'akasmannyn-kansallispuisto';
    await db.database.update(parks).set({ removed: false }).where(eq(parks.slug, slug));
    const trail = (await db.database.select().from(parks).where(eq(parks.lipasId, 440401)))[0]!;
    const create = (trailIds: unknown) =>
      app.request(`/api/parks/${slug}/visits`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ visitedOn: '2026-11-12', trailIds })
      });
    expect((await create([trail.id])).status).toBe(422);
    expect((await create([-1])).status).toBe(400);
    expect((await create([999999])).status).toBe(422);
    expect(await db.database.select().from(parkVisits)).toEqual([]);
    await app.request(`/api/admin/parks/${slug}/trails/${trail.id}`, { method: 'PUT', headers });
    const created = (await (await create([trail.id, trail.id])).json()) as {
      id: number;
      trails: unknown[];
    };
    expect(created.trails).toHaveLength(1);
    const update = (body: unknown) =>
      app.request(`/api/visits/${created.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body)
      });
    expect((await update({ note: 'must roll back', trailIds: [999999] })).status).toBe(422);
    const read = await app.request(`/api/admin/visits/${created.id}`, { headers });
    expect(await read.json()).toMatchObject({ note: null, trails: [{ id: trail.id }] });
    const edited = await update({ route: 'Still independent' });
    expect(await edited.json()).toMatchObject({
      route: 'Still independent',
      trails: [{ id: trail.id }]
    });
    expect((await app.request(`/api/admin/parks/${slug}/visit-trails`)).status).toBe(401);
    const choices = await app.request(`/api/admin/parks/${slug}/visit-trails`, { headers });
    expect(choices.headers.get('cache-control')).toContain('no-store');
    expect(await choices.json()).toMatchObject({
      trails: [{ trailId: trail.id, effective: true }]
    });
    expect(
      await (await app.request(`/api/admin/parks/${trail.slug}/visit-trails`, { headers })).json()
    ).toEqual({ trails: [] });
    expect((await app.request('/api/admin/parks/missing/visit-trails', { headers })).status).toBe(
      404
    );
    await app.request(`/api/visits/${created.id}`, { method: 'DELETE', headers });
    expect(await db.database.select().from(visitTrails)).toEqual([]);
    expect(
      (
        await app.request(`/api/admin/parks/${slug}/trails/${trail.id}`, {
          method: 'DELETE',
          headers
        })
      ).status
    ).toBe(200);
  });
  it('pins automatic membership through imports and guards direct database unlink or reassignment', async () => {
    await importParks({
      database: db.database,
      sourceUrl: 'https://example.test',
      fetchSource: async () => ({ items: [createLipasPark(), createLipasTrail()] })
    });
    const slug = 'akasmannyn-kansallispuisto';
    const area = (await db.database.select().from(parks).where(eq(parks.slug, slug)))[0]!;
    const trail = (await db.database.select().from(parks).where(eq(parks.lipasId, 440401)))[0]!;
    await db.database.update(parks).set({ removed: false }).where(eq(parks.id, area.id));
    const visit = await createVisit(db.database, slug, {
      visitedOn: '2026-11-12',
      trailIds: [trail.id]
    });
    expect(visit.trails).toHaveLength(1);
    await expect(db.database.delete(trailAreaLinks)).rejects.toThrow();
    await expect(db.database.update(trailAreaLinks).set({ override: 'exclude' })).rejects.toThrow();
    await expect(db.database.update(trailAreaLinks).set({ trailId: area.id })).rejects.toThrow();
    await expect(
      db.database.update(parkVisits).set({ parkId: trail.id }).where(eq(parkVisits.id, visit.id))
    ).rejects.toThrow();
    await expect(
      db.database.insert(visitTrails).values({ visitId: visit.id, trailId: area.id })
    ).rejects.toThrow();
    await expect(db.database.update(visitTrails).set({ trailId: area.id })).rejects.toThrow();
    await importParks({
      database: db.database,
      sourceUrl: 'https://example.test',
      fetchSource: async () => ({ items: [createLipasPark(), independentTrail()] })
    });
    expect(await db.database.select().from(trailAreaLinks)).toMatchObject([
      { override: 'include', automaticMatch: false }
    ]);
    expect(await db.database.select().from(visitTrails)).toEqual([
      { visitId: visit.id, trailId: trail.id }
    ]);
  });
  it('lists a trail’s effective areas privately, including after changes to links', async () => {
    const app = createApp({ auth, database: db.database, apiKey: 'secret' });
    const trail = (
      await db.database
        .select()
        .from(parks)
        .where(eq(parks.lipasId, createLipasTrail()['lipas-id']))
    )[0]!;
    const area = (
      await db.database.select().from(parks).where(eq(parks.lipasId, createLipasPark()['lipas-id']))
    )[0]!;
    const path = `/api/admin/parks/${trail.slug}/areas`;
    const headers = { cookie, authorization: 'Bearer secret' };
    expect((await app.request(path, { headers: { authorization: 'Bearer secret' } })).status).toBe(
      401
    );
    expect(await (await app.request(path, { headers })).json()).toEqual({ areas: [] });
    await app.request(`/api/admin/parks/${area.slug}/trails/${trail.id}`, {
      method: 'PUT',
      headers
    });
    const response = await app.request(path, { headers });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const payload = (await response.json()) as { areas: unknown[] };
    expect(payload).toEqual({ areas: [{ name: area.name, slug: area.slug }] });
    expect(payload.areas.every((item) => trailLinkedAreaSchema.safeParse(item).success)).toBe(true);
    const [second] = await db.database
      .insert(parks)
      .values({
        ...area,
        id: undefined,
        name: 'Toinen alue',
        slug: 'toinen-alue',
        lipasId: 987654321
      })
      .returning();
    await db.database.insert(trailAreaLinks).values({
      trailId: trail.id,
      areaId: second!.id,
      automaticMatch: true,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01'
    });
    expect(await (await app.request(path, { headers })).json()).toEqual({
      areas: [
        { name: second!.name, slug: second!.slug },
        { name: area.name, slug: area.slug }
      ]
    });
    await db.database
      .update(trailAreaLinks)
      .set({ override: 'exclude' })
      .where(eq(trailAreaLinks.areaId, second!.id));
    expect(await (await app.request(path, { headers })).json()).toEqual({
      areas: [{ name: area.name, slug: area.slug }]
    });
    await app.request(`/api/admin/parks/${area.slug}/trails/${trail.id}`, {
      method: 'DELETE',
      headers
    });
    expect(await (await app.request(path, { headers })).json()).toEqual({ areas: [] });
    expect((await app.request('/api/admin/parks/unknown/areas', { headers })).status).toBe(404);
    expect((await app.request(`/api/admin/parks/${area.slug}/areas`, { headers })).status).toBe(
      422
    );
    await db.database
      .update(parks)
      .set({ catalogStatus: 'inactive' })
      .where(eq(parks.id, trail.id));
    expect(await (await app.request(path, { headers })).json()).toEqual({ areas: [] });
    await db.database
      .update(parks)
      .set({ catalogStatus: 'active', managedByLipasImport: false })
      .where(eq(parks.id, trail.id));
    expect(await (await app.request(path, { headers })).json()).toEqual({ areas: [] });
    expect((await createApp({ database: db.database }).request(path)).status).toBe(503);
  });
  it('reports an operational error if the trail relationship read fails', async () => {
    const trail = (
      await db.database
        .select()
        .from(parks)
        .where(eq(parks.lipasId, createLipasTrail()['lipas-id']))
    )[0]!;
    const app = createApp({ auth, database: db.database });
    await db.client.execute('DROP TABLE trail_area_links');
    const response = await app.request(`/api/admin/parks/${trail.slug}/areas`, {
      headers: { cookie }
    });
    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('returns effective linked trail geometry in public boundary details and refreshes validators', async () => {
    const app = createApp({ auth, database: db.database });
    const trail = (
      await db.database
        .select()
        .from(parks)
        .where(eq(parks.lipasId, createLipasTrail()['lipas-id']))
    )[0]!;
    await db.database
      .update(parks)
      .set({ removed: false })
      .where(eq(parks.lipasId, createLipasPark()['lipas-id']));
    const detailPath = '/api/parks/akasmannyn-kansallispuisto?includeBoundary=true';
    const initial = await app.request(detailPath);
    const initialEtag = initial.headers.get('etag')!;
    expect(await initial.json()).toMatchObject({ linkedTrails: [] });
    await app.request(`/api/admin/parks/akasmannyn-kansallispuisto/trails/${trail.id}`, {
      method: 'PUT',
      headers: { cookie }
    });
    const linked = await app.request(detailPath, { headers: { 'if-none-match': initialEtag } });
    expect(linked.status).toBe(200);
    expect(await linked.json()).toMatchObject({
      linkedTrails: [
        {
          name: trail.name,
          address: 'Polkutie 1, 00999 Testikylä',
          boundaryGeoJson: JSON.parse(trail.boundaryGeojson)
        }
      ]
    });
    await db.database
      .update(parks)
      .set({ locationLabel: trail.name, postalCode: null, postalOffice: null })
      .where(eq(parks.id, trail.id));
    const withoutAddress = await app.request(detailPath, {
      headers: { 'if-none-match': linked.headers.get('etag')! }
    });
    expect(withoutAddress.status).toBe(200);
    expect(await withoutAddress.json()).toMatchObject({ linkedTrails: [{ address: null }] });
    const summary = await app.request('/api/parks/akasmannyn-kansallispuisto');
    expect(await summary.json()).not.toHaveProperty('linkedTrails');
    await app.request(`/api/admin/parks/akasmannyn-kansallispuisto/trails/${trail.id}`, {
      method: 'DELETE',
      headers: { cookie }
    });
    expect(await (await app.request(detailPath)).json()).toMatchObject({ linkedTrails: [] });
  });
  it('rejects ineligible trails and exposes bounded candidate search only to an admin', async () => {
    const app = createApp({ auth, database: db.database, apiKey: 'secret' });
    const trail = (
      await db.database
        .select()
        .from(parks)
        .where(eq(parks.lipasId, createLipasTrail()['lipas-id']))
    )[0]!;
    const area = (
      await db.database.select().from(parks).where(eq(parks.lipasId, createLipasPark()['lipas-id']))
    )[0]!;
    const base = '/api/admin/parks/akasmannyn-kansallispuisto';
    expect(
      (
        await app.request(`${base}/trail-candidates`, {
          headers: { authorization: 'Bearer secret' }
        })
      ).status
    ).toBe(401);
    const headers = { cookie, authorization: 'Bearer secret' };
    const response = await app.request(`${base}/trail-candidates?q=luonto&limit=1`, { headers });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const candidates = (await response.json()) as { trails: unknown[] };
    expect(
      candidates.trails.every((candidate) => trailAreaCandidateSchema.safeParse(candidate).success)
    ).toBe(true);
    expect(candidates).toMatchObject({
      trails: [expect.objectContaining({ trailId: trail.id })],
      nextOffset: null
    });
    expect(
      (await app.request(`${base}/trails/${area.id}`, { method: 'PUT', headers })).status
    ).toBe(422);
    await db.database
      .update(parks)
      .set({ managedByLipasImport: false })
      .where(eq(parks.id, trail.id));
    expect(
      (await app.request(`${base}/trails/${trail.id}`, { method: 'PUT', headers })).status
    ).toBe(422);
    await db.database
      .update(parks)
      .set({ managedByLipasImport: true, catalogStatus: 'inactive' })
      .where(eq(parks.id, trail.id));
    expect(
      (await app.request(`${base}/trails/${trail.id}`, { method: 'PUT', headers })).status
    ).toBe(422);
  });
  it('withdraws a linked destination from public lists and changes cache validators', async () => {
    const app = createApp({ auth, database: db.database });
    const trail = (
      await db.database
        .select()
        .from(parks)
        .where(eq(parks.lipasId, createLipasTrail()['lipas-id']))
    )[0]!;
    await db.database.update(parks).set({ removed: false }).where(eq(parks.id, trail.id));
    const beforeList = await app.request('/api/parks/search');
    const beforeMap = await app.request('/api/map-summary');
    const before = (await beforeList.json()) as { parks: { slug: string }[] };
    expect(before.parks.map((park) => park.slug)).toContain(trail.slug);
    const added = await app.request(
      `/api/admin/parks/akasmannyn-kansallispuisto/trails/${trail.id}`,
      { method: 'PUT', headers: { cookie } }
    );
    expect(added.status).toBe(200);
    const afterList = await app.request('/api/parks/search', {
      headers: { 'if-none-match': beforeList.headers.get('etag')! }
    });
    const afterMap = await app.request('/api/map-summary', {
      headers: { 'if-none-match': beforeMap.headers.get('etag')! }
    });
    expect(afterList.status).toBe(200);
    expect(afterMap.status).toBe(200);
    expect(
      ((await afterList.json()) as { parks: { slug: string }[] }).parks.map((park) => park.slug)
    ).not.toContain(trail.slug);
    expect(
      ((await afterMap.json()) as { parks: { slug: string }[] }).parks.map((park) => park.slug)
    ).not.toContain(trail.slug);
    expect((await app.request(`/api/parks/${trail.slug}`)).status).toBe(404);
    expect((await app.request(`/api/parks/${trail.slug}/visits`)).status).toBe(404);
  });
  it('keeps all qualifying parents and respects exclusion after recomputation', async () => {
    const secondArea = createLipasPark({ 'lipas-id': 34567, name: 'Toinen alue' });
    const source = [createLipasPark(), secondArea, createLipasTrail()];
    const options = {
      database: db.database,
      sourceUrl: 'https://example.test',
      fetchSource: async () => ({ items: source })
    };
    await importParks(options);
    const trail = (
      await db.database
        .select()
        .from(parks)
        .where(eq(parks.lipasId, createLipasTrail()['lipas-id']))
    )[0]!;
    expect(await db.database.select().from(trailAreaLinks)).toHaveLength(2);
    const app = createApp({ auth, database: db.database });
    const path = `/api/admin/parks/akasmannyn-kansallispuisto/trails/${trail.id}`;
    const removed = await app.request(path, { method: 'DELETE', headers: { cookie } });
    const removedBody = await removed.json();
    expect(removed.status).toBe(200);
    expect(removedBody).toMatchObject({
      override: 'exclude',
      automaticMatch: true,
      effective: false
    });
    const repeatedRemoval = await app.request(path, { method: 'DELETE', headers: { cookie } });
    expect(await repeatedRemoval.json()).toEqual(removedBody);
    await importParks(options);
    const links = await db.database.select().from(trailAreaLinks);
    expect(links).toHaveLength(2);
    expect(links.filter((link) => link.override === 'exclude' && link.automaticMatch)).toHaveLength(
      1
    );
    expect(links.filter((link) => link.override === null && link.automaticMatch)).toHaveLength(1);
    const added = await app.request(path, { method: 'PUT', headers: { cookie } });
    const addedBody = await added.json();
    expect(addedBody).toMatchObject({ override: 'include', effective: true });
    const repeat = await app.request(path, { method: 'PUT', headers: { cookie } });
    expect(await repeat.json()).toEqual(addedBody);
  });
  it('paginates candidates and keeps a below-threshold manual inclusion', async () => {
    const crossing = createLipasTrail({
      location: {
        geometries: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: [
                  [25.9, 61],
                  [27, 61]
                ]
              }
            }
          ]
        }
      }
    });
    const options = {
      database: db.database,
      sourceUrl: 'https://example.test',
      fetchSource: async () => ({ items: [createLipasPark(), crossing, createLipasHikingTrail()] })
    };
    await importParks(options);
    expect(await db.database.select().from(trailAreaLinks)).toHaveLength(0);
    const trail = (await db.database.select().from(parks).where(eq(parks.lipasId, 440401)))[0]!;
    const app = createApp({ auth, database: db.database });
    const candidates = await app.request(
      '/api/admin/parks/akasmannyn-kansallispuisto/trail-candidates?limit=1',
      { headers: { cookie } }
    );
    expect(await candidates.json()).toMatchObject({ nextOffset: 1 });
    const path = `/api/admin/parks/akasmannyn-kansallispuisto/trails/${trail.id}`;
    expect((await app.request(path, { method: 'PUT', headers: { cookie } })).status).toBe(200);
    await importParks(options);
    const link = (await db.database.select().from(trailAreaLinks))[0]!;
    expect(link).toMatchObject({ override: 'include', automaticMatch: false });
    expect(link.overlapRatio).toBeLessThan(0.1);
  });

  it('reports malformed stored trail and area geometry for review', async () => {
    const source = [createLipasPark(), createLipasTrail()];
    await importParks({
      database: db.database,
      sourceUrl: 'https://example.test',
      fetchSource: async () => ({ items: source })
    });
    const trail = (await db.database.select().from(parks).where(eq(parks.lipasId, 440401)))[0]!;
    const area = (await db.database.select().from(parks).where(eq(parks.lipasId, 12345)))[0]!;
    const original = trail.boundaryGeojson;
    await db.database.update(parks).set({ boundaryGeojson: '{' }).where(eq(parks.id, trail.id));
    const invalidTrail = await db.database.transaction((tx) =>
      reconcileTrailAreas(tx, '2026-11-10T00:00:00Z')
    );
    expect(invalidTrail.unresolved).toContainEqual({
      trailId: trail.id,
      areaId: null,
      status: 'invalid-line'
    });
    await db.database
      .update(parks)
      .set({ boundaryGeojson: original })
      .where(eq(parks.id, trail.id));
    await db.database.update(parks).set({ boundaryGeojson: '{' }).where(eq(parks.id, area.id));
    const invalidArea = await db.database.transaction((tx) =>
      reconcileTrailAreas(tx, '2026-11-10T00:00:00Z')
    );
    expect(invalidArea.unresolved).toContainEqual({
      trailId: trail.id,
      areaId: area.id,
      status: 'invalid-area'
    });
  });

  it('keeps a manual override when a parent geometry becomes invalid', async () => {
    const source = [createLipasPark(), createLipasTrail()];
    const options = {
      database: db.database,
      sourceUrl: 'https://example.test',
      fetchSource: async () => ({ items: source })
    };
    await importParks(options);
    const trail = (await db.database.select().from(parks).where(eq(parks.lipasId, 440401)))[0]!;
    const app = createApp({ auth, database: db.database });
    const path = `/api/admin/parks/akasmannyn-kansallispuisto/trails/${trail.id}`;
    await app.request(path, { method: 'PUT', headers: { cookie } });
    const invalid = createLipasPark({
      location: {
        geometries: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: {
                type: 'Polygon',
                coordinates: [
                  [
                    [24, 60],
                    [26, 62],
                    [24, 62],
                    [26, 60],
                    [24, 60]
                  ]
                ]
              }
            }
          ]
        }
      }
    });
    const result = await importParks({
      ...options,
      fetchSource: async () => ({ items: [invalid, createLipasTrail()] })
    });
    expect(result.trailAreaResult?.unresolved).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ trailId: trail.id, status: 'invalid-area' })
      ])
    );
    expect(await db.database.select().from(trailAreaLinks)).toMatchObject([
      { override: 'include', automaticMatch: false }
    ]);
    expect((await db.database.select().from(parks).where(eq(parks.id, trail.id)))[0]).toMatchObject(
      { trailPublicationRole: 'area_member' }
    );
  });

  it('protects invalid link-management requests before validation and disables caching', async () => {
    const app = createApp({ auth, database: db.database });
    const path = '/api/admin/parks/akasmannyn-kansallispuisto/trails/not-a-number';
    const anonymous = await app.request(path, { method: 'PUT' });
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('cache-control')).toContain('no-store');
    const invalid = await app.request(path, { method: 'PUT', headers: { cookie } });
    expect(invalid.status).toBe(400);
    expect(trailAreaValidationFailureSchema.safeParse(await invalid.json()).success).toBe(true);
    expect(invalid.headers.get('cache-control')).toContain('no-store');
  });

  it('does not report old overrides as effective after a trail becomes ineligible', async () => {
    const app = createApp({ auth, database: db.database });
    const trail = (await db.database.select().from(parks).where(eq(parks.lipasId, 440401)))[0]!;
    const base = '/api/admin/parks/akasmannyn-kansallispuisto/trails';
    await app.request(`${base}/${trail.id}`, { method: 'PUT', headers: { cookie } });
    for (const state of [
      { managedByLipasImport: false },
      { managedByLipasImport: true, typeId: 111 },
      { typeId: 4404, catalogStatus: 'inactive' }
    ]) {
      await db.database.update(parks).set(state).where(eq(parks.id, trail.id));
      const response = await app.request(base, { headers: { cookie } });
      expect(await response.json()).toMatchObject({
        trails: [
          expect.objectContaining({ trailId: trail.id, override: 'include', effective: false })
        ]
      });
    }
  });

  it('rejects missing and wrong-type area paths without exposing private links', async () => {
    const app = createApp({ auth, database: db.database });
    expect(
      (await app.request('/api/admin/parks/missing/trails', { headers: { cookie } })).status
    ).toBe(404);
    expect(
      (await app.request('/api/admin/parks/testin-luontopolku/trails', { headers: { cookie } }))
        .status
    ).toBe(422);
    for (const path of [
      '/api/admin/parks/missing/trail-candidates',
      '/api/admin/parks/testin-luontopolku/trail-candidates'
    ]) {
      const response = await app.request(path, { headers: { cookie } });
      expect(response.status).toBe(path.includes('/missing/') ? 404 : 422);
      expect(response.headers.get('cache-control')).toContain('no-store');
    }
    for (const method of ['PUT', 'DELETE']) {
      const response = await app.request('/api/admin/parks/testin-luontopolku/trails/999', {
        method,
        headers: { cookie }
      });
      expect(response.status).toBe(422);
    }
    const unconfigured = createApp({ database: db.database });
    const unavailable = await unconfigured.request(
      '/api/admin/parks/akasmannyn-kansallispuisto/trails'
    );
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get('cache-control')).toContain('no-store');
    expect(
      (
        await app.request('/api/admin/parks/missing/trails/999', {
          method: 'PUT',
          headers: { cookie }
        })
      ).status
    ).toBe(404);
    expect(
      (
        await app.request('/api/admin/parks/akasmannyn-kansallispuisto/trails/999', {
          method: 'DELETE',
          headers: { cookie }
        })
      ).status
    ).toBe(404);
  });
  it('returns private generic errors if relationship storage is unavailable', async () => {
    const app = createApp({ auth, database: db.database });
    const trail = (await db.database.select().from(parks).where(eq(parks.lipasId, 440401)))[0]!;
    await db.database
      .update(parks)
      .set({ trailPublicationRole: 'area_member' })
      .where(eq(parks.id, trail.id));
    await db.client.execute('DROP TABLE trail_area_links');
    const base = '/api/admin/parks/akasmannyn-kansallispuisto/trails';
    for (const [method, path] of [
      ['GET', base],
      ['PUT', `${base}/${trail.id}`],
      ['DELETE', `${base}/${trail.id}`]
    ] as const) {
      const response = await app.request(path, { method, headers: { cookie } });
      expect(response.status).toBe(500);
      expect(response.headers.get('cache-control')).toContain('no-store');
      expect(await response.json()).toEqual({ error: 'Internal server error.' });
    }
    const enable = await app.request(`/api/parks/${trail.slug}/removed`, {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ removed: false })
    });
    expect(enable.status).toBe(500);
    expect(enable.headers.get('cache-control')).toContain('no-store');
  });

  it('keeps candidate-read database failures private', async () => {
    const app = createApp({ auth, database: db.database });
    await db.client.close();
    const response = await app.request(
      '/api/admin/parks/akasmannyn-kansallispuisto/trail-candidates',
      { headers: { cookie } }
    );
    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toEqual({ error: 'Internal server error.' });
  });

  it('keeps existing visit and media history private but inspectable for a member trail', async () => {
    const app = createApp({ auth, database: db.database });
    const trail = (await db.database.select().from(parks).where(eq(parks.lipasId, 440401)))[0]!;
    await db.database.update(parks).set({ removed: false }).where(eq(parks.id, trail.id));
    const trip = await createTrip(db.database, { name: 'Testiretki', status: 'published' });
    const visit = await createVisit(db.database, trail.slug, {
      author: 'Admin',
      note: 'Walk',
      route: 'Loop',
      status: 'published',
      visitedOn: '2026-11-10',
      tripId: trip.id
    });
    await createVisitImage(db.database, {
      visitId: visit.id,
      fullKey: 'visits/test/full.jpg',
      thumbKey: 'visits/test/thumb.jpg',
      mimeType: 'image/jpeg',
      originalName: 'test.jpg',
      displayOrder: 0,
      createdAt: '2026-11-10T10:00:00.000Z',
      updatedAt: '2026-11-10T10:00:00.000Z'
    });
    await db.database
      .update(parks)
      .set({ trailPublicationRole: 'area_member' })
      .where(eq(parks.id, trail.id));
    expect((await app.request(`/api/visits/${visit.id}`)).status).toBe(404);
    expect((await app.request(`/api/parks/${trail.slug}/visits`)).status).toBe(404);
    expect(await findPublicMediaKey(db.database, 'visits/test/full.jpg')).toBeNull();
    const publicTrip = await app.request(`/api/trips/slug/${trip.slug}`);
    expect((await publicTrip.json()) as { itinerary: unknown[] }).toMatchObject({ itinerary: [] });
    const privateTrip = await app.request(`/api/admin/trips/${trip.id}/preview`, {
      headers: { cookie }
    });
    expect(privateTrip.status).toBe(200);
    expect(await privateTrip.json()).toMatchObject({
      itinerary: [expect.objectContaining({ kind: 'visit' })]
    });
    const privateImages = await app.request(
      `/api/admin/trips/${trip.id}/preview/visits/${visit.id}/images`,
      { headers: { cookie } }
    );
    expect(privateImages.status).toBe(200);
    expect(await privateImages.json()).toMatchObject({
      images: [expect.objectContaining({ id: expect.any(Number) })]
    });

    const privateVisit = await app.request(`/api/admin/visits/${visit.id}`, {
      headers: { cookie }
    });
    expect(privateVisit.status).toBe(200);
    expect(privateVisit.headers.get('cache-control')).toContain('no-store');
    const privateHistory = await app.request(`/api/admin/parks/${trail.slug}/visits`, {
      headers: { cookie }
    });
    expect(privateHistory.status).toBe(200);
    expect(await privateHistory.json()).toMatchObject({
      visits: [expect.objectContaining({ id: visit.id, route: 'Loop' })]
    });
  });

  it('requires a preservation decision before a visited trail can be linked', async () => {
    const app = createApp({ auth, database: db.database });
    const trail = (
      await db.database
        .select()
        .from(parks)
        .where(eq(parks.lipasId, createLipasTrail()['lipas-id']))
    )[0]!;
    await db.database.update(parks).set({ removed: false }).where(eq(parks.id, trail.id));
    await createVisit(db.database, trail.slug, {
      author: 'Admin',
      note: 'Walk',
      route: 'Loop',
      status: 'published',
      visitedOn: '2026-11-10'
    });
    const response = await app.request(
      `/api/admin/parks/akasmannyn-kansallispuisto/trails/${trail.id}`,
      { method: 'PUT', headers: { cookie } }
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('preservation decision')
    });
    expect((await app.request(`/api/parks/${trail.slug}`)).status).toBe(200);
  });
  it('requires an admin session and preserves manual inclusion and exclusion across imports', async () => {
    const app = createApp({ auth, database: db.database });
    const trail = (
      await db.database
        .select()
        .from(parks)
        .where(eq(parks.lipasId, createLipasTrail()['lipas-id']))
    )[0]!;
    const path = `/api/admin/parks/akasmannyn-kansallispuisto/trails/${trail.id}`;
    expect((await app.request('/api/admin/parks/akasmannyn-kansallispuisto/trails')).status).toBe(
      401
    );
    const add = await app.request(path, { method: 'PUT', headers: { cookie } });
    expect(add.status).toBe(200);
    expect(add.headers.get('cache-control')).toContain('no-store');
    const addedLink = await add.json();
    expect(trailAreaLinkSchema.safeParse(addedLink).success).toBe(true);
    expect(addedLink).toMatchObject({ effective: true, override: 'include' });
    await db.database.update(parks).set({ removed: false }).where(eq(parks.id, trail.id));
    expect((await app.request(`/api/parks/${trail.slug}`)).status).toBe(404);
    const privateDetail = await app.request(`/api/parks/${trail.slug}`, { headers: { cookie } });
    expect(privateDetail.status).toBe(200);
    expect(privateDetail.headers.get('cache-control')).toContain('no-store');
    const enable = await app.request(`/api/parks/${trail.slug}/removed`, {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ removed: false })
    });
    expect(enable.status).toBe(422);
    await db.database.update(parks).set({ removed: true }).where(eq(parks.id, trail.id));
    const read = await app.request('/api/admin/parks/akasmannyn-kansallispuisto/trails', {
      headers: { cookie }
    });
    expect(((await read.json()) as { trails: unknown[] }).trails).toEqual(
      expect.arrayContaining([expect.objectContaining({ trailId: trail.id })])
    );
    const remove = await app.request(path, { method: 'DELETE', headers: { cookie } });
    expect(await remove.json()).toMatchObject({ effective: false, override: 'exclude' });
    await importParks({
      database: db.database,
      sourceUrl: 'https://example.test',
      fetchSource: async () => ({ items: [createLipasPark(), independentTrail()] })
    });
    const reread = await app.request('/api/admin/parks/akasmannyn-kansallispuisto/trails', {
      headers: { cookie }
    });
    expect(((await reread.json()) as { trails: unknown[] }).trails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ trailId: trail.id, override: 'exclude', effective: false })
      ])
    );
    expect((await db.database.select().from(parks).where(eq(parks.id, trail.id)))[0]).toMatchObject(
      { removed: true, trailPublicationRole: 'area_member' }
    );
    const restore = await app.request(`/api/parks/${trail.slug}/removed`, {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ removed: false })
    });
    expect(restore.status).toBe(204);
    expect((await app.request(`/api/parks/${trail.slug}`)).status).toBe(200);
  });
});
