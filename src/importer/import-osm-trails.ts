import { and, eq, getTableColumns, inArray, isNull, sql } from 'drizzle-orm';
import proj4 from 'proj4';
import type { Database } from '../db/database.js';
import {
  importRuns,
  osmTrailSources,
  parks,
  publicDataVersions,
  trailAreaLinks
} from '../db/schema.js';
import { isTrailTypeCode } from '../parks/park-types.js';
import { deriveBoundingBox, type GeoJsonFeatureCollection } from './geometry.js';
import {
  exceedsTrailLengthLimit,
  measureTrailAreaOverlap,
  measureTrailLengthKm,
  qualifiesTrailAreaOverlap
} from './trail-area-geometry.js';

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
const projection = '+proj=utm +zone=35 +ellps=GRS80 +units=m +no_defs';
const model = (geometry: GeoJsonFeatureCollection) => {
  const grid = new Map<string, number[][]>();
  const samples: { x: number; y: number; weight: number }[] = [];
  let length = 0;
  for (const feature of geometry.features) {
    if (feature.geometry.type !== 'LineString') continue;
    const points = feature.geometry.coordinates.map((point) =>
      proj4('WGS84', projection, point.slice(0, 2))
    );
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      const distance = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!);
      if (!distance) continue;
      const pieces = Math.ceil(distance / 100);
      for (let k = 0; k < pieces; k++) {
        const x1 = a[0]! + (k / pieces) * (b[0]! - a[0]!);
        const y1 = a[1]! + (k / pieces) * (b[1]! - a[1]!);
        const x2 = a[0]! + ((k + 1) / pieces) * (b[0]! - a[0]!);
        const y2 = a[1]! + ((k + 1) / pieces) * (b[1]! - a[1]!);
        const segment = [x1, y1, x2, y2];
        for (
          let x = Math.floor((Math.min(x1, x2) - 25) / 100);
          x <= Math.floor((Math.max(x1, x2) + 25) / 100);
          x++
        )
          for (
            let y = Math.floor((Math.min(y1, y2) - 25) / 100);
            y <= Math.floor((Math.max(y1, y2) + 25) / 100);
            y++
          ) {
            const key = `${x}:${y}`;
            const entries = grid.get(key) ?? [];
            entries.push(segment);
            grid.set(key, entries);
          }
      }
      length += distance;
      const n = Math.ceil(distance / 50);
      for (let j = 0; j < n; j++) {
        const t = (j + 0.5) / n;
        samples.push({
          x: a[0]! + t * (b[0]! - a[0]!),
          y: a[1]! + t * (b[1]! - a[1]!),
          weight: distance / n
        });
      }
    }
  }
  return { grid, samples, length };
};
const coverage = (a: ReturnType<typeof model>, b: ReturnType<typeof model>) => {
  let matched = 0;
  for (const p of a.samples)
    for (const s of b.grid.get(`${Math.floor(p.x / 100)}:${Math.floor(p.y / 100)}`) ?? []) {
      const dx = s[2]! - s[0]!;
      const dy = s[3]! - s[1]!;
      const t = Math.max(
        0,
        Math.min(1, ((p.x - s[0]!) * dx + (p.y - s[1]!) * dy) / (dx * dx + dy * dy))
      );
      if ((p.x - s[0]! - t * dx) ** 2 + (p.y - s[1]! - t * dy) ** 2 <= 625) {
        matched += p.weight;
        break;
      }
    }
  return matched / a.length;
};
const overlaps = (
  a: ReturnType<typeof deriveBoundingBox>,
  b: ReturnType<typeof deriveBoundingBox>
) =>
  a.minLon <= b.maxLon + 0.001 &&
  a.maxLon + 0.001 >= b.minLon &&
  a.minLat <= b.maxLat + 0.001 &&
  a.maxLat + 0.001 >= b.minLat;

export const importOsmTrails = async ({
  database,
  snapshot,
  dryRun = false,
  beforeApply = async () => {}
}: {
  database: Database;
  snapshot: OsmSnapshot;
  dryRun?: boolean;
  beforeApply?: () => Promise<void>;
}) => {
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
    .filter(
      (p) =>
        p.catalogStatus === 'active' &&
        isTrailTypeCode(p.typeId) &&
        !exceedsTrailLengthLimit(
          measureTrailLengthKm(JSON.parse(p.boundaryGeojson) as GeoJsonFeatureCollection),
          p.lengthKm
        )
    )
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
  const retire: (typeof records)[number][] = [];
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
    const effective =
      prior && prior.lengthKm !== prior.importedLengthKm ? prior.lengthKm : route.reportedLengthKm;
    const reject = (reason: string, containingTrails: string[] = []) =>
      excluded.push({ id: route.id, name: route.name, reason, containingTrails });
    if (exceedsTrailLengthLimit(length, effective)) {
      if (prior?.catalogStatus === 'active') retire.push(prior);
      reject('over-100km');
      continue;
    }
    if (length === null) {
      reject('invalid-geometry');
      continue;
    }
    const matches = areas
      .filter((a) => overlaps(bounds, a.bounds))
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
    const nearby = stored.filter((s) => s.park.id !== prior?.id && overlaps(bounds, s.bounds));
    const names = new Set([route.name, ...(route.aliases ?? [])].map(norm));
    const matchingNames = nearby
      .filter((s) => names.has(norm(s.park.name)))
      .map((s) => s.park.name);
    const routeModel = model(route.geometry);
    const containing = nearby
      .filter((s) => coverage(routeModel, model(s.geometry)) >= 0.9)
      .map((s) => s.park.name);
    const previous = imported
      .filter(
        (s) =>
          overlaps(bounds, deriveBoundingBox(s.route.geometry)) &&
          ([s.name, ...(s.route.aliases ?? [])].some((name) => names.has(norm(name))) ||
            coverage(routeModel, model(s.route.geometry)) >= 0.9)
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
  if (!dryRun && (changed.length || retire.length)) {
    await beforeApply();
    await database.transaction(async (tx) => {
      const timestamp = new Date().toISOString();
      const run = (
        await tx
          .insert(importRuns)
          .values({
            sourceUrl: 'https://www.openstreetmap.org/',
            activeCount: changed.length + retire.length,
            importedAt: timestamp,
            responseShapeVersion: 'osm-linked-trails-v1'
          })
          .returning({ id: importRuns.id })
      )[0]!;
      for (const prior of retire) {
        const updated = await tx
          .update(parks)
          .set({ catalogStatus: 'inactive', removed: true, updatedAt: timestamp })
          .where(
            and(
              eq(parks.id, prior.id),
              sql`${parks.lengthKm} IS ${prior.lengthKm}`,
              sql`${parks.importedLengthKm} IS ${prior.importedLengthKm}`,
              sql`${parks.boundaryGeojson} IS ${prior.boundaryGeojson}`,
              eq(parks.catalogStatus, prior.catalogStatus)
            )
          )
          .returning({ id: parks.id });
        if (!updated.length)
          throw new Error(`Trail ${prior.slug} changed during import; retry the dry run.`);
      }
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
      }),
      ...retire.flatMap((trail) =>
        links
          .filter((link) => link.trailId === trail.id)
          .flatMap((link) => {
            const area = records.find((record) => record.id === link.areaId)!;
            return [area.slug];
          })
      )
    ])
  ];
  return {
    imported,
    excluded,
    affectedSlugs,
    changedIds: changed.map((item) => item.id),
    retiredIds: retire.flatMap((trail) =>
      sources.filter((source) => source.trailId === trail.id).map((source) => source.relationId)
    )
  };
};
