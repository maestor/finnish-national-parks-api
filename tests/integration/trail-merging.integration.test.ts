import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { parkDetailSchema } from '../../src/contracts/parks.js';
import { getPublicVisitDataVersion } from '../../src/db/repositories.js';
import {
  parks,
  parkVisits,
  trailAreaLinks,
  trailMergeGroups,
  trailMergeMembers,
  visitImages,
  visitTrails
} from '../../src/db/schema.js';
import { listPublicAreaTrails } from '../../src/db/trail-areas.js';
import { type MergeTrailsInput, mergeTrails } from '../../src/db/trail-merges.js';
import type { GeoJsonFeatureCollection } from '../../src/importer/geometry.js';
import { importOsmTrails, type OsmSnapshot } from '../../src/importer/import-osm-trails.js';
import { importParks } from '../../src/importer/import-parks.js';
import { retireLongTrails } from '../../src/importer/retire-long-trails.js';
import { measureTrailLengthKm } from '../../src/importer/trail-area-geometry.js';
import { createLipasPark } from '../fixtures/lipas.js';
import { createTestDatabase } from '../helpers/test-db.js';

const line = (coordinates: [number, number][]): GeoJsonFeatureCollection => ({
  type: 'FeatureCollection',
  features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates } }]
});
const snapshot: OsmSnapshot = {
  timestamp: '2026-11-12T10:00:00Z',
  routes: [
    {
      id: 1,
      name: 'Yhdysreitti',
      reportedLengthKm: 1,
      geometry: line([
        [25, 61],
        [25.01, 61]
      ])
    },
    {
      id: 2,
      name: 'Kierros',
      reportedLengthKm: 2,
      geometry: line([
        [25.01, 61],
        [25.01, 61.01]
      ])
    }
  ]
};

