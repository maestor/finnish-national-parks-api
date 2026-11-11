import { and, asc, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';

import type { GeoJsonFeatureCollection } from '../importer/geometry.js';
import { isTrailTypeCode } from '../parks/park-types.js';
import { toAddress } from './address.js';
import type { Database, DbClient } from './database.js';
import {
  osmTrailSources,
  parks,
  parkVisits,
  publicDataVersions,
  trailAreaLinks
} from './schema.js';

const trailTypes = [4403, 4404, 4405];
export class TrailAreaValidationError extends Error {}

export const findEligibleArea = async (database: DbClient, slug: string) => {
  const area = (await database.select().from(parks).where(eq(parks.slug, slug)).limit(1))[0];
  if (!area) return null;
  if (area.catalogStatus !== 'active' || isTrailTypeCode(area.typeId))
    throw new TrailAreaValidationError('An active area is required.');
  return area;
};
const selectLink = (
  link: typeof trailAreaLinks.$inferSelect,
  trail: typeof parks.$inferSelect
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
    .select({ link: trailAreaLinks, trail: parks, source: osmTrailSources })
    .from(trailAreaLinks)
    .innerJoin(parks, eq(parks.id, trailAreaLinks.trailId))
    .leftJoin(osmTrailSources, eq(osmTrailSources.trailId, parks.id))
    .where(eq(trailAreaLinks.areaId, areaId))
    .orderBy(asc(parks.name));
  return rows.map(({ link, trail, source }) => ({
    ...selectLink(link, trail),
    effective:
      trail.catalogStatus === 'active' &&
      (trail.managedByLipasImport || source !== null) &&
      isTrailTypeCode(trail.typeId) &&
      selectLink(link, trail).effective
  }));
};
export const listPublicAreaTrails = async (database: DbClient, areaId: number) => {
  const rows = await database
    .select({ link: trailAreaLinks, trail: parks, source: osmTrailSources })
    .from(trailAreaLinks)
    .innerJoin(parks, eq(parks.id, trailAreaLinks.trailId))
    .leftJoin(osmTrailSources, eq(osmTrailSources.trailId, parks.id))
    .where(eq(trailAreaLinks.areaId, areaId))
    .orderBy(asc(parks.name), asc(parks.id));
  return rows
    .filter(
      ({ link, trail, source }) =>
        trail.catalogStatus === 'active' &&
        (trail.managedByLipasImport || source !== null) &&
        isTrailTypeCode(trail.typeId) &&
        selectLink(link, trail).effective
    )
    .map(({ trail, source }) => ({
      ...(source
        ? {
            source: {
              type: 'openstreetmap' as const,
              relationId: source.relationId,
              attribution: '© OpenStreetMap contributors',
              licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
              sourceUrl: `https://www.openstreetmap.org/relation/${source.relationId}`
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
    .where(
      and(
        eq(parks.catalogStatus, 'active'),
        or(eq(parks.managedByLipasImport, true), isNotNull(osmTrailSources.trailId)),
        inArray(parks.typeId, trailTypes),
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
    const source = (
      await tx.select().from(osmTrailSources).where(eq(osmTrailSources.trailId, trail.id)).limit(1)
    )[0];
    if (
      trail.id === area.id ||
      !isTrailTypeCode(trail.typeId) ||
      (!trail.managedByLipasImport && !source) ||
      trail.catalogStatus !== 'active'
    )
      throw new TrailAreaValidationError('An active supported trail is required.');
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
