import { and, eq, getTableColumns, inArray, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/database.js';
import {
  curatedTrailSources,
  importRuns,
  osmTrailSources,
  parks,
  publicDataVersions,
  trailAreaLinks
} from '../db/schema.js';
import { isTrailTypeCode } from '../parks/park-types.js';
import { deriveBoundingBox, type GeoJsonFeatureCollection } from './geometry.js';
import { applyMergedTrailRefresh, prepareMergedTrailRefresh } from './refresh-merged-trails.js';
import {
  measureTrailAreaOverlap,
  measureTrailLengthKm,
  qualifiesTrailAreaOverlap
} from './trail-area-geometry.js';
import { buildTrailProximity, measureTrailCoverage, nearbyTrailBounds } from './trail-proximity.js';

export type OsmRoute = {
  id: number;
  name: string;
  aliases?: string[] | undefined;
  reportedLengthKm: number | null;
  geometry: GeoJsonFeatureCollection;
};
export type OsmSnapshot = { timestamp: string; routes: OsmRoute[] };
const norm = (s: string) =>
  s
    .normalize('NFKC')
    .toLocaleLowerCase('fi')
    .replace(/[^\p{L}\p{N}]+/gu, '');
export const importOsmTrails = async ({
  database,
  snapshot: incomingSnapshot,
  dryRun = false,
  beforeApply = async () => {}
}: {
  database: Database;
  snapshot: OsmSnapshot;
  dryRun?: boolean;
  beforeApply?: () => Promise<void>;
}) => {
  const selected = await database
    .select({ trailId: curatedTrailSources.trailId })
    .from(curatedTrailSources);
  const selectedIds = new Set(selected.map((row) => row.trailId));
  const selectedRelations = (await database.select().from(osmTrailSources)).filter((source) =>
    selectedIds.has(source.trailId)
  );
  const selectedByRelation = new Map(
    selectedRelations.map((source) => [source.relationId, source.trailId])
  );
  const snapshot = {
    ...incomingSnapshot,
    routes: incomingSnapshot.routes.filter((route) => !selectedByRelation.has(route.id))
  };
  const mergedRefresh = await prepareMergedTrailRefresh(database, snapshot);
  const { boundaryGeojson: geometryColumn, ...columns } = getTableColumns(parks);
  const metadata = await database
    .select({ ...columns, geometryBytes: sql<number>`length(cast(${geometryColumn} as blob))` })
    .from(parks);
  const geometries = new Map<number, string>();
  let batch: number[] = [];
  let bytes = 0;
  const flush = async () => {
    for (const row of await database
      .select({ id: parks.id, geometry: parks.boundaryGeojson })
      .from(parks)
      .where(inArray(parks.id, batch)))
      geometries.set(row.id, row.geometry);
    batch = [];
    bytes = 0;
  };
  for (const row of metadata) {
    if (batch.length && (batch.length >= 50 || bytes + row.geometryBytes > 2 * 1024 * 1024))
      await flush();
    batch.push(row.id);
    bytes += row.geometryBytes;
  }
  if (batch.length) await flush();
  const records = metadata.map(({ geometryBytes: _geometryBytes, ...row }) => ({
    ...row,
    boundaryGeojson: geometries.get(row.id)!
  }));
  const selectedWarnings = incomingSnapshot.routes.flatMap((route) => {
    const trail = records.find((park) => park.id === selectedByRelation.get(route.id));
    return trail && trail.boundaryGeojson !== JSON.stringify(route.geometry)
      ? [
          `${trail.slug}: OSM ${route.id} differs from the selected snapshot; retaining accepted geometry.`
        ]
      : [];
  });
  const sources = await database.select().from(osmTrailSources);
  const byRelation = new Map(
    sources.map((s) => [s.relationId, records.find((p) => p.id === s.trailId)!])
  );
  const areas = records
    .filter((p) => p.catalogStatus === 'active' && !isTrailTypeCode(p.typeId))
    .map((p) => ({
      park: p,
      geometry: JSON.parse(p.boundaryGeojson) as GeoJsonFeatureCollection,
      bounds: {
        minLon: p.bboxMinLon,
        minLat: p.bboxMinLat,
        maxLon: p.bboxMaxLon,
        maxLat: p.bboxMaxLat
      }
    }));
  const stored = records
    .filter((p) => p.catalogStatus === 'active' && isTrailTypeCode(p.typeId))
    .map((p) => ({
      park: p,
      geometry: JSON.parse(p.boundaryGeojson) as GeoJsonFeatureCollection,
      bounds: {
        minLon: p.bboxMinLon,
        minLat: p.bboxMinLat,
        maxLon: p.bboxMaxLon,
        maxLat: p.bboxMaxLat
      }
    }));
  const excluded: { id: number; name: string; reason: string; containingTrails: string[] }[] = [];
  const imported: {
    id: number;
    name: string;
    areas: string[];
    route: OsmRoute;
    length: number;
    matches: {
      area: (typeof areas)[number];
      overlap: Extract<ReturnType<typeof measureTrailAreaOverlap>, { status: 'ok' }>;
    }[];
  }[] = [];
  const prepared = snapshot.routes
    .map((route) => ({
      route,
      length: measureTrailLengthKm(route.geometry),
      bounds: deriveBoundingBox(route.geometry)
    }))
    .sort((a, b) => (b.length ?? 0) - (a.length ?? 0) || a.route.id - b.route.id);
  for (const { route, length, bounds } of prepared) {
    const prior = byRelation.get(route.id);
    if (prior && mergedRefresh.memberIds.includes(prior.id)) continue;
    const reject = (reason: string, containingTrails: string[] = []) =>
      excluded.push({ id: route.id, name: route.name, reason, containingTrails });
    if (length === null) {
      reject('invalid-geometry');
      continue;
    }
    const matches = areas
      .filter((a) => nearbyTrailBounds(bounds, a.bounds))
      .flatMap((area) => {
        const overlap = measureTrailAreaOverlap(route.geometry, area.geometry);
        return overlap.status === 'ok' && qualifiesTrailAreaOverlap(overlap.ratio)
          ? [{ area, overlap }]
          : [];
      });
    if (!matches.length) {
      reject('no-area');
      continue;
    }
    const nearby = stored.filter(
      (s) => s.park.id !== prior?.id && nearbyTrailBounds(bounds, s.bounds)
    );
    const names = new Set([route.name, ...(route.aliases ?? [])].map(norm));
    const matchingNames = nearby
      .filter((s) => names.has(norm(s.park.name)))
      .map((s) => s.park.name);
    const routeModel = buildTrailProximity(route.geometry);
    const containing = nearby
      .filter((s) => measureTrailCoverage(routeModel, buildTrailProximity(s.geometry)) >= 0.9)
      .map((s) => s.park.name);
    const previous = imported
      .filter(
        (s) =>
          nearbyTrailBounds(bounds, deriveBoundingBox(s.route.geometry)) &&
          ([s.name, ...(s.route.aliases ?? [])].some((name) => names.has(norm(name))) ||
            measureTrailCoverage(routeModel, buildTrailProximity(s.route.geometry)) >= 0.9)
      )
      .map((s) => s.name);
    const existing = [...new Set([...matchingNames, ...containing, ...previous])];
    if (existing.length) {
      reject('duplicate-or-contained', existing);
      continue;
    }
    imported.push({
      id: route.id,
      name: route.name,
      areas: matches.map((m) => m.area.park.slug),
      route,
      length,
      matches
    });
  }
  imported.sort(
    (a, b) =>
      Number(b.matches.some((m) => m.area.park.typeId === 111)) -
        Number(a.matches.some((m) => m.area.park.typeId === 111)) ||
      a.name.localeCompare(b.name, 'fi')
  );
  const links = await database.select().from(trailAreaLinks);
  const changed = imported.filter((item) => {
    const prior = byRelation.get(item.id);
    if (!prior) return true;
    const source = sources.find((s) => s.relationId === item.id)!;
    const expectedName = prior.name === prior.importedName ? item.name : prior.name;
    const expectedLength =
      prior.lengthKm === prior.importedLengthKm ? item.route.reportedLengthKm : prior.lengthKm;
    if (
      prior.catalogStatus !== 'active' ||
      prior.name !== expectedName ||
      prior.importedName !== item.name ||
      prior.lengthKm !== expectedLength ||
      prior.importedLengthKm !== item.route.reportedLengthKm ||
      prior.boundaryGeojson !== JSON.stringify(item.route.geometry) ||
      source.sourceTimestamp !== snapshot.timestamp
    )
      return true;
    const matchedIds = new Set(item.matches.map(({ area }) => area.park.id));
    if (
      links.some(
        (link) => link.trailId === prior.id && link.automaticMatch && !matchedIds.has(link.areaId)
      )
    )
      return true;
    return item.matches.some(({ area, overlap }) => {
      const link = links.find((l) => l.trailId === prior.id && l.areaId === area.park.id);
      return (
        !link?.automaticMatch ||
        link.overlapMetres !== overlap.overlapMetres ||
        link.routeMetres !== overlap.routeMetres ||
        link.overlapRatio !== overlap.ratio
      );
    });
  });
  if (!dryRun && (changed.length || mergedRefresh.plans.length)) {
    await beforeApply();
    await database.transaction(async (tx) => {
      const currentSelected = await tx
        .select({ trailId: curatedTrailSources.trailId })
        .from(curatedTrailSources);
      if (
        JSON.stringify(currentSelected.map((row) => row.trailId).sort((a, b) => a - b)) !==
        JSON.stringify(selected.map((row) => row.trailId).sort((a, b) => a - b))
      )
        throw new Error('Selected trail ownership changed during import; retry the dry run.');
      if (
        JSON.stringify(await prepareMergedTrailRefresh(tx, snapshot)) !==
        JSON.stringify(mergedRefresh)
      )
        throw new Error('Merged trail data changed during import; retry the dry run.');
      const timestamp = new Date().toISOString();
      const run = (
        await tx
          .insert(importRuns)
          .values({
            sourceUrl: 'https://www.openstreetmap.org/',
            activeCount: changed.length + mergedRefresh.plans.length,
            importedAt: timestamp,
            responseShapeVersion: 'osm-linked-trails-v1'
          })
          .returning({ id: importRuns.id })
      )[0]!;
      let nextId = Math.min(0, ...records.map((p) => p.lipasId)) - 1;
      for (const item of changed) {
        const prior = byRelation.get(item.id);
        const bounds = deriveBoundingBox(item.route.geometry);
        let trailId = prior?.id;
        if (!prior) {
          const row = (
            await tx
              .insert(parks)
              .values({
                lipasId: nextId--,
                managedByLipasImport: false,
                typeId: 4405,
                slug: `osm-relation-${item.id}`,
                name: item.name,
                importedName: item.name,
                lengthKm: item.route.reportedLengthKm,
                importedLengthKm: item.route.reportedLengthKm,
                locationLabel: item.name,
                boundaryGeojson: JSON.stringify(item.route.geometry),
                bboxMinLon: bounds.minLon,
                bboxMinLat: bounds.minLat,
                bboxMaxLon: bounds.maxLon,
                bboxMaxLat: bounds.maxLat,
                markerLon: bounds.minLon,
                markerLat: bounds.minLat,
                catalogStatus: 'active',
                trailPublicationRole: 'area_member',
                removed: true,
                lastImportRunId: run.id,
                createdAt: timestamp,
                updatedAt: timestamp
              })
              .returning({ id: parks.id })
          )[0]!;
          trailId = row.id;
          await tx
            .insert(osmTrailSources)
            .values({ trailId, relationId: item.id, sourceTimestamp: snapshot.timestamp });
        } else {
          const updated = await tx
            .update(parks)
            .set({
              catalogStatus: 'active',
              name: prior.name === prior.importedName ? item.name : prior.name,
              importedName: item.name,
              lengthKm:
                prior.lengthKm === prior.importedLengthKm
                  ? item.route.reportedLengthKm
                  : prior.lengthKm,
              importedLengthKm: item.route.reportedLengthKm,
              boundaryGeojson: JSON.stringify(item.route.geometry),
              bboxMinLon: bounds.minLon,
              bboxMinLat: bounds.minLat,
              bboxMaxLon: bounds.maxLon,
              bboxMaxLat: bounds.maxLat,
              updatedAt: timestamp
            })
            .where(
              and(
                eq(parks.id, prior.id),
                sql`${parks.name} IS ${prior.name}`,
                sql`${parks.importedName} IS ${prior.importedName}`,
                sql`${parks.lengthKm} IS ${prior.lengthKm}`,
                sql`${parks.importedLengthKm} IS ${prior.importedLengthKm}`,
                sql`${parks.boundaryGeojson} IS ${prior.boundaryGeojson}`,
                eq(parks.catalogStatus, prior.catalogStatus)
              )
            )
            .returning({ id: parks.id });
          if (!updated.length)
            throw new Error(`Trail ${prior.slug} changed during import; retry the dry run.`);
          await tx
            .update(osmTrailSources)
            .set({ sourceTimestamp: snapshot.timestamp })
            .where(eq(osmTrailSources.trailId, prior.id));
        }
        if (prior) {
          const matchedIds = new Set(item.matches.map(({ area }) => area.park.id));
          for (const link of links.filter(
            (row) => row.trailId === prior.id && row.automaticMatch && !matchedIds.has(row.areaId)
          )) {
            const pair = and(
              eq(trailAreaLinks.trailId, prior.id),
              eq(trailAreaLinks.areaId, link.areaId)
            );
            if (link.override)
              await tx
                .update(trailAreaLinks)
                .set({ automaticMatch: false, updatedAt: timestamp })
                .where(pair);
            else await tx.delete(trailAreaLinks).where(and(pair, isNull(trailAreaLinks.override)));
          }
        }
        for (const { area, overlap } of item.matches)
          await tx
            .insert(trailAreaLinks)
            .values({
              trailId: trailId!,
              areaId: area.park.id,
              automaticMatch: true,
              overlapMetres: overlap.overlapMetres,
              routeMetres: overlap.routeMetres,
              overlapRatio: overlap.ratio,
              calculationMethod: 'jsts-wgs84-clip-epsg3067-v3',
              geometryQuality: 'valid',
              createdAt: timestamp,
              updatedAt: timestamp
            })
            .onConflictDoUpdate({
              target: [trailAreaLinks.trailId, trailAreaLinks.areaId],
              set: {
                automaticMatch: true,
                overlapMetres: overlap.overlapMetres,
                routeMetres: overlap.routeMetres,
                overlapRatio: overlap.ratio,
                updatedAt: timestamp
              }
            });
      }
      await applyMergedTrailRefresh(tx, mergedRefresh, timestamp);
      await tx
        .insert(publicDataVersions)
        .values({ key: 'public-visits', version: 1, updatedAt: timestamp })
        .onConflictDoUpdate({
          target: publicDataVersions.key,
          set: { version: sql`${publicDataVersions.version}+1`, updatedAt: timestamp }
        });
    });
  }
  const affectedSlugs = [
    ...new Set([
      ...mergedRefresh.plans.flatMap((plan) => plan.affectedSlugs),
      ...changed.flatMap((item) => {
        const prior = byRelation.get(item.id);
        return [
          ...item.areas,
          ...links
            .filter((link) => link.trailId === prior?.id)
            .flatMap((link) => {
              const area = records.find((record) => record.id === link.areaId)!;
              return [area.slug];
            })
        ];
      })
    ])
  ];
  return {
    mergedTrails: mergedRefresh.plans.map((plan) => ({
      slug: plan.canonical.slug,
      name: plan.canonical.name,
      lengthKm: plan.lengthKm
    })),
    mergedWarnings: [...mergedRefresh.warnings, ...selectedWarnings],
    imported,
    excluded,
    affectedSlugs,
    changedIds: changed.map((item) => item.id)
  };
};
