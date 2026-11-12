import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { deriveBoundingBox, type GeoJsonFeatureCollection } from '../importer/geometry.js';
import {
  exceedsTrailLengthLimit,
  hasUsableLineLength,
  isValidWgs84Coordinate,
  measureTrailAreaOverlap,
  measureTrailLengthKm,
  qualifiesTrailAreaOverlap
} from '../importer/trail-area-geometry.js';
import { createParkSlug } from '../parks/park-normalization.js';
import { isTrailTypeCode } from '../parks/park-types.js';
import type { Database, DbClient } from './database.js';
import {
  osmTrailSources,
  parks,
  parkVisits,
  publicDataVersions,
  trailAreaLinks,
  trailMergeEvents,
  trailMergeGroups,
  trailMergeMembers,
  visitTrails
} from './schema.js';

type Park = typeof parks.$inferSelect;
type Member = typeof trailMergeMembers.$inferSelect;
export type MergeTrailsInput = {
  fromSlug: string;
  toSlug: string;
  name?: string;
  dryRun?: boolean;
};

export const combineTrailGeometry = (geometries: string[]) => {
  const seen = new Set<string>();
  const geometry: GeoJsonFeatureCollection = { type: 'FeatureCollection', features: [] };
  for (const text of geometries) {
    const input = JSON.parse(text) as GeoJsonFeatureCollection;
    if (!input.features.length) throw new Error('A merged component has no line geometry.');
    for (const feature of input.features) {
      const line = feature.geometry;
      if (
        line.type !== 'LineString' ||
        line.coordinates.length < 2 ||
        !line.coordinates.every(isValidWgs84Coordinate) ||
        !hasUsableLineLength(line)
      )
        throw new Error('A merged component has invalid or degenerate line geometry.');
      const key = JSON.stringify(line.coordinates);
      const reverse = JSON.stringify([...line.coordinates].reverse());
      if (!seen.has(key) && !seen.has(reverse)) {
        seen.add(key);
        geometry.features.push(feature);
      }
    }
  }
  const lengthKm = measureTrailLengthKm(geometry);
  if (lengthKm === null || exceedsTrailLengthLimit(lengthKm))
    throw new Error('Combined trail geometry must be measurable and at most 100 km.');
  const bounds = deriveBoundingBox(geometry);
  const first = geometry.features[0]!.geometry.coordinates[0] as [number, number];
  return {
    geometry,
    lengthKm,
    boundaryGeojson: JSON.stringify(geometry),
    bboxMinLon: bounds.minLon,
    bboxMinLat: bounds.minLat,
    bboxMaxLon: bounds.maxLon,
    bboxMaxLat: bounds.maxLat,
    markerLon: first[0],
    markerLat: first[1]
  };
};

const effective = (link: typeof trailAreaLinks.$inferSelect) =>
  link.override === 'include' || (link.automaticMatch && link.override === null);