describe('manual linked trail merging', () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let area: typeof parks.$inferSelect;
  let from: typeof parks.$inferSelect;
  let to: typeof parks.$inferSelect;
  beforeEach(async () => {
    db = await createTestDatabase();
    await importParks({
      database: db.database,
      fetchSource: async () => ({ items: [createLipasPark()] }),
      sourceUrl: 'https://example.test'
    });
    await importOsmTrails({ database: db.database, snapshot });
    [area, from, to] = (await Promise.all(
      [createLipasPark().name, 'Yhdysreitti', 'Kierros'].map(
        async (name) => (await db.database.select().from(parks).where(eq(parks.name, name)))[0]!
      )
    )) as [typeof area, typeof from, typeof to];
  });
  afterEach(async () => db.dispose());

  it('previews, combines geometry, deduplicates visit assignments and survives both source refreshes', async () => {
    await db.database.update(parks).set({ removed: false }).where(eq(parks.id, area.id));
    const visits = await db.database
      .insert(parkVisits)
      .values(
        ['draft', 'published'].map((status) => ({
          parkId: area.id,
          status: status as 'draft' | 'published',
          visitedOn: '2026-11-12',
          note: 'Keep this',
          route: 'Original route text',
          createdAt: snapshot.timestamp,
          updatedAt: snapshot.timestamp
        }))
      )
      .returning();
    await db.database.insert(visitTrails).values([
      { visitId: visits[0]!.id, trailId: from.id },
      { visitId: visits[0]!.id, trailId: to.id },
      { visitId: visits[1]!.id, trailId: from.id }
    ]);
    const before = await db.database.select().from(parks);
    const version = await getPublicVisitDataVersion(db.database);
    const input = { fromSlug: from.slug, toSlug: to.slug, name: 'Yhteinen kierros' };
    const preview = await mergeTrails(db.database, { ...input, dryRun: true });
    expect(preview).toMatchObject({
      movedVisitCount: 1,
      sharedVisitCount: 1,
      toSlug: 'yhteinen-kierros'
    });
    expect(await db.database.select().from(parks)).toEqual(before);
    expect(await getPublicVisitDataVersion(db.database)).toEqual(version);
    const result = await mergeTrails(db.database, input);
    expect(result.affectedSlugs).toEqual(
      expect.arrayContaining([from.slug, to.slug, 'yhteinen-kierros', area.slug])
    );
    expect(await db.database.select().from(parkVisits)).toEqual(visits);
    expect(await db.database.select().from(visitTrails)).toEqual(
      visits.map((v) => ({ visitId: v.id, trailId: to.id }))
    );
    expect(await listPublicAreaTrails(db.database, area.id)).toMatchObject([
      {
        name: 'Yhteinen kierros',
        slug: 'yhteinen-kierros',
        source: { relationId: 2, relations: [{ relationId: 1 }, { relationId: 2 }] }
      }
    ]);
    const changed: OsmSnapshot = {
      timestamp: '2026-11-13T10:00:00Z',
      routes: snapshot.routes.map((r) => ({
        ...r,
        name: 'Upstream rename',
        geometry:
          r.id === 1
            ? line([
                [25, 61],
                [25.02, 61]
              ])
            : line([
                [25.01, 61],
                [25.01, 61.02]
              ])
      }))
    };
    await importOsmTrails({ database: db.database, snapshot: changed });
    const trails = await listPublicAreaTrails(db.database, area.id);
    expect(trails).toHaveLength(1);
    const app = createApp({ database: db.database });
    const publicDetail = await app.request(`/api/parks/${area.slug}?includeBoundary=true`);
    expect(publicDetail.status).toBe(200);
    expect(parkDetailSchema.parse(await publicDetail.json()).linkedTrails).toMatchObject([
      { source: { relations: [{ relationId: 1 }, { relationId: 2 }] } }
    ]);
    const publicVisits = await app.request(`/api/parks/${area.slug}/visits`);
    expect(await publicVisits.json()).toMatchObject({
      visits: [
        {
          id: visits[1]!.id,
          trails: [{ id: to.id, name: 'Yhteinen kierros', slug: 'yhteinen-kierros' }]
        }
      ]
    });
    expect(trails[0]).toMatchObject({
      name: 'Yhteinen kierros',
      slug: 'yhteinen-kierros',
      boundaryGeoJson: {
        features: expect.arrayContaining(changed.routes.flatMap((r) => r.geometry.features))
      }
    });
    expect(trails[0]!.lengthKm).toBeCloseTo(
      measureTrailLengthKm({
        type: 'FeatureCollection',
        features: changed.routes.flatMap((r) => r.geometry.features)
      })!
    );
    expect(parkDetailSchema.shape.linkedTrails.parse(trails)).toMatchObject([
      { source: { relations: [{ relationId: 1 }, { relationId: 2 }] } }
    ]);
    expect((await db.database.select().from(parks).where(eq(parks.id, from.id)))[0]).toMatchObject({
      catalogStatus: 'inactive',
      removed: true
    });
    const after = await db.database.select().from(parks);
    expect((await mergeTrails(db.database, input)).alreadyMerged).toBe(true);
    expect(
      (await importOsmTrails({ database: db.database, snapshot: changed })).affectedSlugs
    ).toEqual([]);
    expect(await db.database.select().from(parks)).toEqual(after);
  });
  const merge = (options: Partial<MergeTrailsInput> = {}) =>
    mergeTrails(db.database, { fromSlug: from.slug, toSlug: to.slug, ...options });
  const stored = async () => ({
    parks: await db.database.select().from(parks),
    links: await db.database.select().from(trailAreaLinks),
    assignments: await db.database.select().from(visitTrails),
    members: await db.database.select().from(trailMergeMembers),
    groups: await db.database.select().from(trailMergeGroups),
    version: await getPublicVisitDataVersion(db.database)
  });

  it.each([
    [{ fromSlug: '' }, 'required'],
    [{ toSlug: '' }, 'required'],
    [{ name: '' }, 'required'],
    [{ name: 'x'.repeat(121) }, 'required'],
    [{ fromSlug: 'missing' }, 'not found'],
    [{ toSlug: 'missing' }, 'not found']
  ] as [Partial<MergeTrailsInput>, string][])(
    'rejects invalid request %j without writing',
    async (input, error) => {
      const before = await stored();
      await expect(merge(input)).rejects.toThrow(error);
      expect(await stored()).toEqual(before);
    }
  );

  it('rejects the same trail and an area as input', async () => {
    await expect(merge({ toSlug: from.slug })).rejects.toThrow('different');
    await expect(merge({ toSlug: area.slug })).rejects.toThrow('OSM-backed');
  });

  it.each([
    { typeId: 111 },
    { managedByLipasImport: true },
    { catalogStatus: 'inactive' },
    { trailPublicationRole: 'independent' as const }
  ])('rejects unsupported catalog state %j', async (change) => {
    await db.database.update(parks).set(change).where(eq(parks.id, from.id));
    await expect(merge()).rejects.toThrow('OSM-backed');
  });

  it('retains name and slug when omitted, source provenance and repeat safety', async () => {
    const beforeVersion = await getPublicVisitDataVersion(db.database);
    await merge();
    expect(await getPublicVisitDataVersion(db.database)).not.toEqual(beforeVersion);
    expect((await db.database.select().from(parks).where(eq(parks.id, to.id)))[0]).toMatchObject({
      name: to.name,
      slug: to.slug,
      id: to.id
    });
    const before = await stored();
    expect((await merge({ dryRun: true })).alreadyMerged).toBe(true);
    expect((await merge()).alreadyMerged).toBe(true);
    expect(await stored()).toEqual(before);
    await expect(merge({ name: 'Changed later' })).rejects.toThrow('differs');
    await expect(
      db.database.update(parks).set({ catalogStatus: 'active' }).where(eq(parks.id, from.id))
    ).rejects.toThrow();
    await expect(
      db.database.update(parks).set({ removed: false }).where(eq(parks.id, from.id))
    ).rejects.toThrow();
    await importParks({
      database: db.database,
      fetchSource: async () => ({ items: [createLipasPark()] }),
      sourceUrl: 'https://example.test'
    });
    await retireLongTrails({ database: db.database });
    expect(await listPublicAreaTrails(db.database, area.id)).toHaveLength(1);
    expect((await db.database.select().from(parks).where(eq(parks.id, from.id)))[0]).toMatchObject({
      catalogStatus: 'inactive',
      removed: true
    });
  });

  it('rejects name-driven slug collisions including the source slug', async () => {
    const before = await stored();
    await expect(merge({ name: area.name })).rejects.toThrow('already in use');
    await db.database.update(parks).set({ slug: 'yhdysreitti' }).where(eq(parks.id, from.id));
    await expect(merge({ fromSlug: 'yhdysreitti', name: 'Yhdysreitti' })).rejects.toThrow(
      'already in use'
    );
    expect(await db.database.select().from(trailMergeGroups)).toEqual(before.groups);
  });

  it('normalizes Finnish names, keeps destination identity, and prevents old-slug reuse', async () => {
    const result = await merge({ name: '  Storträskin reitti!  ' });
    expect(result).toMatchObject({ name: 'Storträskin reitti!', toSlug: 'stortraskin-reitti' });
    expect(
      (await merge({ toSlug: result.toSlug, name: 'Storträskin reitti!' })).alreadyMerged
    ).toBe(true);
    // An old destination URL reassigned to another existing row is no longer a safe repeat lookup.
    await db.database.update(parks).set({ slug: to.slug }).where(eq(parks.id, area.id));
    await expect(merge({ name: 'Storträskin reitti!' })).rejects.toThrow('reassigned');
  });

  it('rejects direct source visits instead of moving their owning park', async () => {
    await db.database.insert(parkVisits).values({
      parkId: from.id,
      visitedOn: '2026-11-12',
      createdAt: snapshot.timestamp,
      updatedAt: snapshot.timestamp
    });
    await expect(merge()).rejects.toThrow('direct park visits');
  });

  it('requires a common active area and refuses explicit destination exclusions', async () => {
    await db.database
      .update(trailAreaLinks)
      .set({ override: 'exclude' })
      .where(eq(trailAreaLinks.trailId, to.id));
    await expect(merge()).rejects.toThrow('share an active');
    await db.database.update(trailAreaLinks).set({ override: null });
    await db.database.update(parks).set({ catalogStatus: 'inactive' }).where(eq(parks.id, area.id));
    await expect(merge()).rejects.toThrow('share an active');
    await db.database.update(parks).set({ catalogStatus: 'active' }).where(eq(parks.id, area.id));
    const [extra] = await db.database
      .insert(parks)
      .values({ ...area, id: undefined, lipasId: 999, slug: 'extra' })
      .returning();
    await db.database.insert(trailAreaLinks).values([
      {
        areaId: extra!.id,
        trailId: from.id,
        override: 'include',
        createdAt: snapshot.timestamp,
        updatedAt: snapshot.timestamp
      },
      {
        areaId: extra!.id,
        trailId: to.id,
        override: 'exclude',
        createdAt: snapshot.timestamp,
        updatedAt: snapshot.timestamp
      }
    ]);
    const before = await stored();
    await expect(merge()).rejects.toThrow('explicitly excludes');
    expect(await stored()).toEqual(before);
  });

  it('pins additional source areas before transferring visits and keeps images and unrelated assignments', async () => {
    const [extra] = await db.database
      .insert(parks)
      .values({ ...area, id: undefined, lipasId: 999, slug: 'extra' })
      .returning();
    await db.database.insert(trailAreaLinks).values({
      areaId: extra!.id,
      trailId: from.id,
      override: 'include',
      createdAt: snapshot.timestamp,
      updatedAt: snapshot.timestamp
    });
    const [visit] = await db.database
      .insert(parkVisits)
      .values({
        parkId: extra!.id,
        visitedOn: '2026-11-12',
        createdAt: snapshot.timestamp,
        updatedAt: snapshot.timestamp
      })
      .returning();
    await db.database.insert(visitTrails).values({ visitId: visit!.id, trailId: from.id });
    await db.database.insert(visitImages).values({
      visitId: visit!.id,
      fullKey: 'keep/full',
      thumbKey: 'keep/thumb',
      mimeType: 'image/webp',
      createdAt: snapshot.timestamp,
      updatedAt: snapshot.timestamp
    });
    const images = await db.database.select().from(visitImages);
    const result = await merge();
    expect(result.addedAreaSlugs).toEqual(['extra']);
    expect(result.affectedSlugs).toContain('extra');
    expect(await db.database.select().from(visitImages)).toEqual(images);
    expect(await db.database.select().from(visitTrails)).toEqual([
      { visitId: visit!.id, trailId: to.id }
    ]);
    expect(
      (
        await db.database
          .select()
          .from(trailAreaLinks)
          .where(and(eq(trailAreaLinks.trailId, to.id), eq(trailAreaLinks.areaId, extra!.id)))
      )[0]
    ).toMatchObject({ override: 'include' });
  });

  it.each([
    { type: 'FeatureCollection', features: [] },
    line([[25, 61]]),
    line([
      [25, 61],
      [25, 61]
    ]),
    line([
      [250, 61],
      [25, 61]
    ]),
    {
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
                [25, 61]
              ]
            ]
          }
        }
      ]
    },
    line([
      [24, 61],
      [26, 61]
    ])
  ])('rolls back invalid or oversized source geometry %j', async (geometry) => {
    await db.database
      .update(parks)
      .set({ boundaryGeojson: JSON.stringify(geometry) })
      .where(eq(parks.id, from.id));
    const before = await stored();
    await expect(merge()).rejects.toThrow(/geometry|100 km/);
    expect(await stored()).toEqual(before);
  });

  it('deduplicates reversed parts and does not connect disconnected parts', async () => {
    const geometry = line([
      [25, 61],
      [25.01, 61]
    ]);
    geometry.features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [25.01, 61],
          [25, 61]
        ]
      }
    });
    geometry.features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [25.2, 61],
          [25.21, 61]
        ]
      }
    });
    await db.database
      .update(parks)
      .set({ boundaryGeojson: JSON.stringify(geometry) })
      .where(eq(parks.id, from.id));
    await merge();
    const [trail] = await listPublicAreaTrails(db.database, area.id);
    expect(trail!.boundaryGeoJson.features).toHaveLength(3);
    expect(trail!.lengthKm).toBeCloseTo(
      measureTrailLengthKm({
        type: 'FeatureCollection',
        features: [
          snapshot.routes[1]!.geometry.features[0]!,
          geometry.features[0]!,
          geometry.features[2]!
        ]
      })!
    );
  });

  it('absorbs a third route, preserves administrator lengths, and rejects group sources', async () => {
    await merge();
    const third = {
      id: 3,
      name: 'Kolmas',
      reportedLengthKm: null,
      geometry: line([
        [25.02, 61.01],
        [25.03, 61.02]
      ])
    };
    await importOsmTrails({ database: db.database, snapshot: { ...snapshot, routes: [third] } });
    const thirdRow = (
      await db.database.select().from(parks).where(eq(parks.slug, 'osm-relation-3'))
    )[0]!;
    await expect(
      mergeTrails(db.database, { fromSlug: to.slug, toSlug: thirdRow.slug })
    ).rejects.toThrow('source merge group');
    await expect(
      mergeTrails(db.database, { fromSlug: thirdRow.slug, toSlug: from.slug })
    ).rejects.toThrow('OSM-backed');
    await db.database.update(parks).set({ lengthKm: 7 }).where(eq(parks.id, to.id));
    const result = await mergeTrails(db.database, { fromSlug: thirdRow.slug, toSlug: to.slug });
    expect(result.lengthKm).toBe(7);
    expect(
      (await listPublicAreaTrails(db.database, area.id))[0]!.boundaryGeoJson.features
    ).toHaveLength(3);
    await importOsmTrails({
      database: db.database,
      snapshot: { timestamp: '2026-11-14T10:00:00Z', routes: [third] }
    });
    expect((await listPublicAreaTrails(db.database, area.id))[0]!.lengthKm).toBe(7);
  });
  it('retains rejected and missing components while refreshing a valid member', async () => {
    await merge();
    const before = await stored();
    const empty = await importOsmTrails({
      database: db.database,
      snapshot: { ...snapshot, routes: [] }
    });
    expect(empty.mergedWarnings).toHaveLength(2);
    expect(await stored()).toEqual(before);
    for (const invalid of [
      { ...snapshot.routes[0]!, reportedLengthKm: 101 },
      {
        ...snapshot.routes[0]!,
        geometry: line([
          [25, 61],
          [25, 61]
        ])
      }
    ]) {
      const changed = {
        ...snapshot,
        timestamp: '2026-11-14T10:00:00Z',
        routes: [invalid, snapshot.routes[1]!]
      };
      const report = await importOsmTrails({ database: db.database, snapshot: changed });
      expect(report.mergedWarnings[0]).toContain('rejected');
      expect(
        (await listPublicAreaTrails(db.database, area.id))[0]!.boundaryGeoJson.features
      ).toEqual(expect.arrayContaining(snapshot.routes.flatMap((r) => r.geometry.features)));
    }
  });

  it('updates one component in preview without writes and rejects concurrent canonical changes', async () => {
    await merge();
    const changed: OsmSnapshot = {
      ...snapshot,
      timestamp: '2026-11-14T10:00:00Z',
      routes: [
        {
          ...snapshot.routes[0]!,
          geometry: line([
            [25, 61],
            [25.02, 61]
          ])
        }
      ]
    };
    const before = await stored();
    const report = await importOsmTrails({
      database: db.database,
      snapshot: changed,
      dryRun: true
    });
    expect(report.mergedTrails).toHaveLength(1);
    expect(report.mergedWarnings).toHaveLength(1);
    expect(await stored()).toEqual(before);
    await expect(
      importOsmTrails({
        database: db.database,
        snapshot: changed,
        beforeApply: async () => {
          await db.database
            .update(parks)
            .set({ name: 'Concurrent edit' })
            .where(eq(parks.id, to.id));
        }
      })
    ).rejects.toThrow('changed during import');
    expect(await db.database.select().from(trailMergeMembers)).toEqual(before.members);
    const applied = await importOsmTrails({ database: db.database, snapshot: changed });
    expect(applied.affectedSlugs).toContain(area.slug);
    const [trail] = await listPublicAreaTrails(db.database, area.id);
    expect(trail!.name).toBe('Concurrent edit');
    expect(trail!.boundaryGeoJson.features).toEqual(
      expect.arrayContaining([
        changed.routes[0]!.geometry.features[0],
        snapshot.routes[1]!.geometry.features[0]
      ])
    );
  });

  it('rejects a combined refresh exceeding the length limit without replacing any snapshots', async () => {
    await merge();
    const before = await stored();
    const changed: OsmSnapshot = {
      ...snapshot,
      timestamp: '2026-11-14T10:00:00Z',
      routes: [
        {
          ...snapshot.routes[0]!,
          geometry: line([
            [24, 61],
            [25.3, 61]
          ])
        },
        {
          ...snapshot.routes[1]!,
          geometry: line([
            [24, 61.1],
            [25.3, 61.1]
          ])
        }
      ]
    };
    await expect(importOsmTrails({ database: db.database, snapshot: changed })).rejects.toThrow(
      '100 km'
    );
    expect(await stored()).toEqual(before);
    await db.database.update(parks).set({ lengthKm: 101 }).where(eq(parks.id, to.id));
    await expect(
      importOsmTrails({
        database: db.database,
        snapshot: { ...snapshot, timestamp: changed.timestamp }
      })
    ).rejects.toThrow('100 km');
    const third = {
      id: 3,
      name: 'Kolmas',
      reportedLengthKm: 1,
      geometry: line([
        [25.02, 61.01],
        [25.03, 61.02]
      ])
    };
    await importOsmTrails({ database: db.database, snapshot: { ...snapshot, routes: [third] } });
    await expect(
      mergeTrails(db.database, { fromSlug: 'osm-relation-3', toSlug: to.slug, dryRun: true })
    ).rejects.toThrow('100 km');
  });

  it('recomputes memberships for new, remote, inactive and invalid parent geometry without losing pinned visits', async () => {
    const remoteGeometry = createLipasPark({
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
                    [20, 60],
                    [21, 60],
                    [21, 61],
                    [20, 61],
                    [20, 60]
                  ]
                ]
              }
            }
          ]
        }
      }
    }).location.geometries;
    const parents = await db.database
      .insert(parks)
      .values([
        {
          ...area,
          id: undefined,
          lipasId: 991,
          slug: 'remote',
          boundaryGeojson: JSON.stringify(remoteGeometry)
        },
        { ...area, id: undefined, lipasId: 992, slug: 'inactive', catalogStatus: 'inactive' },
        { ...area, id: undefined, lipasId: 993, slug: 'new-area' },
        {
          ...area,
          id: undefined,
          lipasId: 994,
          slug: 'invalid-area',
          boundaryGeojson: JSON.stringify(
            line([
              [25, 61],
              [25.01, 61]
            ])
          )
        }
      ])
      .returning();
    // A manual inclusion can legitimately exist even when a later upstream area geometry is invalid.
    await db.database.insert(trailAreaLinks).values({
      areaId: parents[3]!.id,
      trailId: from.id,
      override: 'include',
      createdAt: snapshot.timestamp,
      updatedAt: snapshot.timestamp
    });
    const result = await merge();
    expect(result.affectedSlugs).toContain('new-area');
    const invalidLink = (
      await db.database
        .select()
        .from(trailAreaLinks)
        .where(and(eq(trailAreaLinks.trailId, to.id), eq(trailAreaLinks.areaId, parents[3]!.id)))
    )[0]!;
    expect(invalidLink).toMatchObject({
      override: 'include',
      automaticMatch: false,
      overlapMetres: null,
      geometryQuality: 'invalid-area'
    });
    await db.database.update(parks).set({ catalogStatus: 'inactive' }).where(eq(parks.id, area.id));
    await importOsmTrails({
      database: db.database,
      snapshot: { ...snapshot, timestamp: '2026-11-14T10:00:00Z' }
    });
    expect(
      (
        await db.database
          .select()
          .from(trailAreaLinks)
          .where(and(eq(trailAreaLinks.trailId, to.id), eq(trailAreaLinks.areaId, area.id)))
      )[0]
    ).toMatchObject({ override: 'include', automaticMatch: false });
  });

  it('rolls back transferred assignments and snapshots when a later database write fails', async () => {
    const [visit] = await db.database
      .insert(parkVisits)
      .values({
        parkId: area.id,
        visitedOn: '2026-11-12',
        createdAt: snapshot.timestamp,
        updatedAt: snapshot.timestamp
      })
      .returning();
    await db.database.insert(visitTrails).values({ visitId: visit!.id, trailId: from.id });
    await db.client.execute(
      `CREATE TRIGGER fail_merge BEFORE UPDATE ON parks WHEN NEW.id = ${to.id} BEGIN SELECT RAISE(ABORT, 'controlled write failure'); END`
    );
    const before = await stored();
    await expect(merge()).rejects.toThrow();
    expect(await stored()).toEqual(before);
  });
});
