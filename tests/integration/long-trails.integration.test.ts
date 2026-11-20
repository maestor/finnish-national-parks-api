import { eq } from 'drizzle-orm';
import proj4 from 'proj4';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createVisit, getParkBySlug, updateParkRemoved } from '../../src/db/repositories.js';
import { parks, parkVisits } from '../../src/db/schema.js';
import type { GeoJsonFeatureCollection } from '../../src/importer/geometry.js';
import { importParks } from '../../src/importer/import-parks.js';
import { importSpecialParks } from '../../src/importer/import-special-parks.js';
import { createLipasTrail } from '../fixtures/lipas.js';
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

describe('Long trails in the catalog', () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeEach(async () => {
    db = await createTestDatabase();
  });
  afterEach(async () => db.dispose());

  it('imports and can publish trails over 100 km by geometry or reported length', async () => {
    const items = [
      createLipasTrail({
        'lipas-id': 700001,
        name: 'Pitkä kartoitettu reitti',
        properties: { 'route-length-km': 90 },
        location: { geometries: route(120000) }
      }),
      createLipasTrail({
        'lipas-id': 700002,
        name: 'Pitkä ilmoitettu reitti',
        properties: { 'route-length-km': 130 },
        location: { geometries: route(1000) }
      })
    ];
    await importParks({
      database: db.database,
      sourceUrl: 'https://example.test',
      fetchSource: async () => ({ items })
    });
    const stored = await db.database.select().from(parks);
    expect(stored).toMatchObject([
      { lipasId: 700001, catalogStatus: 'active', removed: true, lengthKm: 90 },
      { lipasId: 700002, catalogStatus: 'active', removed: true, lengthKm: 130 }
    ]);
    for (const trail of stored) {
      await updateParkRemoved(db.database, trail.slug, false);
      await expect(getParkBySlug(db.database, trail.slug)).resolves.toMatchObject({
        slug: trail.slug
      });
    }
  });

  it('restores a previously inactive trail in place and preserves visits and admin length edits', async () => {
    let item = createLipasTrail({ location: { geometries: route(1000) } });
    const options = {
      database: db.database,
      sourceUrl: 'https://example.test',
      fetchSource: async () => ({ items: [item] }),
      requireNoPublicTrailConversions: true
    };
    await importParks(options);
    const [trail] = await db.database.select().from(parks);
    await updateParkRemoved(db.database, trail!.slug, false);
    await createVisit(db.database, trail!.slug, {
      note: 'Säilytettävä',
      status: 'published',
      visitedOn: '2026-11-01'
    });
    const visits = await db.database.select().from(parkVisits);
    await db.database
      .update(parks)
      .set({
        catalogStatus: 'inactive',
        removed: true,
        lengthKm: 111
      })
      .where(eq(parks.id, trail!.id));
    item = {
      ...item,
      location: { ...item.location, geometries: route(120000) },
      properties: { 'route-length-km': 120 }
    };
    const result = await importParks(options);
    expect(result.deactivatedParks).toEqual([]);
    expect(await db.database.select().from(parks)).toMatchObject([
      {
        id: trail!.id,
        catalogStatus: 'active',
        removed: true,
        lengthKm: 111,
        importedLengthKm: 120
      }
    ]);
    await updateParkRemoved(db.database, trail!.slug, false);
    const rerun = await importParks(options);
    expect(rerun.deactivatedParks).toEqual([]);
    await expect(getParkBySlug(db.database, trail!.slug)).resolves.toMatchObject({
      slug: trail!.slug
    });
    expect(await db.database.select().from(parkVisits)).toEqual(visits);
  });

  it('imports long special trail geometry and preserves a reported length above 100 km', async () => {
    const options = {
      database: db.database,
      includeSlugs: ['santalahden-luontopolku'],
      fetchSource: async () => route(120000)
    };
    await importSpecialParks({
      ...options,
      fetchSource: async () => ({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'MultiLineString',
              coordinates: [route(120000).features[0]!.geometry.coordinates]
            }
          }
        ]
      })
    });
    await db.database.update(parks).set({ lengthKm: 125 });
    await importSpecialParks(options);
    expect(await db.database.select().from(parks)).toMatchObject([
      { slug: 'santalahden-luontopolku', catalogStatus: 'active', lengthKm: 125 }
    ]);
  });
});
