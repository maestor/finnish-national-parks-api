import { and, asc, desc, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';

import { alias } from 'drizzle-orm/sqlite-core';
import type { GeoJsonFeatureCollection } from '../importer/geometry.js';
import { isTrailTypeCode, isVisibleTrailParent, trailTypeCodes } from '../parks/park-types.js';
import { toAddress } from './address.js';
import type { Database, DbClient } from './database.js';
import {
  curatedTrailSources,
  osmTrailSources,
  parks,
  parkVisits,
  publicDataVersions,
  trailAreaLinks,
  trailMergeMembers,
  visitTrails
} from './schema.js';

import { unabsorbedTrailWhere } from './trail-merges.js';

export class TrailAreaValidationError extends Error {}
export class TrailVisitConflictError extends Error {
  constructor(public visits: { id: number; visitedOn: string }[]) {
    super('Trail is linked to visits; review those visits before unlinking.');
  }
}

export const findEligibleArea = async (database: DbClient, slug: string) => {
  const area = (await database.select().from(parks).where(eq(parks.slug, slug)).limit(1))[0];
  if (!area) return null;
  if (area.catalogStatus !== 'active' || isTrailTypeCode(area.typeId))
    throw new TrailAreaValidationError('An active area is required.');
  return area;
};
const selectLink = (
  link: typeof trailAreaLinks.$inferSelect,
  trail: Pick<typeof parks.$inferSelect, 'id' | 'name' | 'slug'>
) => ({
  trailId: trail.id,
  name: trail.name,
  slug: trail.slug,
  automaticMatch: link.automaticMatch,
  override: link.override,
  effective: link.override === 'include' || (link.automaticMatch && link.override !== 'exclude'),
  overlapMetres: link.overlapMetres,
  routeMetres: link.routeMetres,
  overlapRatio: link.overlapRatio,
  calculationMethod: link.calculationMethod,
  geometryFingerprint: link.geometryFingerprint,
  geometryQuality: link.geometryQuality,
  createdAt: link.createdAt,
  updatedAt: link.updatedAt
});
export const listAreaTrails = async (database: DbClient, areaId: number) => {
  const rows = await database
    .select({
      link: trailAreaLinks,
      trail: {
        id: parks.id,
        name: parks.name,
        slug: parks.slug,
        catalogStatus: parks.catalogStatus,
        managedByLipasImport: parks.managedByLipasImport,
        typeId: parks.typeId
      },
      source: osmTrailSources.trailId,
      curatedId: curatedTrailSources.trailId
    })
    .from(trailAreaLinks)
    .innerJoin(parks, eq(parks.id, trailAreaLinks.trailId))
    .leftJoin(osmTrailSources, eq(osmTrailSources.trailId, parks.id))
    .leftJoin(curatedTrailSources, eq(curatedTrailSources.trailId, parks.id))
    .where(and(eq(trailAreaLinks.areaId, areaId), unabsorbedTrailWhere()))
    .orderBy(asc(parks.name));
  return rows.map(({ link, trail, source, curatedId }) => ({
    ...selectLink(link, trail),
    effective:
      trail.catalogStatus === 'active' &&
      (trail.managedByLipasImport || source !== null || curatedId !== null) &&
      isTrailTypeCode(trail.typeId) &&
      selectLink(link, trail).effective
  }));
};
export const listTrailAreas = async (database: DbClient, slug: string) => {
  const trail = (await database.select().from(parks).where(eq(parks.slug, slug)).limit(1))[0];
  if (!trail) return null;
  if (!isTrailTypeCode(trail.typeId)) throw new TrailAreaValidationError('A trail is required.');
  const source = (
    await database
      .select()
      .from(osmTrailSources)
      .where(eq(osmTrailSources.trailId, trail.id))
      .limit(1)
  )[0];
  const curated = (
    await database
      .select({ trailId: curatedTrailSources.trailId })
      .from(curatedTrailSources)
      .where(eq(curatedTrailSources.trailId, trail.id))
      .limit(1)
  )[0];
  if (trail.catalogStatus !== 'active' || (!trail.managedByLipasImport && !source && !curated))
    return [];
  const rows = await database
    .select({ link: trailAreaLinks, name: parks.name, slug: parks.slug })
    .from(trailAreaLinks)
    .innerJoin(parks, eq(parks.id, trailAreaLinks.areaId))
    .where(eq(trailAreaLinks.trailId, trail.id))
    .orderBy(asc(parks.name), asc(parks.id));
  return rows
    .filter(({ link }) => selectLink(link, trail).effective)
    .map(({ name, slug: areaSlug }) => ({ name, slug: areaSlug }));
};
export const listPublicAreaTrails = async (database: DbClient, areaId: number) => {
  const parent = alias(parks, 'parent_area');
  const mergedSources = await database
    .select({
      canonicalTrailId: trailMergeMembers.canonicalTrailId,
      relationId: osmTrailSources.relationId
    })
    .from(trailMergeMembers)
    .innerJoin(osmTrailSources, eq(osmTrailSources.trailId, trailMergeMembers.trailId))
    .innerJoin(
      trailAreaLinks,
      and(
        eq(trailAreaLinks.trailId, trailMergeMembers.canonicalTrailId),
        eq(trailAreaLinks.areaId, areaId)
      )
    )
    .orderBy(asc(osmTrailSources.relationId));
  const rows = await database
    .select({
      link: trailAreaLinks,
      trail: parks,
      area: { removed: parent.removed, trailPublicationRole: parent.trailPublicationRole },
      source: osmTrailSources,
      curatedId: curatedTrailSources.trailId,
      sourceUrlsJson: curatedTrailSources.sourceUrlsJson
    })
    .from(trailAreaLinks)
    .innerJoin(parks, eq(parks.id, trailAreaLinks.trailId))
    .innerJoin(parent, eq(parent.id, trailAreaLinks.areaId))
    .leftJoin(osmTrailSources, eq(osmTrailSources.trailId, parks.id))
    .leftJoin(curatedTrailSources, eq(curatedTrailSources.trailId, parks.id))
    .where(eq(trailAreaLinks.areaId, areaId))
    .orderBy(asc(parks.name), asc(parks.id));
  return rows
    .filter(
      ({ link, trail, area, source, curatedId }) =>
        trail.catalogStatus === 'active' &&
        (!trail.areaLinkOnly || isVisibleTrailParent(area)) &&
        (trail.managedByLipasImport || source !== null || curatedId !== null) &&
        isTrailTypeCode(trail.typeId) &&
        selectLink(link, trail).effective
    )
    .map(({ trail, source, sourceUrlsJson }) => ({
      ...(source
        ? {
            source: {
              type: 'openstreetmap' as const,
              relationId: source.relationId,
              ...(mergedSources.some((s) => s.canonicalTrailId === trail.id)
                ? {
                    relations: mergedSources
                      .filter((s) => s.canonicalTrailId === trail.id)
                      .map((s) => ({
                        relationId: s.relationId,
                        sourceUrl: `https://www.openstreetmap.org/relation/${s.relationId}`
                      }))
                  }
                : {}),
              attribution: '© OpenStreetMap contributors',
              licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
              sourceUrl: `https://www.openstreetmap.org/relation/${source.relationId}`
            }
          }
        : sourceUrlsJson !== null
          ? {
              source: {
                type: 'openstreetmap-curated' as const,
                attribution: '© OpenStreetMap contributors',
                licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
                sourceUrls: JSON.parse(sourceUrlsJson) as string[]
              }
            }
          : {}),
      name: trail.name,
      slug: trail.slug,
      address:
        toAddress(
          trail.locationLabel === trail.name ? '' : trail.locationLabel,
          trail.postalCode,
          trail.postalOffice
        ) || null,
      lengthKm: trail.lengthKm,
      boundaryGeoJson: JSON.parse(trail.boundaryGeojson) as GeoJsonFeatureCollection
    }))
    .filter((trail) =>
      trail.boundaryGeoJson.features.some((feature) => feature.geometry.type === 'LineString')
    );
};
export const listAreaTrailCandidates = async (
  database: DbClient,
  q: string,
  limit: number,
  offset: number
) => {
  const rows = await database
    .select({ trailId: parks.id, name: parks.name, slug: parks.slug })
    .from(parks)
    .leftJoin(osmTrailSources, eq(osmTrailSources.trailId, parks.id))
    .leftJoin(curatedTrailSources, eq(curatedTrailSources.trailId, parks.id))
    .where(
      and(
        eq(parks.catalogStatus, 'active'),
        or(
          eq(parks.managedByLipasImport, true),
          isNotNull(osmTrailSources.trailId),
          isNotNull(curatedTrailSources.trailId)
        ),
        inArray(parks.typeId, trailTypeCodes),
        sql`instr(lower(${parks.name}), lower(${q})) > 0`
      )
    )
    .orderBy(asc(parks.name), asc(parks.id))
    .limit(limit + 1)
    .offset(offset);
  return { trails: rows.slice(0, limit), nextOffset: rows.length > limit ? offset + limit : null };
};
export const setAreaTrailOverride = async (
  database: Database,
  slug: string,
  trailId: number,
  override: 'include' | 'exclude'
) =>
  database.transaction(async (tx) => {
    const area = await findEligibleArea(tx, slug);
    const trail = (await tx.select().from(parks).where(eq(parks.id, trailId)).limit(1))[0];
    if (!area || !trail) return null;
    if (override === 'exclude') {
      const visits = await tx
        .select({ id: parkVisits.id, visitedOn: parkVisits.visitedOn })
        .from(visitTrails)
        .innerJoin(parkVisits, eq(parkVisits.id, visitTrails.visitId))
        .where(and(eq(parkVisits.parkId, area.id), eq(visitTrails.trailId, trailId)))
        .orderBy(desc(parkVisits.visitedOn), desc(parkVisits.id));
      if (visits.length > 0) throw new TrailVisitConflictError(visits);
    }
    const source = (
      await tx.select().from(osmTrailSources).where(eq(osmTrailSources.trailId, trail.id)).limit(1)
    )[0];
    const curated = (
      await tx
        .select({ trailId: curatedTrailSources.trailId })
        .from(curatedTrailSources)
        .where(eq(curatedTrailSources.trailId, trail.id))
        .limit(1)
    )[0];
    if (
      trail.id === area.id ||
      !isTrailTypeCode(trail.typeId) ||
      (!trail.managedByLipasImport && !source && !curated) ||
      trail.catalogStatus !== 'active'
    )
      throw new TrailAreaValidationError('An active supported trail is required.');
    if (override === 'include' && trail.areaLinkOnly && !isVisibleTrailParent(area)) {
      throw new TrailAreaValidationError('An area-only trail requires a visible parent area.');
    }
    if (override === 'include' && trail.trailPublicationRole === 'independent') {
      const visits = await tx
        .select({ id: parkVisits.id })
        .from(parkVisits)
        .where(eq(parkVisits.parkId, trail.id))
        .limit(1);
      if (visits.length)
        throw new TrailAreaValidationError(
          'Trail has visits and requires a preservation decision before conversion.'
        );
    }
    const prior = (
      await tx
        .select()
        .from(trailAreaLinks)
        .where(and(eq(trailAreaLinks.areaId, area.id), eq(trailAreaLinks.trailId, trail.id)))
        .limit(1)
    )[0];
    const timestamp = new Date().toISOString();
    if (prior?.override !== override) {
      await tx
        .insert(trailAreaLinks)
        .values({ trailId, areaId: area.id, override, createdAt: timestamp, updatedAt: timestamp })
        .onConflictDoUpdate({
          target: [trailAreaLinks.trailId, trailAreaLinks.areaId],
          set: { override, updatedAt: timestamp }
        });
      if (override === 'include')
        await tx
          .update(parks)
          .set({ trailPublicationRole: 'area_member', updatedAt: timestamp })
          .where(eq(parks.id, trailId));
      await tx
        .insert(publicDataVersions)
        .values({ key: 'public-visits', version: 1, updatedAt: timestamp })
        .onConflictDoUpdate({
          target: publicDataVersions.key,
          set: { version: sql`${publicDataVersions.version} + 1`, updatedAt: timestamp }
        });
    }
    const result = (
      await tx
        .select()
        .from(trailAreaLinks)
        .where(and(eq(trailAreaLinks.areaId, area.id), eq(trailAreaLinks.trailId, trail.id)))
        .limit(1)
    )[0]!;
    return selectLink(result, trail);
  });
