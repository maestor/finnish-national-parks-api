import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { eq, getTableColumns, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database, DbClient } from '../db/database.js';
import {
  curatedTrailSources,
  importRuns,
  osmTrailSources,
  parks,
  parkVisits,
  publicDataVersions,
  trailAreaLinks,
  trailMergeMembers
} from '../db/schema.js';
import { isTrailTypeCode } from '../parks/park-types.js';
import { deriveBoundingBox, type GeoJsonFeatureCollection } from './geometry.js';
import { exceedsTrailLengthLimit, measureTrailLengthKm } from './trail-area-geometry.js';

const selectionSchema = z
  .object({
    selectionKey: z.string().regex(/^visited-trails-2026-\d{2}$/),
    name: z.string().min(1),
    parentSlug: z.string().min(1),
    sourceKind: z.enum(['osm-relation', 'osm-way-selection']),
    osmRelationId: z.number().int().positive().nullable(),
    osmWayIds: z.array(z.number().int().positive()),
    sourceUrls: z.array(z.string().url()).min(1),
    sourceTimestamp: z.iso.datetime(),
    geometrySha256: z.string().regex(/^[a-f0-9]{64}$/),
    featureCount: z.number().int().positive(),
    requestedLengthKm: z.number().nonnegative().nullable(),
    measuredUniqueLengthKm: z.number().nonnegative(),
    walkLengthKm: z.number().nonnegative().nullable(),
    initialDisplayLengthKm: z.number().nonnegative().nullable()
  })
  .passthrough();
const manifestSchema = z.object({ selections: z.array(selectionSchema).length(27) });
const coordinate = z
  .tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])
  .rest(z.number());
const geometrySchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(
    z
      .object({
        type: z.literal('Feature'),
        properties: z.object({ selectionKey: z.string() }).passthrough(),
        geometry: z.object({
          type: z.literal('LineString'),
          coordinates: z.array(coordinate).min(2)
        })
      })
      .passthrough()
  )
});
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const datasetUrl = new URL('./selected-trails/', import.meta.url);

export const parseSelectedTrails = (manifestText: string, geoText: string) => {
  const manifest = manifestSchema.parse(JSON.parse(manifestText));
  const geo = geometrySchema.parse(JSON.parse(geoText));
  const keys = new Set(manifest.selections.map((s) => s.selectionKey));
  const relations = manifest.selections.filter((s) => s.sourceKind === 'osm-relation');
  if (
    keys.size !== 27 ||
    new Set(manifest.selections.map((s) => s.parentSlug)).size !== 11 ||
    relations.length !== 2 ||
    new Set(relations.map((s) => s.osmRelationId)).size !== 2 ||
    geo.features.some((f) => !keys.has(f.properties.selectionKey))
  )
    throw new Error('Invalid selected trail identities or parents.');
  const selections = manifest.selections.map((selection) => {
    const expectedUrls =
      selection.sourceKind === 'osm-relation'
        ? [`https://www.openstreetmap.org/relation/${selection.osmRelationId}`]
        : selection.osmWayIds.map((id) => `https://www.openstreetmap.org/way/${id}`);
    if (
      (selection.sourceKind === 'osm-relation'
        ? selection.osmRelationId === null
        : selection.osmRelationId !== null || !selection.osmWayIds.length) ||
      JSON.stringify(selection.sourceUrls) !== JSON.stringify(expectedUrls) ||
      new Set(selection.osmWayIds).size !== selection.osmWayIds.length
    )
      throw new Error(`Invalid source identity: ${selection.selectionKey}`);
    const features = geo.features.filter(
      (f) => f.properties.selectionKey === selection.selectionKey
    );
    const geometries = features.map((f) => ({
      coordinates: f.geometry.coordinates,
      type: f.geometry.type
    }));
    if (
      features.length !== selection.featureCount ||
      hash(JSON.stringify(geometries)) !== selection.geometrySha256
    )
      throw new Error(`Geometry hash mismatch: ${selection.selectionKey}`);
    const geometry: GeoJsonFeatureCollection = {
      type: 'FeatureCollection',
      features: geometries.map((g) => ({ type: 'Feature', geometry: g }))
    };
    const length = measureTrailLengthKm(geometry);
    if (length === null || exceedsTrailLengthLimit(length, selection.initialDisplayLengthKm))
      throw new Error(`Invalid selected trail length: ${selection.selectionKey}`);
    return {
      selection,
      geometry,
      provenance: features.map((feature) => feature.properties),
      bounds: deriveBoundingBox(geometry)
    };
  });
  if (hash(manifestText) !== '1e7245517fab2b653583a8a56fd5ad11d3bf016e4039a49b906e730a395a62ac')
    throw new Error('Selected trail manifest hash mismatch.');
  const snapshotHash = hash(geoText);
  if (snapshotHash !== 'bfd5bf293e6aec1e2ca8a8eea139a2e58f49a2947bb563006a67ed3c270ebfed')
    throw new Error('Selected trail snapshot hash mismatch.');
  return { manifestHash: hash(manifestText), snapshotHash, selections };
};