export const planMergedMemberships = async (
  database: DbClient,
  trailId: number,
  geometry: GeoJsonFeatureCollection,
  pinAreaIds: number[]
) => {
  const priorLinks = await database
    .select()
    .from(trailAreaLinks)
    .where(eq(trailAreaLinks.trailId, trailId));
  const bounds = deriveBoundingBox(geometry);
  const areas = await database
    .select({ id: parks.id, slug: parks.slug, catalogStatus: parks.catalogStatus })
    .from(parks)
    .where(sql`${parks.typeId} NOT IN (4403,4404,4405) AND (
      (${parks.catalogStatus} = 'active'
        AND ${parks.bboxMaxLon} >= ${bounds.minLon}
        AND ${parks.bboxMinLon} <= ${bounds.maxLon}
        AND ${parks.bboxMaxLat} >= ${bounds.minLat}
        AND ${parks.bboxMinLat} <= ${bounds.maxLat})
      OR ${inArray(parks.id, [...pinAreaIds, ...priorLinks.map((link) => link.areaId)])}
    )`);
  const planned = [];
  for (const area of areas) {
    const prior = priorLinks.find((link) => link.areaId === area.id);
    const pin = pinAreaIds.includes(area.id);
    const boundary = (
      await database
        .select({ geometry: parks.boundaryGeojson })
        .from(parks)
        .where(eq(parks.id, area.id))
    )[0]!;
    const measurement = measureTrailAreaOverlap(
      geometry,
      JSON.parse(boundary.geometry) as GeoJsonFeatureCollection
    );
    const automaticMatch =
      area.catalogStatus === 'active' &&
      measurement.status === 'ok' &&
      qualifiesTrailAreaOverlap(measurement.ratio);
    if (!prior && !pin && !automaticMatch) continue;
    const values = {
      automaticMatch,
      override: pin ? ('include' as const) : (prior?.override ?? null),
      overlapMetres: measurement.status === 'ok' ? measurement.overlapMetres : null,
      routeMetres: measurement.status === 'ok' ? measurement.routeMetres : null,
      overlapRatio: measurement.status === 'ok' ? measurement.ratio : null,
      calculationMethod: 'jsts-wgs84-clip-epsg3067-v3',
      geometryFingerprint: null,
      geometryQuality: measurement.status === 'ok' ? 'valid' : measurement.status
    };
    planned.push({ ...values, areaId: area.id, areaSlug: area.slug });
  }
  return planned;
};

export const applyMergedMemberships = async (
  database: DbClient,
  trailId: number,
  planned: Awaited<ReturnType<typeof planMergedMemberships>>,
  timestamp: string
) => {
  for (const { areaSlug: _slug, ...values } of planned) {
    await database
      .insert(trailAreaLinks)
      .values({ ...values, trailId, createdAt: timestamp, updatedAt: timestamp })
      .onConflictDoUpdate({
        target: [trailAreaLinks.trailId, trailAreaLinks.areaId],
        set: { ...values, updatedAt: timestamp }
      });
  }
};

export const bumpMergedTrailVersion = async (database: DbClient, timestamp: string) => {
  await database
    .insert(publicDataVersions)
    .values({ key: 'public-visits', version: 1, updatedAt: timestamp })
    .onConflictDoUpdate({
      target: publicDataVersions.key,
      set: { version: sql`${publicDataVersions.version}+1`, updatedAt: timestamp }
    });
};

export const mergedTrailSlugs = async (database: DbClient, ids: number[]) => {
  const trails = await database
    .select({ slug: parks.slug })
    .from(parks)
    .where(inArray(parks.id, ids));
  const areas = await database
    .select({ slug: parks.slug })
    .from(trailAreaLinks)
    .innerJoin(parks, eq(parks.id, trailAreaLinks.areaId))
    .where(inArray(trailAreaLinks.trailId, ids));
  return [...new Set([...trails, ...areas].map((row) => row.slug))];
};

