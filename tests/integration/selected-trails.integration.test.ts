import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { and, eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { parkDetailSchema } from '../../src/contracts/parks.js';
import { createVisit, createVisitImage } from '../../src/db/repositories.js';
import {
  curatedTrailSources,
  importRuns,
  osmTrailSources,
  parks,
  parkVisits,
  publicDataVersions,
  trailAreaLinks,
  visitImages
} from '../../src/db/schema.js';
import {
  listAreaTrailCandidates,
  listTrailAreas,
  setAreaTrailOverride
} from '../../src/db/trail-areas.js';
import { mergeTrails } from '../../src/db/trail-merges.js';
import { createSessionToken } from '../../src/http/session.js';
import { importOsmTrails } from '../../src/importer/import-osm-trails.js';
import { importParks } from '../../src/importer/import-parks.js';
import {
  importSelectedTrails,
  loadSelectedTrails,
  parseSelectedTrails
} from '../../src/importer/import-selected-trails.js';
import { importSpecialParks } from '../../src/importer/import-special-parks.js';
import { reconcileTrailAreas } from '../../src/importer/reconcile-trail-areas.js';
import { createLipasPark } from '../fixtures/lipas.js';
import { createSpecialParksSource } from '../fixtures/special-parks.js';
import { createTestDatabase } from '../helpers/test-db.js';

const auth = {
  cookieName: '__session',
  frontendUrl: 'http://localhost:4300',
  googleClientId: 'test',
  googleClientSecret: 'test',
  jwtSecret: 'test-jwt-secret-at-least-32-characters-long'
};
const catalogText = await readFile(
  new URL('../../src/importer/osm-linked-trails.geojson', import.meta.url),
  'utf8'
);
const manifest = JSON.parse(catalogText) as {
  selections: {
    parentSlug: string;
    selectionKey: string;
    name: string;
    geometrySha256: string;
    osmRelationId: number | null;
    sourceUrls: string[];
    referenceUrl?: string;
  }[];
};

describe('selected trail batch', () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeEach(async () => {
    db = await createTestDatabase();
    await importParks({
      database: db.database,
      sourceUrl: 'https://example.test',
      fetchSource: async () => ({ items: [createLipasPark()] })
    });
    const original = (await db.database.select().from(parks))[0]!;
    const { id: _id, ...area } = original;
    const slugs = [...new Set(manifest.selections.map((s) => s.parentSlug))];
    await db.database.insert(parks).values(
      slugs.map((slug, index) => ({
        ...area,
        slug,
        name: slug,
        lipasId: 900000 + index,
        removed: false
      }))
    );
  });
  afterEach(async () => {
    await db.dispose();
  });

  it('previews without writes, publishes all selected lines under their parents, and reruns without writes', async () => {
    const before = await db.database.select().from(parks);
    const preview = await importSelectedTrails({ database: db.database, dryRun: true });
    expect(preview.selections).toHaveLength(manifest.selections.length);
    expect(await db.database.select().from(parks)).toEqual(before);
    expect(await db.database.select().from(trailAreaLinks)).toHaveLength(0);
    await importSelectedTrails({ database: db.database });
    expect(await db.database.select().from(trailAreaLinks)).toHaveLength(
      manifest.selections.length
    );
    for (const slug of new Set(manifest.selections.map((s) => s.parentSlug))) {
      const response = await createApp({ database: db.database }).request(
        `/api/parks/${slug}?includeBoundary=true`
      );
      expect(response.status).toBe(200);
      const detail = parkDetailSchema.parse(await response.json());
      expect(detail.linkedTrails?.map((trail) => trail.name).sort()).toEqual(
        manifest.selections
          .filter((s) => s.parentSlug === slug)
          .map((s) => s.name)
          .sort()
      );
    }
    const sources = await db.database.select().from(curatedTrailSources);
    expect(sources).toHaveLength(manifest.selections.length);
    const token = await createSessionToken(
      { email: 'admin@example.com', name: 'Admin', picture: '', role: 'admin', sub: 'admin' },
      new TextEncoder().encode(auth.jwtSecret)
    );
    const app = createApp({ database: db.database, auth });
    for (const selected of manifest.selections) {
      const source = sources.find((s) => s.selectionKey === selected.selectionKey)!;
      const trail = (
        await db.database.select().from(parks).where(eq(parks.id, source.trailId))
      )[0]!;
      const geometry = JSON.parse(trail.boundaryGeojson) as {
        features: { geometry: { coordinates: unknown; type: string } }[];
      };
      const digest = createHash('sha256')
        .update(
          JSON.stringify(
            geometry.features.map((f) => ({
              coordinates: f.geometry.coordinates,
              type: f.geometry.type
            }))
          )
        )
        .digest('hex');
      expect(digest).toBe(selected.geometrySha256);
      const detailResponse = await app.request(
        `/api/parks/${selected.parentSlug}?includeBoundary=true`
      );
      const detail = parkDetailSchema.parse(await detailResponse.json());
      const linked = detail.linkedTrails!.find((t) => t.slug === trail.slug)!;
      if (selected.referenceUrl) expect(trail.parkUrl).toBe(selected.referenceUrl);
      expect(linked.source?.type).toBe(
        selected.osmRelationId ? 'openstreetmap' : 'openstreetmap-curated'
      );
      expect(linked.source).toMatchObject({
        attribution: '© OpenStreetMap contributors',
        licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
        ...(selected.osmRelationId
          ? { relationId: selected.osmRelationId, sourceUrl: selected.sourceUrls[0] }
          : { sourceUrls: selected.sourceUrls })
      });
      expect((await app.request(`/api/parks/${trail.slug}`)).status).toBe(404);
      const path = `/api/admin/parks/${selected.parentSlug}/visit-trails`;
      expect((await app.request(path)).status).toBe(401);
      const choices = await (
        await app.request(path, { headers: { cookie: `__session=${token}` } })
      ).json();
      expect(choices).toMatchObject({
        trails: expect.arrayContaining([
          expect.objectContaining({ trailId: trail.id, effective: true })
        ])
      });
    }
    const versions = await db.database.select().from(publicDataVersions);
    const runs = await db.database.select().from(importRuns);
    const after = await db.database.select().from(parks);
    const links = await db.database.select().from(trailAreaLinks);
    expect((await importSelectedTrails({ database: db.database })).affectedSlugs).toEqual([]);
    expect(await db.database.select().from(parks)).toEqual(after);
    expect(await db.database.select().from(trailAreaLinks)).toEqual(links);
    expect(await db.database.select().from(importRuns)).toEqual(runs);
    expect(await db.database.select().from(publicDataVersions)).toEqual(versions);
    expect(
      (
        await db.database.select().from(parks).where(eq(parks.name, manifest.selections[0]!.name))
      )[0]?.removed
    ).toBe(true);
  });
  it('fails preview for an inactive parent and for an ambiguous name without writing', async () => {
    const selected = manifest.selections[0]!;
    await db.database
      .update(parks)
      .set({ catalogStatus: 'inactive' })
      .where(eq(parks.slug, selected.parentSlug));
    await expect(importSelectedTrails({ database: db.database, dryRun: true })).rejects.toThrow(
      'Missing or inactive parent'
    );
    await db.database
      .update(parks)
      .set({ catalogStatus: 'active' })
      .where(eq(parks.slug, selected.parentSlug));
    const area = (await db.database.select().from(parks))[0]!;
    const { id: _id, ...copy } = area;
    const bounds = (await loadSelectedTrails()).selections[0]!.bounds;
    await db.database.insert(parks).values({
      ...copy,
      typeId: 4405,
      slug: 'ambiguous',
      lipasId: -500,
      name: selected.name,
      bboxMinLon: bounds.minLon,
      bboxMaxLon: bounds.maxLon,
      bboxMinLat: bounds.minLat,
      bboxMaxLat: bounds.maxLat
    });
    await expect(importSelectedTrails({ database: db.database, dryRun: true })).rejects.toThrow(
      'Ambiguous trail name'
    );
    expect(await db.database.select().from(curatedTrailSources)).toEqual([]);
    expect(await db.database.select().from(trailAreaLinks)).toEqual([]);
  });

  it('keeps distant namesakes untouched while reporting and importing the selected trail', async () => {
    const selected = manifest.selections.find((item) => item.osmRelationId === 6425065)!;
    const area = (await db.database.select().from(parks))[0]!;
    const { id: _id, ...copy } = area;
    const namesake = (
      await db.database
        .insert(parks)
        .values({
          ...copy,
          name: selected.name,
          slug: 'distant-korpinkierros',
          lipasId: 603820,
          typeId: 4405,
          bboxMinLon: 22.96,
          bboxMaxLon: 22.98,
          bboxMinLat: 63.25,
          bboxMaxLat: 63.28
        })
        .returning()
    )[0]!;
    const before = (await db.database.select().from(parks).where(eq(parks.id, namesake.id)))[0];
    const preview = await importSelectedTrails({ database: db.database, dryRun: true });
    expect(preview.selections.find((item) => item.key === selected.selectionKey)).toMatchObject({
      action: 'create',
      distantNamesakes: [{ id: namesake.id, slug: namesake.slug }]
    });
    await importSelectedTrails({ database: db.database });
    expect((await db.database.select().from(parks).where(eq(parks.id, namesake.id)))[0]).toEqual(
      before
    );
    expect(
      await db.database
        .select()
        .from(osmTrailSources)
        .where(eq(osmTrailSources.relationId, 6425065))
    ).toHaveLength(1);
    const rerun = await importSelectedTrails({ database: db.database });
    expect(rerun.affectedSlugs).toEqual([]);
    expect(rerun.selections.find((item) => item.key === selected.selectionKey)).toMatchObject({
      action: 'unchanged',
      distantNamesakes: [{ id: namesake.id, slug: namesake.slug }]
    });
  });

  it('blocks a same-name trail already linked to the selected parent even when its bounds are distant', async () => {
    const selected = manifest.selections.find((item) => item.osmRelationId === 6425065)!;
    const parent = (
      await db.database.select().from(parks).where(eq(parks.slug, selected.parentSlug))
    )[0]!;
    const { id: _id, ...copy } = parent;
    const namesake = (
      await db.database
        .insert(parks)
        .values({
          ...copy,
          name: selected.name,
          slug: 'linked-korpinkierros',
          lipasId: 603820,
          typeId: 4405,
          bboxMinLon: 22.96,
          bboxMaxLon: 22.98,
          bboxMinLat: 63.25,
          bboxMaxLat: 63.28
        })
        .returning()
    )[0]!;
    await db.database.insert(trailAreaLinks).values({
      trailId: namesake.id,
      areaId: parent.id,
      override: 'include',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z'
    });
    await expect(importSelectedTrails({ database: db.database, dryRun: true })).rejects.toThrow(
      'Ambiguous trail name Korpinkierros: linked-korpinkierros'
    );
  });

  it('rolls back the whole batch on a database failure and rejects a stale preview', async () => {
    const before = await db.database.select().from(parks);
    const runs = await db.database.select().from(importRuns);
    await db.client.execute(
      "CREATE TRIGGER reject_selected BEFORE INSERT ON curated_trail_sources WHEN NEW.selection_key = 'visited-trails-2026-07' BEGIN SELECT RAISE(ABORT, 'test failure'); END"
    );
    await expect(importSelectedTrails({ database: db.database })).rejects.toThrow();
    expect(await db.database.select().from(parks)).toEqual(before);
    expect(await db.database.select().from(importRuns)).toEqual(runs);
    expect(await db.database.select().from(curatedTrailSources)).toEqual([]);
    await db.client.execute('DROP TRIGGER reject_selected');
    await expect(
      importSelectedTrails({
        database: db.database,
        beforeApply: async () => {
          await db.database
            .update(parks)
            .set({ name: 'Changed during preview' })
            .where(eq(parks.slug, manifest.selections[0]!.parentSlug));
        }
      })
    ).rejects.toThrow('Catalog changed during import');
    expect(await db.database.select().from(curatedTrailSources)).toEqual([]);
  });

  it('reuses an existing relation and protects accepted geometry, edits and links during refresh', async () => {
    const dataset = await loadSelectedTrails();
    const item = dataset.selections.find((s) => s.selection.osmRelationId === 6425065)!;
    const area = (
      await db.database.select().from(parks).where(eq(parks.slug, item.selection.parentSlug))
    )[0]!;
    const { id: _id, ...copy } = area;
    const prior = (
      await db.database
        .insert(parks)
        .values({
          ...copy,
          lipasId: -1,
          managedByLipasImport: false,
          typeId: 4405,
          slug: 'osm-relation-6425065',
          name: 'Edited name',
          importedName: item.selection.name,
          lengthKm: 9,
          importedLengthKm: 4.5,
          trailPublicationRole: 'area_member',
          removed: true
        })
        .returning()
    )[0]!;
    await db.database
      .insert(osmTrailSources)
      .values({ trailId: prior.id, relationId: 6425065, sourceTimestamp: '2026-01-01T00:00:00Z' });
    await importSelectedTrails({ database: db.database });
    const selected = (await db.database.select().from(parks).where(eq(parks.id, prior.id)))[0]!;
    expect(selected).toMatchObject({ slug: prior.slug, name: 'Edited name', lengthKm: 9 });
    const link = (await db.database.select().from(trailAreaLinks)).find(
      (l) => l.trailId === prior.id
    )!;
    expect(link).toMatchObject({ areaId: area.id, override: 'include' });
    const changedGeometry = { ...item.geometry, features: item.geometry.features.slice(0, 1) };
    const report = await importOsmTrails({
      database: db.database,
      snapshot: {
        timestamp: '2026-12-01T00:00:00Z',
        routes: [
          { id: 6425065, name: 'Changed source', reportedLengthKm: 101, geometry: changedGeometry }
        ]
      }
    });
    expect(report.mergedWarnings).toContain(
      'osm-relation-6425065: OSM 6425065 differs from the selected snapshot; retaining accepted geometry.'
    );
    await reconcileTrailAreas(db.database, new Date().toISOString());
    expect((await db.database.select().from(parks).where(eq(parks.id, prior.id)))[0]).toEqual(
      selected
    );
    expect(
      (await db.database.select().from(trailAreaLinks)).find((l) => l.trailId === prior.id)
    ).toEqual(link);
  });

  it('refuses to convert an existing relation with direct visits and preserves its photo', async () => {
    const selected = (await loadSelectedTrails()).selections.find(
      (s) => s.selection.osmRelationId === 6425065
    )!;
    const area = (
      await db.database.select().from(parks).where(eq(parks.slug, selected.selection.parentSlug))
    )[0]!;
    const { id: _id, ...copy } = area;
    const trail = (
      await db.database
        .insert(parks)
        .values({
          ...copy,
          lipasId: -1,
          managedByLipasImport: false,
          typeId: 4405,
          slug: 'relation-with-visit',
          name: selected.selection.name,
          importedName: selected.selection.name,
          trailPublicationRole: 'independent',
          removed: false
        })
        .returning()
    )[0]!;
    await db.database
      .insert(osmTrailSources)
      .values({ trailId: trail.id, relationId: 6425065, sourceTimestamp: '2026-01-01T00:00:00Z' });
    const visit = await createVisit(db.database, trail.slug, {
      visitedOn: '2026-11-10',
      note: 'Keep this'
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
    const visits = await db.database.select().from(parkVisits);
    const images = await db.database.select().from(visitImages);
    await expect(importSelectedTrails({ database: db.database, dryRun: true })).rejects.toThrow(
      `Standalone trail has visits: ${selected.selection.selectionKey} (${trail.slug}): ${visit.id} on 2026-11-10`
    );
    await expect(importSelectedTrails({ database: db.database })).rejects.toThrow(
      'Standalone trail has visits'
    );
    expect(await db.database.select().from(parkVisits)).toEqual(visits);
    expect(await db.database.select().from(visitImages)).toEqual(images);
    expect(await db.database.select().from(curatedTrailSources)).toEqual([]);
  });

  it('retains visit assignments, photos and administrator edits on rerun and detects stored drift', async () => {
    await importSelectedTrails({ database: db.database });
    const source = (await db.database.select().from(curatedTrailSources))[0]!;
    const trail = (await db.database.select().from(parks).where(eq(parks.id, source.trailId)))[0]!;
    const selected = manifest.selections.find((s) => s.selectionKey === source.selectionKey)!;
    const visit = await createVisit(db.database, selected.parentSlug, {
      visitedOn: '2026-11-10',
      note: 'Keep this',
      trailIds: [trail.id]
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
      .set({ name: 'Oma nimi', lengthKm: 2 })
      .where(eq(parks.id, trail.id));
    const visits = await db.database.select().from(parkVisits);
    const images = await db.database.select().from(visitImages);
    expect((await importSelectedTrails({ database: db.database })).affectedSlugs).toEqual([]);
    expect((await db.database.select().from(parks).where(eq(parks.id, trail.id)))[0]).toMatchObject(
      { name: 'Oma nimi', lengthKm: 2 }
    );
    expect(await db.database.select().from(parkVisits)).toEqual(visits);
    expect(await db.database.select().from(visitImages)).toEqual(images);
    expect(
      (
        await createVisit(db.database, selected.parentSlug, {
          visitedOn: '2026-11-11',
          trailIds: [trail.id]
        })
      ).trails
    ).toMatchObject([{ id: trail.id }]);
    await db.database
      .update(parks)
      .set({
        boundaryGeojson: (
          await db.database.select().from(parks).where(eq(parks.slug, selected.parentSlug))
        )[0]!.boundaryGeojson
      })
      .where(eq(parks.id, trail.id));
    await expect(importSelectedTrails({ database: db.database, dryRun: true })).rejects.toThrow(
      'Stored geometry drift'
    );
  });
  it('selects the Siilastupa branch for Iso Karhunkierros and keeps both branches on Pieni', async () => {
    const { selections } = await loadSelectedTrails();
    const iso = selections.find(({ selection }) => selection.osmRelationId === 1633747)!;
    const pieni = selections.find(({ selection }) => selection.osmRelationId === 1632296)!;
    const southernWays = [
      118603734, 117642972, 1266351320, 117642965, 1266351725, 631281705, 631281706, 631281707,
      1266353181
    ];
    const northernWays = [
      117932199, 117932200, 117631752, 117631769, 117631770, 117631771, 118603731, 118603733
    ];
    const isoWays = iso.provenance.map((feature) => feature.osmWayId);
    const pieniWays = pieni.provenance.map((feature) => feature.osmWayId);
    expect(isoWays).toEqual(expect.arrayContaining(southernWays));
    expect(isoWays.filter((id) => northernWays.includes(Number(id)))).toEqual([]);
    expect(pieniWays).toEqual(expect.arrayContaining([...southernWays, ...northernWays]));
  });

  it('rejects conflicting identities and invalid geometry while accepting catalog additions', () => {
    type Input = {
      selections: Array<{
        selectionKey: string;
        osmRelationId: number | null;
        sourceUrls: string[];
        featureCount: number;
        geometrySha256: string;
      }>;
      features: Array<{
        properties: { selectionKey: string };
        geometry: { type: 'LineString'; coordinates: [number, number][] };
      }>;
    };
    const mutate = (change: (catalog: Input) => void) => {
      const catalog = JSON.parse(catalogText) as Input;
      change(catalog);
      return JSON.stringify(catalog);
    };
    expect(() =>
      parseSelectedTrails(
        mutate((catalog) => {
          catalog.selections[0]!.selectionKey = catalog.selections[1]!.selectionKey;
        })
      )
    ).toThrow('Invalid selected trail identities');
    expect(() =>
      parseSelectedTrails(
        mutate((catalog) => {
          catalog.selections[0]!.sourceUrls = ['https://www.openstreetmap.org/way/1'];
        })
      )
    ).toThrow('Invalid source identity');
    expect(() =>
      parseSelectedTrails(
        mutate((catalog) => {
          catalog.selections[0]!.featureCount += 1;
        })
      )
    ).toThrow('Geometry hash mismatch');
    expect(() =>
      parseSelectedTrails(
        mutate((catalog) => {
          catalog.features[0]!.geometry.coordinates[0]![0] += 0.001;
        })
      )
    ).toThrow('Geometry hash mismatch');
    expect(() =>
      parseSelectedTrails(
        mutate((catalog) => {
          const selection = catalog.selections[0]!;
          const features = catalog.features.filter(
            (feature) => feature.properties.selectionKey === selection.selectionKey
          );
          const geometries = features.map(({ geometry }) => {
            geometry.coordinates = [geometry.coordinates[0]!, geometry.coordinates[0]!];
            return { coordinates: geometry.coordinates, type: geometry.type };
          });
          selection.geometrySha256 = createHash('sha256')
            .update(JSON.stringify(geometries))
            .digest('hex');
        })
      )
    ).toThrow('Invalid selected trail length');
    const expanded = parseSelectedTrails(
      mutate((catalog) => {
        const original = catalog.selections[0]!;
        const selectionKey = 'new-reviewed-trail';
        catalog.selections.push({ ...original, selectionKey });
        catalog.features.push(
          ...catalog.features
            .filter((feature) => feature.properties.selectionKey === original.selectionKey)
            .map((feature) => ({ ...feature, properties: { selectionKey } }))
        );
      })
    );
    expect(expanded.selections).toHaveLength(manifest.selections.length + 1);
  });

  it('adopts existing OSM identities, keeps edited reference links and accepts earlier catalog hashes', async () => {
    const { selections } = await loadSelectedTrails();
    const { id: _id, ...area } = (await db.database.select().from(parks))[0]!;
    const officialRoutes = selections.filter(({ selection }) => selection.referenceUrl);
    const adopted = [];
    for (const [index, { selection }] of officialRoutes.slice(0, 2).entries()) {
      const editedUrl = index === 0 ? null : 'https://example.test/edited-url';
      const [prior] = await db.database
        .insert(parks)
        .values({
          ...area,
          lipasId: -100 - index,
          managedByLipasImport: false,
          slug: `osm-relation-${selection.osmRelationId}`,
          typeId: 4405,
          name: selection.name,
          importedName: selection.name,
          parkUrl: editedUrl,
          importedParkUrl: null,
          lengthKm: 82,
          importedLengthKm: 82,
          trailPublicationRole: 'area_member',
          removed: true
        })
        .returning();
      await db.database.insert(osmTrailSources).values({
        trailId: prior!.id,
        relationId: selection.osmRelationId!,
        sourceTimestamp: '2026-11-10T21:21:39Z'
      });
      adopted.push({
        id: prior!.id,
        name: selection.name,
        lengthKm: selection.initialDisplayLengthKm,
        parkUrl: editedUrl ?? selection.referenceUrl,
        importedParkUrl: selection.referenceUrl
      });
    }
    await importSelectedTrails({ database: db.database });
    for (const expected of adopted)
      expect(
        (await db.database.select().from(parks).where(eq(parks.id, expected.id)))[0]
      ).toMatchObject(expected);
    const owners = await db.database.select().from(curatedTrailSources);
    for (const { selection } of selections) {
      const source = owners.find((owner) => owner.selectionKey === selection.selectionKey)!;
      if (!selection.referenceUrl)
        await db.database
          .update(curatedTrailSources)
          .set({ manifestHash: '1e7245517fab2b653583a8a56fd5ad11d3bf016e4039a49b906e730a62ac' })
          .where(eq(curatedTrailSources.trailId, source.trailId));
    }
    const before = await db.database.select().from(curatedTrailSources);
    expect((await importSelectedTrails({ database: db.database })).affectedSlugs).toEqual([]);
    expect(await db.database.select().from(curatedTrailSources)).toEqual(before);
  });

  it('reports a source drift or an administrator exclusion instead of overwriting it', async () => {
    await importSelectedTrails({ database: db.database });
    const source = (await db.database.select().from(curatedTrailSources))[0]!;
    await db.database
      .update(curatedTrailSources)
      .set({ geometryHash: 'changed' })
      .where(eq(curatedTrailSources.selectionKey, source.selectionKey));
    await expect(importSelectedTrails({ database: db.database })).rejects.toThrow(
      'Selected source drift'
    );
    await db.database
      .update(curatedTrailSources)
      .set({ geometryHash: source.geometryHash })
      .where(eq(curatedTrailSources.selectionKey, source.selectionKey));
    await db.database
      .update(trailAreaLinks)
      .set({ override: 'exclude' })
      .where(eq(trailAreaLinks.trailId, source.trailId));
    await expect(importSelectedTrails({ database: db.database })).rejects.toThrow(
      'Selected link excluded by administrator'
    );
    expect(
      (await db.database.select().from(trailAreaLinks)).find((l) => l.trailId === source.trailId)
        ?.override
    ).toBe('exclude');
  });
  it('adopts an unedited relation, retains other area links, and restores a missing selected link', async () => {
    const item = (await loadSelectedTrails()).selections.find(
      (s) => s.selection.osmRelationId === 2260505
    )!;
    const parent = (
      await db.database.select().from(parks).where(eq(parks.slug, item.selection.parentSlug))
    )[0]!;
    const other = (await db.database.select().from(parks)).find((p) => p.id !== parent.id)!;
    const { id: _id, ...copy } = parent;
    const prior = (
      await db.database
        .insert(parks)
        .values({
          ...copy,
          lipasId: -1,
          managedByLipasImport: false,
          typeId: 4405,
          slug: 'existing-relation',
          name: 'Old source name',
          importedName: 'Old source name',
          lengthKm: 4,
          importedLengthKm: 4,
          trailPublicationRole: 'area_member',
          removed: true
        })
        .returning()
    )[0]!;
    await db.database
      .insert(osmTrailSources)
      .values({ trailId: prior.id, relationId: 2260505, sourceTimestamp: '2026-01-01T00:00:00Z' });
    const timestamp = '2026-01-01T00:00:00Z';
    await db.database.insert(trailAreaLinks).values({
      trailId: prior.id,
      areaId: other.id,
      override: 'include',
      createdAt: timestamp,
      updatedAt: timestamp
    });
    const preview = await importSelectedTrails({ database: db.database, dryRun: true });
    expect(preview.affectedSlugs).toContain(other.slug);
    await importSelectedTrails({ database: db.database });
    expect((await db.database.select().from(parks).where(eq(parks.id, prior.id)))[0]).toMatchObject(
      { name: item.selection.name, lengthKm: item.selection.initialDisplayLengthKm }
    );
    expect(
      (await db.database.select().from(trailAreaLinks)).filter((l) => l.trailId === prior.id)
    ).toHaveLength(2);
    await db.database
      .delete(trailAreaLinks)
      .where(and(eq(trailAreaLinks.trailId, prior.id), eq(trailAreaLinks.areaId, parent.id)));
    expect((await importSelectedTrails({ database: db.database })).affectedSlugs).toContain(
      parent.slug
    );
    expect(
      (await db.database.select().from(trailAreaLinks)).filter((l) => l.trailId === prior.id)
    ).toHaveLength(2);
  });

  it('rejects an occupied selected slug and an inactive existing relation', async () => {
    const first = manifest.selections[0]!;
    const area = (await db.database.select().from(parks))[0]!;
    const { id: _id, ...copy } = area;
    const conflict = (
      await db.database
        .insert(parks)
        .values({ ...copy, slug: `selected-${first.selectionKey}`, lipasId: -500 })
        .returning()
    )[0]!;
    await expect(importSelectedTrails({ database: db.database, dryRun: true })).rejects.toThrow(
      'Conflicting trail slug'
    );
    await db.database.delete(parks).where(eq(parks.id, conflict.id));
    const relation = (
      await db.database
        .insert(parks)
        .values({
          ...copy,
          slug: 'inactive-relation',
          lipasId: -501,
          managedByLipasImport: false,
          typeId: 4405,
          name: 'Old relation',
          catalogStatus: 'inactive'
        })
        .returning()
    )[0]!;
    await db.database.insert(osmTrailSources).values({
      trailId: relation.id,
      relationId: 6425065,
      sourceTimestamp: '2026-01-01T00:00:00Z'
    });
    await expect(importSelectedTrails({ database: db.database, dryRun: true })).rejects.toThrow(
      'Conflicting source trail'
    );
    expect(await db.database.select().from(curatedTrailSources)).toEqual([]);
  });

  it('reports a missing selected relation source and an identity already owned by another selection', async () => {
    await importSelectedTrails({ database: db.database });
    const relation = (
      await db.database
        .select()
        .from(osmTrailSources)
        .where(eq(osmTrailSources.relationId, 6425065))
    )[0]!;
    const owner = (
      await db.database
        .select()
        .from(curatedTrailSources)
        .where(eq(curatedTrailSources.trailId, relation.trailId))
    )[0]!;
    await db.database.delete(osmTrailSources).where(eq(osmTrailSources.trailId, relation.trailId));
    await expect(importSelectedTrails({ database: db.database, dryRun: true })).rejects.toThrow(
      'Missing relation source'
    );
    await db.database.insert(osmTrailSources).values(relation);
    await db.database
      .update(curatedTrailSources)
      .set({ selectionKey: 'another-selection' })
      .where(eq(curatedTrailSources.trailId, relation.trailId));
    await expect(importSelectedTrails({ database: db.database, dryRun: true })).rejects.toThrow(
      'Trail already belongs to another selection'
    );
    expect(
      (
        await db.database
          .select()
          .from(curatedTrailSources)
          .where(eq(curatedTrailSources.trailId, relation.trailId))
      )[0]?.geometryHash
    ).toBe(owner.geometryHash);
  });
  it('aborts an OSM refresh if selected ownership changes during its preview', async () => {
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
    await expect(
      importOsmTrails({
        database: db.database,
        snapshot,
        beforeApply: async () => {
          await importSelectedTrails({ database: db.database });
        }
      })
    ).rejects.toThrow('Selected trail ownership changed during import');
    expect(await db.database.select().from(curatedTrailSources)).toHaveLength(
      manifest.selections.length
    );
    expect(
      await db.database.select().from(osmTrailSources).where(eq(osmTrailSources.relationId, 12345))
    ).toEqual([]);
  });
  it('preserves all selected memberships through LIPAS and special area refreshes', async () => {
    const slugs = [...new Set(manifest.selections.map((s) => s.parentSlug))];
    await db.database
      .update(parks)
      .set({ managedByLipasImport: false })
      .where(inArray(parks.slug, slugs));
    await importSelectedTrails({ database: db.database });
    const links = await db.database.select().from(trailAreaLinks);
    const selected = await db.database.select().from(curatedTrailSources);
    await importParks({
      database: db.database,
      sourceUrl: 'https://example.test',
      fetchSource: async () => ({ items: [createLipasPark()] })
    });
    await importSpecialParks({
      database: db.database,
      includeSlugs: ['paistjarvi'],
      fetchSource: createSpecialParksSource()
    });
    expect(await db.database.select().from(curatedTrailSources)).toEqual(selected);
    expect(await db.database.select().from(trailAreaLinks)).toEqual(links);
  });
  it('makes selected way trails eligible for admin search and overrides without extending relation merges', async () => {
    await importSelectedTrails({ database: db.database });
    const selected = manifest.selections.find((s) => s.osmRelationId === null)!;
    const source = (
      await db.database
        .select()
        .from(curatedTrailSources)
        .where(eq(curatedTrailSources.selectionKey, selected.selectionKey))
    )[0]!;
    const trail = (await db.database.select().from(parks).where(eq(parks.id, source.trailId)))[0]!;
    expect(
      (await listAreaTrailCandidates(db.database, selected.name, 10, 0)).trails
    ).toContainEqual({ trailId: trail.id, name: trail.name, slug: trail.slug });
    expect(await listTrailAreas(db.database, trail.slug)).toContainEqual({
      name: selected.parentSlug,
      slug: selected.parentSlug
    });
    const other = manifest.selections.find((s) => s.parentSlug !== selected.parentSlug)!;
    expect(
      await setAreaTrailOverride(db.database, other.parentSlug, trail.id, 'include')
    ).toMatchObject({ effective: true, override: 'include' });
    const relations = await db.database.select().from(osmTrailSources);
    const relationParks = await Promise.all(
      relations.map(
        async (row) => (await db.database.select().from(parks).where(eq(parks.id, row.trailId)))[0]!
      )
    );
    await expect(
      mergeTrails(db.database, {
        fromSlug: relationParks[0]!.slug,
        toSlug: relationParks[1]!.slug,
        dryRun: true
      })
    ).rejects.toThrow('Selected trail snapshots cannot be merged');
  });
  it('allows unrelated OSM discovery after the selected batch is installed', async () => {
    await importSelectedTrails({ database: db.database });
    const result = await importOsmTrails({
      database: db.database,
      snapshot: {
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
      }
    });
    expect(result.changedIds).toContain(12345);
    expect(await db.database.select().from(curatedTrailSources)).toHaveLength(
      manifest.selections.length
    );
  });
});