export const loadSelectedTrails = async () => {
  const [manifestText, geoText] = await Promise.all([
    readFile(new URL('selected-trails-27.json', datasetUrl), 'utf8'),
    readFile(new URL('selected-trails-27.geojson', datasetUrl), 'utf8')
  ]);
  return parseSelectedTrails(manifestText, geoText);
};

type Dataset = Awaited<ReturnType<typeof loadSelectedTrails>>;
const prepare = async (database: DbClient, dataset: Dataset) => {
  const { boundaryGeojson: _geometryColumn, ...columns } = getTableColumns(parks);
  const records = await database.select(columns).from(parks);
  const sources = await database.select().from(osmTrailSources);
  const curated = await database.select().from(curatedTrailSources);
  const selectedRelationIds = new Set(
    dataset.selections.flatMap(({ selection }) =>
      selection.osmRelationId === null ? [] : [selection.osmRelationId]
    )
  );
  const priorIds = new Set([
    ...curated.map((source) => source.trailId),
    ...sources
      .filter((source) => selectedRelationIds.has(source.relationId))
      .map((source) => source.trailId)
  ]);
  const priorGeometries = new Map<number, string>();
  for (const id of priorIds) {
    const row = (
      await database
        .select({ geometry: parks.boundaryGeojson })
        .from(parks)
        .where(eq(parks.id, id))
        .limit(1)
    )[0];
    priorGeometries.set(id, row!.geometry);
  }
  const links = await database.select().from(trailAreaLinks);
  const visits = await database
    .select({ id: parkVisits.id, parkId: parkVisits.parkId, visitedOn: parkVisits.visitedOn })
    .from(parkVisits);
  const members = await database.select().from(trailMergeMembers);
  const actions = dataset.selections.map((item) => {
    const { selection } = item;
    const area = records.find((p) => p.slug === selection.parentSlug);
    if (area?.catalogStatus !== 'active' || isTrailTypeCode(area.typeId))
      throw new Error(`Missing or inactive parent: ${selection.parentSlug}`);
    const owner = curated.find((s) => s.selectionKey === selection.selectionKey);
    const relation =
      selection.osmRelationId === null
        ? undefined
        : sources.find((s) => s.relationId === selection.osmRelationId);
    if (
      owner &&
      (owner.sourceKind !== selection.sourceKind ||
        owner.geometryHash !== selection.geometrySha256 ||
        owner.manifestHash !== dataset.manifestHash ||
        owner.sourceTimestamp !== selection.sourceTimestamp ||
        owner.sourceUrlsJson !== JSON.stringify(selection.sourceUrls) ||
        owner.provenanceJson !== JSON.stringify({ ...selection, features: item.provenance }) ||
        (relation && relation.trailId !== owner.trailId))
    )
      throw new Error(`Selected source drift: ${selection.selectionKey}`);
    if (owner && selection.osmRelationId !== null && !relation)
      throw new Error(`Missing relation source: ${selection.selectionKey}`);
    const prior = records.find((p) => p.id === (owner?.trailId ?? relation?.trailId));
    if (
      prior &&
      curated.some((s) => s.trailId === prior.id && s.selectionKey !== selection.selectionKey)
    )
      throw new Error(`Trail already belongs to another selection: ${selection.selectionKey}`);
    if (owner && prior) {
      const stored = JSON.parse(priorGeometries.get(prior.id)!) as GeoJsonFeatureCollection;
      const geometries = stored.features.map((feature) =>
        feature.geometry.type === 'LineString'
          ? { coordinates: feature.geometry.coordinates, type: feature.geometry.type }
          : feature.geometry
      );
      if (hash(JSON.stringify(geometries)) !== selection.geometrySha256)
        throw new Error(`Stored geometry drift: ${selection.selectionKey}`);
    }
    if (
      prior &&
      (!isTrailTypeCode(prior.typeId) ||
        prior.managedByLipasImport ||
        prior.catalogStatus !== 'active' ||
        members.some((m) => m.trailId === prior.id || m.canonicalTrailId === prior.id))
    )
      throw new Error(`Conflicting source trail: ${selection.selectionKey}`);
    const directVisits =
      prior?.trailPublicationRole === 'independent'
        ? visits.filter((visit) => visit.parkId === prior.id)
        : [];
    if (directVisits.length)
      throw new Error(
        `Standalone trail has visits: ${selection.selectionKey} (${prior!.slug}): ${directVisits.map((visit) => `${visit.id} on ${visit.visitedOn}`).join(', ')}`
      );
    const namesakes = records.filter(
      (p) =>
        p.id !== prior?.id &&
        p.name.toLocaleLowerCase('fi') === selection.name.toLocaleLowerCase('fi') &&
        isTrailTypeCode(p.typeId)
    );
    // These margins conservatively cover at least 10 km in Finland. A name
    // alone is not an identity: only local or explicitly linked namesakes
    // require a preservation decision before importing this selection.
    const couldBeSameTrail = (p: (typeof records)[number]) =>
      (p.bboxMinLon <= item.bounds.maxLon + 0.3 &&
        p.bboxMaxLon >= item.bounds.minLon - 0.3 &&
        p.bboxMinLat <= item.bounds.maxLat + 0.1 &&
        p.bboxMaxLat >= item.bounds.minLat - 0.1) ||
      links.some((link) => link.trailId === p.id && link.areaId === area.id);
    const collision = namesakes.find(couldBeSameTrail);
    if (!owner && collision)
      throw new Error(`Ambiguous trail name ${selection.name}: ${collision.slug}`);
    const distantNamesakes = namesakes
      .filter((park) => !couldBeSameTrail(park))
      .map((park) => ({ id: park.id, slug: park.slug }));
    const slug = prior?.slug ?? `selected-${selection.selectionKey}`;
    if (!prior && records.some((p) => p.slug === slug))
      throw new Error(`Conflicting trail slug: ${slug}`);
    const link = prior && links.find((l) => l.trailId === prior.id && l.areaId === area.id);
    if (link?.override === 'exclude')
      throw new Error(`Selected link excluded by administrator: ${selection.selectionKey}`);
    const changed = !owner || !link || link.override !== 'include';
    return {
      ...item,
      area,
      prior,
      owner,
      link,
      slug,
      changed,
      distantNamesakes,
      otherAreas:
        !owner && prior
          ? links
              .filter((l) => l.trailId === prior.id)
              .flatMap((l) => records.filter((p) => p.id === l.areaId).map((p) => p.slug))
          : []
    };
  });
  return { records, actions, priorGeometries: [...priorGeometries] };
};