export const mergeTrails = async (database: Database, input: MergeTrailsInput) =>
  database.transaction(async (tx) => {
    const fromSlug = input.fromSlug.trim();
    const toSlug = input.toSlug.trim();
    const name = input.name?.trim();
    if (!fromSlug || !toSlug || (name !== undefined && (!name || name.length > 120)))
      throw new Error(
        'Source, destination and a nonempty name of at most 120 characters are required.'
      );
    const events = await tx
      .select()
      .from(trailMergeEvents)
      .where(eq(trailMergeEvents.fromSlug, fromSlug));
    const from = (await tx.select().from(parks).where(eq(parks.slug, fromSlug)))[0];
    const destination = (await tx.select().from(parks).where(eq(parks.slug, toSlug)))[0];
    const event = events.find((row) => row.toSlug === toSlug || row.toTrailId === destination?.id);
    if (event) {
      if (
        (from && from.id !== event.fromTrailId) ||
        (destination && destination.id !== event.toTrailId) ||
        (name ?? null) !== event.requestedName
      )
        throw new Error(
          'This merge request differs from the recorded merge or a request slug was reassigned.'
        );
      const canonical = (await tx.select().from(parks).where(eq(parks.id, event.toTrailId)))[0]!;
      return {
        alreadyMerged: true as const,
        dryRun: input.dryRun ?? false,
        fromSlug,
        toSlug: canonical.slug,
        name: canonical.name,
        movedVisitCount: 0,
        sharedVisitCount: 0,
        addedAreaSlugs: [] as string[],
        affectedSlugs: [] as string[],
        lengthKm: canonical.lengthKm
      };
    }
    if (!from || !destination) throw new Error('Source or destination trail was not found.');
    if (from.id === destination.id)
      throw new Error('Source and destination must be different trails.');
    const pair = [from, destination];
    const sources = await tx
      .select()
      .from(osmTrailSources)
      .where(
        inArray(
          osmTrailSources.trailId,
          pair.map((p) => p.id)
        )
      );
    if (
      sources.length !== 2 ||
      pair.some(
        (p) =>
          !isTrailTypeCode(p.typeId) ||
          p.managedByLipasImport ||
          p.catalogStatus !== 'active' ||
          p.trailPublicationRole !== 'area_member'
      )
    )
      throw new Error('Both inputs must be active OSM-backed linked trails.');
    const memberships = await tx
      .select()
      .from(trailMergeMembers)
      .where(
        inArray(
          trailMergeMembers.trailId,
          pair.map((p) => p.id)
        )
      );
    if (memberships.some((m) => m.trailId === from.id || m.canonicalTrailId !== destination.id))
      throw new Error('A source merge group or an absorbed trail cannot be merged again.');
    const directVisits = await tx
      .select({ id: parkVisits.id })
      .from(parkVisits)
      .where(eq(parkVisits.parkId, from.id))
      .limit(1);
    if (directVisits.length)
      throw new Error('Source has direct park visits; review them before merging.');
    const links = await tx
      .select()
      .from(trailAreaLinks)
      .where(
        inArray(
          trailAreaLinks.trailId,
          pair.map((p) => p.id)
        )
      );
    const fromAreas = links
      .filter((l) => l.trailId === from.id && effective(l))
      .map((l) => l.areaId);
    const toAreas = links
      .filter((l) => l.trailId === destination.id && effective(l))
      .map((l) => l.areaId);
    const common = await tx
      .select({ id: parks.id })
      .from(parks)
      .where(
        and(
          inArray(
            parks.id,
            fromAreas.filter((id) => toAreas.includes(id))
          ),
          eq(parks.catalogStatus, 'active')
        )
      );
    if (!common.length) throw new Error('Trails must share an active effective parent area.');
    const pinAreaIds = [...new Set([...fromAreas, ...toAreas])];
    if (
      links.some(
        (l) =>
          l.trailId === destination.id && l.override === 'exclude' && pinAreaIds.includes(l.areaId)
      )
    )
      throw new Error(
        'Destination explicitly excludes a source area; resolve the exclusion before merging.'
      );
    const currentMembers = await tx
      .select()
      .from(trailMergeMembers)
      .where(eq(trailMergeMembers.canonicalTrailId, destination.id))
      .orderBy(asc(trailMergeMembers.trailId));
    const timestamp = new Date().toISOString();
    const asMember = (p: Park): Member => ({
      trailId: p.id,
      canonicalTrailId: destination.id,
      sourceGeometry: p.boundaryGeojson,
      sourceLengthKm: p.importedLengthKm,
      sourceTimestamp: sources.find((s) => s.trailId === p.id)!.sourceTimestamp
    });
    const members = [
      ...currentMembers,
      ...(currentMembers.length ? [] : [asMember(destination)]),
      asMember(from)
    ].sort((a, b) => a.trailId - b.trailId);
    const combined = combineTrailGeometry(members.map((m) => m.sourceGeometry));
    const nextName = name ?? destination.name;
    const nextSlug = name === undefined ? destination.slug : createParkSlug(nextName);
    const conflict = (
      await tx.select({ id: parks.id }).from(parks).where(eq(parks.slug, nextSlug))
    )[0];
    if (conflict && conflict.id !== destination.id)
      throw new Error(`Park slug "${nextSlug}" is already in use.`);
    const assignments = await tx
      .select()
      .from(visitTrails)
      .where(
        inArray(
          visitTrails.trailId,
          pair.map((p) => p.id)
        )
      );
    const existing = new Set(
      assignments.filter((a) => a.trailId === destination.id).map((a) => a.visitId)
    );
    const sourceAssignments = assignments.filter((a) => a.trailId === from.id);
    const toInsert = sourceAssignments.filter((a) => !existing.has(a.visitId));
    const addedAreas = await tx
      .select({ slug: parks.slug })
      .from(parks)
      .where(
        inArray(
          parks.id,
          fromAreas.filter((id) => !toAreas.includes(id))
        )
      );
    const membershipPlan = await planMergedMemberships(
      tx,
      destination.id,
      combined.geometry,
      pinAreaIds
    );
    const group = (
      await tx.select().from(trailMergeGroups).where(eq(trailMergeGroups.trailId, destination.id))
    )[0];
    const lengthKm =
      !group || destination.lengthKm === group.measuredLengthKm
        ? combined.lengthKm
        : destination.lengthKm;
    if (exceedsTrailLengthLimit(null, lengthKm))
      throw new Error('Destination length exceeds 100 km.');
    const affectedSlugs = [
      ...new Set([
        ...membershipPlan.map((row) => row.areaSlug),
        ...(await mergedTrailSlugs(
          tx,
          pair.map((p) => p.id)
        )),
        nextSlug
      ])
    ];
    const result = {
      alreadyMerged: false as const,
      dryRun: input.dryRun ?? false,
      fromSlug,
      toSlug: nextSlug,
      name: nextName,
      movedVisitCount: toInsert.length,
      sharedVisitCount: sourceAssignments.length - toInsert.length,
      addedAreaSlugs: addedAreas.map((a) => a.slug),
      affectedSlugs,
      lengthKm,
      measuredLengthKm: combined.lengthKm,
      sourceRelationIds: (
        await tx
          .select({ id: osmTrailSources.relationId })
          .from(osmTrailSources)
          .where(
            inArray(
              osmTrailSources.trailId,
              members.map((m) => m.trailId)
            )
          )
      )
        .map((s) => s.id)
        .sort((a, b) => a - b)
    };
    if (input.dryRun) return result;
    await tx
      .insert(trailMergeGroups)
      .values({
        trailId: destination.id,
        measuredLengthKm: combined.lengthKm,
        createdAt: timestamp
      })
      .onConflictDoUpdate({
        target: trailMergeGroups.trailId,
        set: { measuredLengthKm: combined.lengthKm }
      });
    for (const member of members)
      await tx
        .insert(trailMergeMembers)
        .values(member)
        .onConflictDoNothing({ target: trailMergeMembers.trailId });
    await applyMergedMemberships(tx, destination.id, membershipPlan, timestamp);
    if (toInsert.length)
      await tx
        .insert(visitTrails)
        .values(toInsert.map((a) => ({ visitId: a.visitId, trailId: destination.id })))
        .onConflictDoNothing({ target: [visitTrails.visitId, visitTrails.trailId] });
    await tx.delete(visitTrails).where(eq(visitTrails.trailId, from.id));
    const { geometry: _geometry, lengthKm: _length, ...geometryValues } = combined;
    await tx
      .update(parks)
      .set({ ...geometryValues, lengthKm, name: nextName, slug: nextSlug, updatedAt: timestamp })
      .where(eq(parks.id, destination.id));
    await tx
      .update(parks)
      .set({ catalogStatus: 'inactive', removed: true, updatedAt: timestamp })
      .where(eq(parks.id, from.id));
    await tx.insert(trailMergeEvents).values({
      fromTrailId: from.id,
      toTrailId: destination.id,
      fromSlug,
      toSlug,
      requestedName: name ?? null,
      createdAt: timestamp
    });
    await bumpMergedTrailVersion(tx, timestamp);
    return result;
  });
