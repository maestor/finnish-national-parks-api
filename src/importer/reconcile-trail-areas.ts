import { createHash } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import type { DbClient } from '../db/database.js';
import { parks, parkVisits, trailAreaLinks } from '../db/schema.js';
import { isTrailTypeCode } from '../parks/park-types.js';
import type { GeoJsonFeatureCollection } from './geometry.js';
import {
  hasUsableLineLength,
  isValidWgs84Coordinate,
  measureTrailAreaOverlap,
  qualifiesTrailAreaOverlap
} from './trail-area-geometry.js';

const method = 'jsts-wgs84-clip-epsg3067-v3';
const intersectsBounds = (a: typeof parks.$inferSelect, b: typeof parks.$inferSelect) =>
  a.bboxMinLon <= b.bboxMaxLon &&
  a.bboxMaxLon >= b.bboxMinLon &&
  a.bboxMinLat <= b.bboxMaxLat &&
  a.bboxMaxLat >= b.bboxMinLat;
const fingerprint = (trail: string, area: string) =>
  createHash('sha256')
    .update(JSON.stringify([method, trail, area]))
    .digest('hex');

export const reconcileTrailAreas = async (database: DbClient, timestamp: string) => {
  const records = await database.select().from(parks);
  const links = await database.select().from(trailAreaLinks);
  const visited = new Set(
    (await database.selectDistinct({ id: parkVisits.parkId }).from(parkVisits)).map((row) => row.id)
  );
  const areas = records.filter(
    (park) => park.catalogStatus === 'active' && !isTrailTypeCode(park.typeId)
  );
  const trails = records.filter(
    (park) =>
      park.catalogStatus === 'active' && park.managedByLipasImport && isTrailTypeCode(park.typeId)
  );
  const byPair = new Map(links.map((link) => [`${link.trailId}:${link.areaId}`, link]));
  const seen = new Set<string>();
  const unresolved: { trailId: number; areaId: number | null; status: string }[] = [];
  const newlyHiddenPublicSlugs: string[] = [];
  let automaticLinks = 0;
  let newlyHidden = 0;

  for (const trail of trails) {
    let geometryQuality = 'valid';
    try {
      const geometry = JSON.parse(trail.boundaryGeojson) as GeoJsonFeatureCollection;
      const lineFeatures = geometry.features.flatMap(({ geometry: line }) =>
        line.type === 'LineString' ? [line] : []
      );
      if (!lineFeatures.length) {
        unresolved.push({ trailId: trail.id, areaId: null, status: 'missing-line' });
        continue;
      }
      if (
        lineFeatures.some((line) =>
          line.coordinates.some((point) => !isValidWgs84Coordinate(point))
        )
      ) {
        unresolved.push({ trailId: trail.id, areaId: null, status: 'invalid-line' });
        continue;
      }
      if (!lineFeatures.some(hasUsableLineLength)) {
        unresolved.push({ trailId: trail.id, areaId: null, status: 'invalid-line' });
        continue;
      }
      if (lineFeatures.some((line) => !hasUsableLineLength(line))) {
        geometryQuality = 'degenerate-line-parts';
        unresolved.push({ trailId: trail.id, areaId: null, status: 'degenerate-line-part' });
      }
    } catch {
      unresolved.push({ trailId: trail.id, areaId: null, status: 'invalid-line' });
      continue;
    }
    for (const area of areas) {
      if (!intersectsBounds(trail, area)) continue;
      const key = `${trail.id}:${area.id}`;
      const prior = byPair.get(key);
      const hash = fingerprint(trail.boundaryGeojson, area.boundaryGeojson);
      let measurement: ReturnType<typeof measureTrailAreaOverlap>;
      if (
        prior?.geometryFingerprint === hash &&
        prior.overlapRatio !== null &&
        prior.routeMetres !== null &&
        prior.overlapMetres !== null
      ) {
        measurement = {
          status: 'ok',
          ratio: prior.overlapRatio,
          routeMetres: prior.routeMetres,
          overlapMetres: prior.overlapMetres
        };
      } else {
        try {
          measurement = measureTrailAreaOverlap(
            JSON.parse(trail.boundaryGeojson) as GeoJsonFeatureCollection,
            JSON.parse(area.boundaryGeojson) as GeoJsonFeatureCollection
          );
        } catch {
          measurement = { status: 'invalid-area' };
        }
      }
      if (measurement.status !== 'ok') {
        unresolved.push({ trailId: trail.id, areaId: area.id, status: measurement.status });
        continue;
      }
      const matches = qualifiesTrailAreaOverlap(measurement.ratio);
      if (!matches && !prior) continue;
      if (!matches && !prior!.override) {
        await database
          .delete(trailAreaLinks)
          .where(and(eq(trailAreaLinks.trailId, trail.id), eq(trailAreaLinks.areaId, area.id)));
        seen.add(key);
        continue;
      }
      seen.add(key);
      if (matches) automaticLinks += 1;
      const effective = prior?.override === 'include' || (matches && prior?.override !== 'exclude');
      if (effective && trail.trailPublicationRole === 'independent') {
        if (visited.has(trail.id))
          throw new Error(
            `Trail ${trail.slug} has visits and requires a preservation decision before conversion.`
          );
        await database
          .update(parks)
          .set({ trailPublicationRole: 'area_member', updatedAt: timestamp })
          .where(eq(parks.id, trail.id));
        trail.trailPublicationRole = 'area_member';
        if (!trail.removed) newlyHiddenPublicSlugs.push(trail.slug);
        newlyHidden += 1;
      }
      if (prior?.geometryFingerprint === hash && prior.automaticMatch === matches) continue;
      await database
        .insert(trailAreaLinks)
        .values({
          trailId: trail.id,
          areaId: area.id,
          automaticMatch: matches,
          overlapMetres: measurement.overlapMetres,
          routeMetres: measurement.routeMetres,
          overlapRatio: measurement.ratio,
          calculationMethod: method,
          geometryFingerprint: hash,
          geometryQuality,
          createdAt: timestamp,
          updatedAt: timestamp
        })
        .onConflictDoUpdate({
          target: [trailAreaLinks.trailId, trailAreaLinks.areaId],
          set: {
            automaticMatch: matches,
            overlapMetres: measurement.overlapMetres,
            routeMetres: measurement.routeMetres,
            overlapRatio: measurement.ratio,
            calculationMethod: method,
            geometryFingerprint: hash,
            geometryQuality,
            updatedAt: timestamp
          }
        });
    }
  }
  for (const link of links) {
    if (seen.has(`${link.trailId}:${link.areaId}`) || !link.automaticMatch) continue;
    const pair = and(
      eq(trailAreaLinks.trailId, link.trailId),
      eq(trailAreaLinks.areaId, link.areaId)
    );
    if (link.override) {
      await database
        .update(trailAreaLinks)
        .set({ automaticMatch: false, updatedAt: timestamp })
        .where(pair);
    } else {
      await database.delete(trailAreaLinks).where(pair);
    }
  }
  return {
    automaticLinks,
    manualExclusions: links.filter((link) => link.override === 'exclude').length,
    newlyHidden,
    newlyHiddenPublicSlugs,
    unresolved
  };
};
