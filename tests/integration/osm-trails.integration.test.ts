import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { parkDetailSchema } from '../../src/contracts/parks.js';
import { parks, trailAreaLinks } from '../../src/db/schema.js';
import {
  listPublicAreaTrails,
  listTrailAreas,
  setAreaTrailOverride
} from '../../src/db/trail-areas.js';
import { importOsmTrails } from '../../src/importer/import-osm-trails.js';
import { importParks } from '../../src/importer/import-parks.js';
import { reconcileTrailAreas } from '../../src/importer/reconcile-trail-areas.js';
import { createLipasPark } from '../fixtures/lipas.js';
import { createTestDatabase } from '../helpers/test-db.js';

const snapshot = {
  timestamp: '2026-11-10T21:21:39Z',
  routes: [
    {
      id: 12345,
      name: 'Testipolku',
      reportedLengthKm: 1,
      geometry: {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            geometry: {
              type: 'LineString' as const,
              coordinates: [
                [25, 61],
                [25.01, 61]
              ] as [number, number][]
            }
          }
        ]
      }
    }
  ]
};

describe('OSM linked trail import', () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeEach(async () => {
    db = await createTestDatabase();
    await importParks({
      database: db.database,
      sourceUrl: 'https://example.test',
      fetchSource: async () => ({ items: [createLipasPark()] })
    });
  });
  afterEach(async () => {
    await db.dispose();
  });
  it('previews without writing, imports idempotently, and survives park reconciliation', async () => {
    const preview = await importOsmTrails({ database: db.database, snapshot, dryRun: true });
    expect(preview.imported.map((trail) => trail.id)).toEqual([12345]);
    expect(await db.database.select().from(trailAreaLinks)).toHaveLength(0);
    await importOsmTrails({ database: db.database, snapshot });
    expect((await importOsmTrails({ database: db.database, snapshot })).affectedSlugs).toEqual([]);
    const trail = (await db.database.select().from(parks).where(eq(parks.name, 'Testipolku')))[0]!;
    expect(trail.trailPublicationRole).toBe('area_member');
    expect(await db.database.select().from(trailAreaLinks)).toHaveLength(1);
    const area = (
      await db.database.select().from(parks).where(eq(parks.lipasId, createLipasPark()['lipas-id']))
    )[0]!;
    await db.database.update(parks).set({ removed: false }).where(eq(parks.id, area.id));
    const response = await createApp({ database: db.database }).request(
      `/api/parks/${area.slug}?includeBoundary=true`
    );
    const detail = parkDetailSchema.parse(await response.json());
    expect(detail.linkedTrails).toMatchObject([
      {
        name: 'Testipolku',
        source: {
          type: 'openstreetmap',
          relationId: 12345,
          attribution: '© OpenStreetMap contributors'
        }
      }
    ]);
    expect(await listPublicAreaTrails(db.database, area.id)).toMatchObject([
      { name: 'Testipolku', source: { type: 'openstreetmap', relationId: 12345 } }
    ]);
    expect(await listTrailAreas(db.database, trail.slug)).toEqual([
      { name: area.name, slug: area.slug }
    ]);
    await setAreaTrailOverride(db.database, area.slug, trail.id, 'exclude');
    expect(await listTrailAreas(db.database, trail.slug)).toEqual([]);
    await importOsmTrails({ database: db.database, snapshot });
    expect(await listPublicAreaTrails(db.database, area.id)).toHaveLength(0);
    await reconcileTrailAreas(db.database, new Date().toISOString());
    expect(await db.database.select().from(trailAreaLinks)).toHaveLength(1);
  });
  it('reports long routes and named subparts of existing trails', async () => {
    const duplicate = {
      ...snapshot.routes[0]!,
      id: 12346,
      name: 'Alapolku',
      geometry: {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            geometry: {
              type: 'LineString' as const,
              coordinates: [
                [25.002, 61],
                [25.008, 61]
              ] as [number, number][]
            }
          }
        ]
      }
    };
    const tooLong = { ...snapshot.routes[0]!, id: 12347, name: 'Pitkä', reportedLengthKm: 101 };
    const result = await importOsmTrails({
      database: db.database,
      snapshot: { ...snapshot, routes: [duplicate, tooLong, snapshot.routes[0]!] },
      dryRun: true
    });
    expect(result.imported.map((r) => r.id)).toEqual([12345]);
    expect(result.excluded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 12346,
          reason: 'duplicate-or-contained',
          containingTrails: ['Testipolku']
        }),
        expect.objectContaining({ id: 12347, reason: 'over-100km' })
      ])
    );
  });
  it('preserves local reported-length corrections on source refresh and refuses oversized corrections', async () => {
    await importOsmTrails({ database: db.database, snapshot });
    const trail = (await db.database.select().from(parks).where(eq(parks.name, 'Testipolku')))[0]!;
    await db.database.update(parks).set({ lengthKm: 2 }).where(eq(parks.id, trail.id));
    await importOsmTrails({
      database: db.database,
      snapshot: { ...snapshot, routes: [{ ...snapshot.routes[0]!, reportedLengthKm: 500 }] }
    });
    expect(
      (await db.database.select().from(parks).where(eq(parks.id, trail.id)))[0]?.lengthKm
    ).toBe(2);
    await db.database.update(parks).set({ lengthKm: 101 }).where(eq(parks.id, trail.id));
    const preview = await importOsmTrails({ database: db.database, snapshot, dryRun: true });
    expect(preview.excluded).toContainEqual(
      expect.objectContaining({ id: 12345, reason: 'over-100km' })
    );
    await importOsmTrails({ database: db.database, snapshot });
    expect((await db.database.select().from(parks).where(eq(parks.id, trail.id)))[0]).toMatchObject(
      { catalogStatus: 'inactive', removed: true, lengthKm: 101 }
    );
    expect(await db.database.select().from(trailAreaLinks)).toHaveLength(1);
    await db.database.update(parks).set({ lengthKm: 2 }).where(eq(parks.id, trail.id));
    await importOsmTrails({ database: db.database, snapshot });
    expect((await db.database.select().from(parks).where(eq(parks.id, trail.id)))[0]).toMatchObject(
      { catalogStatus: 'active', removed: true, lengthKm: 2 }
    );
  });
  it('reports invalid, oversized geometry and routes outside existing areas', async () => {
    const route = snapshot.routes[0]!;
    const withCoords = (id: number, coordinates: [number, number][]) => ({
      ...route,
      id,
      geometry: {
        type: 'FeatureCollection' as const,
        features: [
          { type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates } }
        ]
      }
    });
    const result = await importOsmTrails({
      database: db.database,
      snapshot: {
        ...snapshot,
        routes: [
          withCoords(1, [
            [25, 61],
            [25, 61]
          ]),
          withCoords(2, [
            [25, 61],
            [29, 61]
          ]),
          withCoords(3, [
            [18, 61],
            [18.01, 61]
          ])
        ]
      },
      dryRun: true
    });
    expect(result.excluded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 1, reason: 'invalid-geometry' }),
        expect.objectContaining({ id: 2, reason: 'over-100km' }),
        expect.objectContaining({ id: 3, reason: 'no-area' })
      ])
    );
  });
  it('screens source aliases and stored trail containment with the containing name', async () => {
    await importOsmTrails({ database: db.database, snapshot });
    const route = snapshot.routes[0]!;
    const candidate = { ...route, id: 12346, name: 'Toinen nimi', aliases: ['Testipolku'] };
    const result = await importOsmTrails({
      database: db.database,
      snapshot: { ...snapshot, routes: [candidate] },
      dryRun: true
    });
    expect(result.excluded).toContainEqual(
      expect.objectContaining({
        id: 12346,
        reason: 'duplicate-or-contained',
        containingTrails: ['Testipolku']
      })
    );
  });
  it('removes obsolete automatic links and preserves manual overrides', async () => {
    await importOsmTrails({ database: db.database, snapshot });
    const trail = (await db.database.select().from(parks).where(eq(parks.name, 'Testipolku')))[0]!;
    const area = (
      await db.database.select().from(parks).where(eq(parks.lipasId, createLipasPark()['lipas-id']))
    )[0]!;
    const { id: _id, ...copy } = area;
    const [first, second] = await db.database
      .insert(parks)
      .values([
        {
          ...copy,
          lipasId: 900001,
          slug: 'muu-alue',
          name: 'Muu alue',
          bboxMinLon: 0,
          bboxMaxLon: 1,
          bboxMinLat: 0,
          bboxMaxLat: 1
        },
        {
          ...copy,
          lipasId: 900002,
          slug: 'toinen-alue',
          name: 'Toinen alue',
          bboxMinLon: 0,
          bboxMaxLon: 1,
          bboxMinLat: 0,
          bboxMaxLat: 1
        }
      ])
      .returning();
    const now = new Date().toISOString();
    await db.database.insert(trailAreaLinks).values([
      {
        trailId: trail.id,
        areaId: first!.id,
        automaticMatch: true,
        createdAt: now,
        updatedAt: now
      },
      {
        trailId: trail.id,
        areaId: second!.id,
        automaticMatch: true,
        override: 'include',
        createdAt: now,
        updatedAt: now
      }
    ]);
    const report = await importOsmTrails({ database: db.database, snapshot });
    const links = await db.database.select().from(trailAreaLinks);
    expect(links.find((link) => link.areaId === first!.id)).toBeUndefined();
    expect(links.find((link) => link.areaId === second!.id)).toMatchObject({
      automaticMatch: false,
      override: 'include'
    });
    expect(report.affectedSlugs).toEqual(expect.arrayContaining(['muu-alue', 'toinen-alue']));
  });
  it('does not add two overlapping OSM relations with the same name', async () => {
    const first = snapshot.routes[0]!;
    const second = {
      ...first,
      id: 12346,
      geometry: {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            geometry: {
              type: 'LineString' as const,
              coordinates: [
                [25.009, 61],
                [25.02, 61]
              ] as [number, number][]
            }
          }
        ]
      }
    };
    const preview = await importOsmTrails({
      database: db.database,
      snapshot: { ...snapshot, routes: [first, second] },
      dryRun: true
    });
    expect(preview.imported).toHaveLength(1);
    expect(preview.excluded).toContainEqual(
      expect.objectContaining({
        reason: 'duplicate-or-contained',
        containingTrails: ['Testipolku']
      })
    );
  });
  it('aborts an update if an administrator changes the trail during matching', async () => {
    await importOsmTrails({ database: db.database, snapshot });
    const trail = (await db.database.select().from(parks).where(eq(parks.name, 'Testipolku')))[0]!;
    await expect(
      importOsmTrails({
        database: db.database,
        snapshot: { ...snapshot, routes: [{ ...snapshot.routes[0]!, name: 'Uusi nimi' }] },
        beforeApply: async () => {
          await db.database.update(parks).set({ lengthKm: 3 }).where(eq(parks.id, trail.id));
        }
      })
    ).rejects.toThrow('changed during import');
    expect((await db.database.select().from(parks).where(eq(parks.id, trail.id)))[0]).toMatchObject(
      { name: 'Testipolku', lengthKm: 3 }
    );
  });
  it('prioritizes national parks and handles larger catalogs in batches', async () => {
    const area = (
      await db.database.select().from(parks).where(eq(parks.lipasId, createLipasPark()['lipas-id']))
    )[0]!;
    const { id: _id, ...copy } = area;
    await db.database.insert(parks).values(
      Array.from({ length: 51 }, (_, n) => ({
        ...copy,
        lipasId: 910000 + n,
        slug: `area-${n}`,
        name: `Area ${n}`,
        typeId: 103,
        bboxMinLon: 0,
        bboxMaxLon: 1,
        bboxMinLat: 0,
        bboxMaxLat: 1
      }))
    );
    const result = await importOsmTrails({ database: db.database, snapshot, dryRun: true });
    expect(result.imported[0]?.areas).toContain(area.slug);
  });
  it('aborts retirement when an administrator corrects the trail during matching', async () => {
    await importOsmTrails({ database: db.database, snapshot });
    const trail = (await db.database.select().from(parks).where(eq(parks.name, 'Testipolku')))[0]!;
    await db.database.update(parks).set({ lengthKm: 101 }).where(eq(parks.id, trail.id));
    await expect(
      importOsmTrails({
        database: db.database,
        snapshot,
        beforeApply: async () => {
          await db.database.update(parks).set({ lengthKm: 2 }).where(eq(parks.id, trail.id));
        }
      })
    ).rejects.toThrow('changed during import');
    expect((await db.database.select().from(parks).where(eq(parks.id, trail.id)))[0]).toMatchObject(
      { catalogStatus: 'active', lengthKm: 2 }
    );
  });
  it('lists national park candidates ahead of other areas', async () => {
    const area = (
      await db.database.select().from(parks).where(eq(parks.lipasId, createLipasPark()['lipas-id']))
    )[0]!;
    const { id: _id, ...copy } = area;
    const boundary = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [20, 61],
                [21, 61],
                [21, 62],
                [20, 62],
                [20, 61]
              ]
            ]
          }
        }
      ]
    });
    await db.database.insert(parks).values({
      ...copy,
      lipasId: 920000,
      slug: 'muu',
      name: 'Muu',
      typeId: 103,
      bboxMinLon: 20,
      bboxMaxLon: 21,
      bboxMinLat: 61,
      bboxMaxLat: 62,
      boundaryGeojson: boundary
    });
    const other = {
      ...snapshot.routes[0]!,
      id: 920001,
      name: 'A polku',
      geometry: {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            geometry: {
              type: 'LineString' as const,
              coordinates: [
                [20.1, 61.5],
                [20.11, 61.5]
              ] as [number, number][]
            }
          }
        ]
      }
    };
    const third = {
      ...other,
      id: 920002,
      name: 'B polku',
      geometry: {
        ...other.geometry,
        features: [
          {
            ...other.geometry.features[0]!,
            geometry: {
              type: 'LineString' as const,
              coordinates: [
                [20.4, 61.5],
                [20.41, 61.5]
              ] as [number, number][]
            }
          }
        ]
      }
    };
    const result = await importOsmTrails({
      database: db.database,
      snapshot: { ...snapshot, routes: [other, third, snapshot.routes[0]!] },
      dryRun: true
    });
    expect(result.imported.map((r) => r.name)).toEqual(['Testipolku', 'A polku', 'B polku']);
  });
  it('preserves an edited trail name on source refresh', async () => {
    await importOsmTrails({ database: db.database, snapshot });
    const trail = (await db.database.select().from(parks).where(eq(parks.name, 'Testipolku')))[0]!;
    await db.database.update(parks).set({ name: 'Oma nimi' }).where(eq(parks.id, trail.id));
    await importOsmTrails({
      database: db.database,
      snapshot: { ...snapshot, routes: [{ ...snapshot.routes[0]!, name: 'Uusi lähdenimi' }] }
    });
    expect((await db.database.select().from(parks).where(eq(parks.id, trail.id)))[0]).toMatchObject(
      { name: 'Oma nimi', importedName: 'Uusi lähdenimi' }
    );
  });
  it('returns no candidates when the local catalog is empty', async () => {
    const empty = await createTestDatabase();
    try {
      expect(
        (await importOsmTrails({ database: empty.database, snapshot, dryRun: true })).excluded
      ).toContainEqual(expect.objectContaining({ reason: 'no-area' }));
    } finally {
      await empty.dispose();
    }
  });
  it('handles unusable stored trail geometry and repeated route points', async () => {
    await importOsmTrails({ database: db.database, snapshot });
    const trail = (await db.database.select().from(parks).where(eq(parks.name, 'Testipolku')))[0]!;
    const polygon = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [25, 61],
                [25.01, 61],
                [25, 61.01],
                [25, 61]
              ]
            ]
          }
        }
      ]
    });
    await db.database.update(parks).set({ boundaryGeojson: polygon }).where(eq(parks.id, trail.id));
    const candidate = {
      ...snapshot.routes[0]!,
      id: 12346,
      name: 'Erillinen',
      geometry: {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            geometry: {
              type: 'LineString' as const,
              coordinates: [
                [25, 61],
                [25, 61],
                [25.01, 61]
              ] as [number, number][]
            }
          }
        ]
      }
    };
    const report = await importOsmTrails({
      database: db.database,
      snapshot: { ...snapshot, routes: [candidate] },
      dryRun: true
    });
    expect(report.imported.map((r) => r.id)).toEqual([12346]);
  });
  it('reports invalid boundaries and sorts invalid geometry without importing', async () => {
    const area = (
      await db.database.select().from(parks).where(eq(parks.lipasId, createLipasPark()['lipas-id']))
    )[0]!;
    await db.database
      .update(parks)
      .set({ boundaryGeojson: JSON.stringify({ type: 'FeatureCollection', features: [] }) })
      .where(eq(parks.id, area.id));
    const route = snapshot.routes[0]!;
    const bad = {
      ...route,
      id: 12346,
      geometry: {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            geometry: {
              type: 'LineString' as const,
              coordinates: [
                [25, 61],
                [25, 61]
              ] as [number, number][]
            }
          }
        ]
      }
    };
    const result = await importOsmTrails({
      database: db.database,
      snapshot: { ...snapshot, routes: [bad, { ...bad, id: 12347 }, route] },
      dryRun: true
    });
    expect(result.imported).toHaveLength(0);
    expect(result.excluded.map((r) => r.reason)).toEqual(
      expect.arrayContaining(['invalid-geometry', 'no-area'])
    );
  });
});
