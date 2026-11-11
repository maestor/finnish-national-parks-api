import { eq } from 'drizzle-orm';
import proj4 from 'proj4';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createVisit, getParkBySlug, updateParkRemoved } from '../../src/db/repositories.js';
import { parks, parkVisits, trailAreaLinks } from '../../src/db/schema.js';
import { listPublicAreaTrails } from '../../src/db/trail-areas.js';
import type { GeoJsonFeatureCollection } from '../../src/importer/geometry.js';
import { importParks } from '../../src/importer/import-parks.js';
import { importSpecialParks } from '../../src/importer/import-special-parks.js';
import { retireLongTrails } from '../../src/importer/retire-long-trails.js';
import { createLipasPark, createLipasTrail } from '../fixtures/lipas.js';
import { createTestDatabase } from '../helpers/test-db.js';

const route = (metres: number): GeoJsonFeatureCollection => {
  const inverse = (x: number): [number, number] =>
    proj4('+proj=utm +zone=35 +ellps=GRS80 +units=m +no_defs', 'WGS84', [x, 6700000]) as [
      number,
      number
    ];
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [inverse(400000), inverse(400000 + metres)] }
      }
    ]
  };
};

describe('100 km trail limit', () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeEach(async () => {
    db = await createTestDatabase();
  });
  afterEach(async () => db.dispose());

  it('keeps exactly 100 km and excludes trails over either measured or reported length', async () => {
    const items = [
      createLipasPark(),
      createLipasTrail({
        'lipas-id': 700001,
        name: 'Sadan kilometrin reitti',
        properties: { 'route-length-km': 100 },
        location: { geometries: route(100000) }
      }),
      createLipasTrail({
        'lipas-id': 700002,
        name: 'Liian pitkä reitti',
        properties: { 'route-length-km': 1 },
        location: { geometries: route(100001) }
      }),
      createLipasTrail({
        'lipas-id': 700003,
        name: 'Lyhyt lankonki',
        properties: { 'route-length-km': 700 },
        location: { geometries: route(700) }
      })
    ];
    const result = await importParks({
      database: db.database,
      sourceUrl: 'https://example.test',
      fetchSource: async () => ({ items })
    });
    const stored = await db.database.select().from(parks);
    expect(stored.map((p) => p.lipasId)).toEqual([12345, 700001]);
    expect(stored.some((p) => p.lipasId === 700002)).toBe(false);
    expect(result.excludedLongTrails).toEqual([
      expect.objectContaining({ lipasId: 700002, measuredLengthKm: expect.closeTo(100.001, 5) }),
      expect.objectContaining({
        lipasId: 700003,
        reportedLengthKm: 700,
        measuredLengthKm: expect.closeTo(0.7, 5)
      })
    ]);
  });

  it.each(['geometry', 'reported'])(
    'retires a trail whose %s grows past the limit without deleting visits',
    async (basis) => {
      const options = { database: db.database, sourceUrl: 'https://example.test' };
      const trail = createLipasTrail({ location: { geometries: route(1000) } });
      await importParks({ ...options, fetchSource: async () => ({ items: [trail] }) });
      await updateParkRemoved(db.database, 'testin-luontopolku', false);
      await createVisit(db.database, 'testin-luontopolku', {
        author: 'Retkeilijä',
        note: 'Oma muistiinpano',
        route: 'Lenkki',
        status: 'published',
        visitedOn: '2026-11-01'
      });
      const before = await db.database.select().from(parks);
      const visits = await db.database.select().from(parkVisits);
      const changedTrail =
        basis === 'geometry'
          ? { ...trail, location: { ...trail.location, geometries: route(110000) } }
          : { ...trail, properties: { 'route-length-km': 110 } };
      await expect(
        importParks({
          ...options,
          requireNoPublicTrailConversions: true,
          fetchSource: async () => ({
            items: [changedTrail]
          })
        })
      ).rejects.toThrow('requires immediate frontend cache expiry');
      expect(await db.database.select().from(parks)).toEqual(before);
      const result = await importParks({
        ...options,
        fetchSource: async () => ({
          items: [changedTrail]
        })
      });
      expect(result.deactivatedParks).toEqual([
        { lipasId: trail['lipas-id'], slug: 'testin-luontopolku' }
      ]);
      expect(result.affectedLongTrailSlugs).toEqual(['testin-luontopolku']);
      expect(await db.database.select().from(parks)).toEqual([
        expect.objectContaining({ id: before[0]!.id, catalogStatus: 'inactive' })
      ]);
      expect(await db.database.select().from(parkVisits)).toEqual(visits);
      await expect(getParkBySlug(db.database, 'testin-luontopolku')).resolves.toBeNull();
    }
  );

  it('previews existing long trails, then retires them and reports affected areas idempotently', async () => {
    await importParks({
      database: db.database,
      sourceUrl: 'https://example.test',
      fetchSource: async () => ({
        items: [createLipasPark(), createLipasTrail({ location: { geometries: route(1000) } })]
      })
    });
    const all = await db.database.select().from(parks);
    const trail = all.find((p) => p.typeId === 4404)!;
    const area = all.find((p) => p.typeId === 111)!;
    await db.database
      .update(parks)
      .set({ boundaryGeojson: JSON.stringify(route(110000)) })
      .where(eq(parks.id, trail.id));
    await db.database
      .insert(trailAreaLinks)
      .values({
        trailId: trail.id,
        areaId: area.id,
        override: 'include',
        automaticMatch: false,
        createdAt: '2026-11-01',
        updatedAt: '2026-11-01'
      })
      .onConflictDoUpdate({
        target: [trailAreaLinks.trailId, trailAreaLinks.areaId],
        set: { override: 'include' }
      });
    const rowsBefore = await db.database.select().from(parks);
    const linksBefore = await db.database.select().from(trailAreaLinks);
    const preview = await retireLongTrails({ database: db.database, dryRun: true });
    expect(preview.retiredTrails).toEqual([
      expect.objectContaining({ id: trail.id, measuredLengthKm: expect.closeTo(110, 5) })
    ]);
    expect(preview.affectedSlugs.sort()).toEqual([trail.slug, area.slug].sort());
    expect(await db.database.select().from(parks)).toEqual(rowsBefore);
    await retireLongTrails({ database: db.database });
    expect(
      (await db.database.select().from(parks).where(eq(parks.id, trail.id)))[0]?.catalogStatus
    ).toBe('inactive');
    expect(await db.database.select().from(trailAreaLinks)).toEqual(linksBefore);
    await expect(listPublicAreaTrails(db.database, area.id)).resolves.toEqual([]);
    expect((await retireLongTrails({ database: db.database })).retiredTrails).toEqual([]);
  });

  it('uses reported length when geometry is unmeasurable and keeps unknown-length trails unresolved', async () => {
    const empty: GeoJsonFeatureCollection = { type: 'FeatureCollection', features: [] };
    const result = await importParks({
      database: db.database,
      sourceUrl: 'https://example.test',
      fetchSource: async () => ({
        items: [
          createLipasTrail({
            'lipas-id': 700004,
            name: 'Puuttuva geometria',
            properties: { 'route-length-km': 750 },
            location: { geometries: empty }
          }),
          createLipasTrail({
            'lipas-id': 700005,
            name: 'Lyhyt reitti',
            properties: { 'route-length-km': 0.7 },
            location: { geometries: route(700) }
          }),
          createLipasTrail({
            'lipas-id': 700006,
            name: 'Tasapitkä reitti',
            properties: {},
            location: { geometries: route(100000) }
          }),
          createLipasTrail({
            'lipas-id': 700007,
            name: 'Tuntematon pituus',
            properties: {},
            location: { geometries: empty }
          })
        ]
      })
    });
    expect(result.excludedLongTrails).toEqual([
      expect.objectContaining({ lipasId: 700004, reportedLengthKm: 750, measuredLengthKm: null })
    ]);
    const before = await db.database.select().from(parks);
    const preview = await retireLongTrails({ database: db.database, dryRun: true });
    expect(preview.retiredTrails).toEqual([]);
    expect(preview.unresolvedTrails).toEqual([
      expect.objectContaining({ name: 'Tuntematon pituus', measuredLengthKm: null })
    ]);
    expect(await db.database.select().from(parks)).toEqual(before);
    await db.database.update(parks).set({ lengthKm: 750 }).where(eq(parks.lipasId, 700007));
    const oversizedUnknown = await retireLongTrails({ database: db.database, dryRun: true });
    expect(oversizedUnknown.retiredTrails).toEqual([
      expect.objectContaining({
        name: 'Tuntematon pituus',
        reportedLengthKm: 750,
        measuredLengthKm: null
      })
    ]);
    expect(oversizedUnknown.unresolvedTrails).toEqual([]);
  });

  it('retires long reported routes while honoring local corrections through later imports', async () => {
    const options = { database: db.database, sourceUrl: 'https://example.test' };
    const items = [
      createLipasTrail({
        'lipas-id': 700010,
        name: 'Reitti 2000',
        properties: { 'route-length-km': 58 },
        location: { geometries: route(58000) }
      }),
      createLipasTrail({
        'lipas-id': 700011,
        name: 'Pyhät Polut',
        properties: { 'route-length-km': 94 },
        location: { geometries: route(94000) }
      }),
      createLipasTrail({
        'lipas-id': 700012,
        name: 'Korjattu lankonki',
        properties: { 'route-length-km': 0.8 },
        location: { geometries: route(800) }
      })
    ];
    await importParks({ ...options, fetchSource: async () => ({ items }) });
    await db.database.update(parks).set({ lengthKm: 110 }).where(eq(parks.lipasId, 700010));
    await db.database.update(parks).set({ lengthKm: 103.27 }).where(eq(parks.lipasId, 700011));
    // Simulate a legacy source unit typo corrected in the app before retirement.
    await db.database.update(parks).set({ importedLengthKm: 700 }).where(eq(parks.lipasId, 700012));
    const before = await db.database.select().from(parks);
    const preview = await retireLongTrails({ database: db.database, dryRun: true });
    expect(preview.retiredTrails.map((p) => p.name)).toEqual(['Reitti 2000', 'Pyhät Polut']);
    expect(await db.database.select().from(parks)).toEqual(before);
    await retireLongTrails({ database: db.database });
    await expect(updateParkRemoved(db.database, 'reitti-2000', false)).rejects.toThrow(
      'over 100 km cannot be enabled'
    );
    const result = await importParks({
      ...options,
      fetchSource: async () => ({
        items: items.map((p) =>
          p['lipas-id'] === 700012 ? { ...p, properties: { 'route-length-km': 700 } } : p
        )
      })
    });
    expect(result.excludedLongTrails.map((p) => p.lipasId)).toEqual([700010, 700011]);
    const corrected = (await db.database.select().from(parks).where(eq(parks.lipasId, 700012)))[0];
    expect(corrected).toMatchObject({
      lengthKm: 0.8,
      importedLengthKm: 700,
      catalogStatus: 'active'
    });
  });

  it('previews linked trail withdrawal with area cache slugs and preserves manual exclusions', async () => {
    const options = { database: db.database, sourceUrl: 'https://example.test' };
    const area = createLipasPark();
    const trail = createLipasTrail({ location: { geometries: route(1000) } });
    await importParks({ ...options, fetchSource: async () => ({ items: [area, trail] }) });
    await db.database.update(trailAreaLinks).set({ override: 'exclude' });
    const before = await db.database.select().from(parks);
    const linksBefore = await db.database.select().from(trailAreaLinks);
    const fetchSource = async () => ({
      items: [area, { ...trail, location: { ...trail.location, geometries: route(110000) } }]
    });
    const preview = await importParks({ ...options, fetchSource, dryRun: true });
    expect(preview.affectedLongTrailSlugs.sort()).toEqual([
      'akasmannyn-kansallispuisto',
      'testin-luontopolku'
    ]);
    expect(await db.database.select().from(parks)).toEqual(before);
    expect(await db.database.select().from(trailAreaLinks)).toEqual(linksBefore);
    await importParks({ ...options, fetchSource });
    expect((await db.database.select().from(trailAreaLinks))[0]).toMatchObject({
      override: 'exclude',
      automaticMatch: false
    });
  });

  it('preserves visits when retiring an existing standalone route', async () => {
    await importParks({
      database: db.database,
      sourceUrl: 'https://example.test',
      fetchSource: async () => ({
        items: [createLipasTrail({ location: { geometries: route(1000) } })]
      })
    });
    await updateParkRemoved(db.database, 'testin-luontopolku', false);
    await createVisit(db.database, 'testin-luontopolku', {
      author: 'Retkeilijä',
      note: 'Säilytettävä',
      route: 'Lenkki',
      status: 'published',
      visitedOn: '2026-11-01'
    });
    const visits = await db.database.select().from(parkVisits);
    await db.database.update(parks).set({ boundaryGeojson: JSON.stringify(route(110000)) });
    await expect(updateParkRemoved(db.database, 'testin-luontopolku', false)).rejects.toThrow(
      'over 100 km cannot be enabled'
    );
    await retireLongTrails({ database: db.database, now: () => '2026-11-11T12:00:00.000Z' });
    expect(await db.database.select().from(parkVisits)).toEqual(visits);
    expect((await db.database.select().from(parks))[0]).toMatchObject({
      catalogStatus: 'inactive',
      removed: true,
      updatedAt: '2026-11-11T12:00:00.000Z'
    });
    await expect(getParkBySlug(db.database, 'testin-luontopolku')).resolves.toBeNull();
    await expect(updateParkRemoved(db.database, 'testin-luontopolku', false)).rejects.toThrow(
      'over 100 km cannot be enabled'
    );
  });

  it('rejects oversized special trails before any write, while accepting exactly 100 km', async () => {
    const options = { database: db.database, includeSlugs: ['torholan-luola'] };
    await expect(
      importSpecialParks({ ...options, fetchSource: async () => route(100001) })
    ).rejects.toThrow('exceeds the 100 km length limit');
    expect(await db.database.select().from(parks)).toEqual([]);
    await importSpecialParks({ ...options, fetchSource: async () => route(100000) });
    expect((await db.database.select().from(parks))[0]).toMatchObject({
      slug: 'torholan-luola',
      catalogStatus: 'active'
    });
    await db.database.update(parks).set({ lengthKm: 110 });
    await expect(
      importSpecialParks({ ...options, fetchSource: async () => route(800) })
    ).rejects.toThrow('exceeds the 100 km length limit');
    await db.database.update(parks).set({ lengthKm: 0.8 });
    await importSpecialParks({ ...options, fetchSource: async () => route(800) });
    expect((await db.database.select().from(parks))[0]).toMatchObject({
      lengthKm: 0.8,
      catalogStatus: 'active'
    });
  });
});