export const importSelectedTrails = async ({
  database,
  dryRun = false,
  beforeApply = async () => {}
}: {
  database: Database;
  dryRun?: boolean;
  beforeApply?: () => Promise<void>;
}) => {
  const dataset = await loadSelectedTrails();
  const prepared = await database.transaction(async (tx) => prepare(tx, dataset));
  const changed = prepared.actions.filter((a) => a.changed);
  const appliedIds = new Map<string, number>();
  const affectedSlugs = [
    ...new Set(changed.flatMap((a) => [a.area.slug, a.slug, ...a.otherAreas]))
  ];
  if (!dryRun && changed.length) {
    await beforeApply();
    await database.transaction(async (tx) => {
      const current = await prepare(tx, dataset);
      if (JSON.stringify(current) !== JSON.stringify(prepared))
        throw new Error('Catalog changed during import; retry the preview.');
      const timestamp = new Date().toISOString();
      const run = (
        await tx
          .insert(importRuns)
          .values({
            sourceUrl: 'https://www.openstreetmap.org/',
            activeCount: changed.length,
            importedAt: timestamp,
            responseShapeVersion: 'selected-trails-v1'
          })
          .returning()
      )[0]!;
      let nextId = Math.min(0, ...prepared.records.map((p) => p.lipasId)) - 1;
      for (const item of changed) {
        const { selection, bounds, prior } = item;
        let trailId = prior?.id;
        if (!prior) {
          const row = (
            await tx
              .insert(parks)
              .values({
                lipasId: nextId--,
                managedByLipasImport: false,
                typeId: 4405,
                slug: item.slug,
                name: selection.name,
                importedName: selection.name,
                lengthKm: selection.initialDisplayLengthKm,
                importedLengthKm: selection.initialDisplayLengthKm,
                locationLabel: selection.name,
                boundaryGeojson: JSON.stringify(item.geometry),
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
              .returning()
          )[0]!;
          trailId = row.id;
        } else if (!item.owner) {
          await tx
            .update(parks)
            .set({
              name: prior.name === prior.importedName ? selection.name : prior.name,
              importedName: selection.name,
              lengthKm:
                prior.lengthKm === prior.importedLengthKm
                  ? selection.initialDisplayLengthKm
                  : prior.lengthKm,
              importedLengthKm: selection.initialDisplayLengthKm,
              boundaryGeojson: JSON.stringify(item.geometry),
              bboxMinLon: bounds.minLon,
              bboxMinLat: bounds.minLat,
              bboxMaxLon: bounds.maxLon,
              bboxMaxLat: bounds.maxLat,
              catalogStatus: 'active',
              trailPublicationRole: 'area_member',
              updatedAt: timestamp
            })
            .where(eq(parks.id, prior.id));
        }
        appliedIds.set(selection.selectionKey, trailId!);
        if (!item.owner) {
          if (selection.osmRelationId !== null && !prior)
            await tx.insert(osmTrailSources).values({
              trailId: trailId!,
              relationId: selection.osmRelationId,
              sourceTimestamp: selection.sourceTimestamp
            });
          await tx.insert(curatedTrailSources).values({
            selectionKey: selection.selectionKey,
            trailId: trailId!,
            sourceKind: selection.sourceKind,
            manifestHash: dataset.manifestHash,
            geometryHash: selection.geometrySha256,
            sourceTimestamp: selection.sourceTimestamp,
            sourceUrlsJson: JSON.stringify(selection.sourceUrls),
            provenanceJson: JSON.stringify({ ...selection, features: item.provenance })
          });
        }
        await tx
          .insert(trailAreaLinks)
          .values({
            trailId: trailId!,
            areaId: item.area.id,
            override: 'include',
            createdAt: timestamp,
            updatedAt: timestamp
          })
          .onConflictDoUpdate({
            target: [trailAreaLinks.trailId, trailAreaLinks.areaId],
            set: { override: 'include', updatedAt: timestamp }
          });
      }
      await tx
        .insert(publicDataVersions)
        .values({ key: 'public-visits', version: 1, updatedAt: timestamp })
        .onConflictDoUpdate({
          target: publicDataVersions.key,
          set: { version: sql`${publicDataVersions.version} + 1`, updatedAt: timestamp }
        });
    });
  }
  return {
    manifestHash: dataset.manifestHash,
    snapshotHash: dataset.snapshotHash,
    selections: prepared.actions.map((a) => ({
      key: a.selection.selectionKey,
      name: a.selection.name,
      parent: a.area.slug,
      parentName: a.area.name,
      parentId: a.area.id,
      trailId: a.prior?.id ?? appliedIds.get(a.selection.selectionKey) ?? null,
      existingName: a.prior?.name ?? null,
      existingLengthKm: a.prior?.lengthKm ?? null,
      displayedLengthKm: a.selection.initialDisplayLengthKm,
      requestedLengthKm: a.selection.requestedLengthKm,
      measuredUniqueLengthKm: a.selection.measuredUniqueLengthKm,
      walkLengthKm: a.selection.walkLengthKm,
      sourceTimestamp: a.selection.sourceTimestamp,
      existingRole: a.prior?.trailPublicationRole ?? null,
      existingRemoved: a.prior?.removed ?? null,
      existingOverride: a.link?.override ?? null,
      sourceKind: a.selection.sourceKind,
      sourceUrls: a.selection.sourceUrls,
      geometryHash: a.selection.geometrySha256,
      distantNamesakes: a.distantNamesakes,
      trail: a.slug,
      action: a.changed ? (a.prior ? 'update' : 'create') : 'unchanged'
    })),
    affectedSlugs
  };
};
