import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { DbClient } from '../db/database.js';
import { curatedTrailSources, osmTrailSources, parks } from '../db/schema.js';
import { trailTypeCodes } from '../parks/park-types.js';
import { loadParkGeometries } from './area-link-only-trails.js';
import type { GeoJsonFeatureCollection } from './geometry.js';
import type { MappedPark } from './map-lipas-park.js';
import { isValidWgs84Coordinate } from './trail-area-geometry.js';
import { buildTrailProximity, measureTrailCoverage, nearbyTrailBounds } from './trail-proximity.js';

const duplicateCoverage = 0.95;
const duplicateSampleSpacingMetres = 10;

const routeProximity = (geometry: GeoJsonFeatureCollection) => {
  const features = geometry.features.filter(
    ({ geometry }) =>
      geometry.type === 'LineString' && geometry.coordinates.every(isValidWgs84Coordinate)
  );
  return buildTrailProximity({ ...geometry, features }, duplicateSampleSpacingMetres);
};

export const createLipasTrailDuplicateCheck = async (
  database: DbClient,
  incomingTrails: MappedPark[],
  activeLipasIds: ReadonlySet<number>
) => {
  const metadata = await database
    .select({
      id: parks.id,
      name: parks.name,
      slug: parks.slug,
      lipasId: parks.lipasId,
      managedByLipasImport: parks.managedByLipasImport,
      bounds: {
        minLon: parks.bboxMinLon,
        minLat: parks.bboxMinLat,
        maxLon: parks.bboxMaxLon,
        maxLat: parks.bboxMaxLat
      },
      geometryBytes: sql<number>`length(cast(${parks.boundaryGeojson} as blob))`,
      relationId: osmTrailSources.relationId,
      selectionKey: curatedTrailSources.selectionKey
    })
    .from(parks)
    .leftJoin(osmTrailSources, eq(osmTrailSources.trailId, parks.id))
    .leftJoin(curatedTrailSources, eq(curatedTrailSources.trailId, parks.id))
    .where(and(eq(parks.catalogStatus, 'active'), inArray(parks.typeId, trailTypeCodes)))
    .orderBy(asc(parks.id));
  const nearby = metadata.filter(
    (trail) =>
      (!trail.managedByLipasImport || activeLipasIds.has(trail.lipasId)) &&
      incomingTrails.some((incoming) => nearbyTrailBounds(incoming.boundingBox, trail.bounds))
  );
  const geometries = await loadParkGeometries(database, nearby);
  const existing = nearby.map((trail) => ({
    ...trail,
    proximity: routeProximity(JSON.parse(geometries.get(trail.id)!) as GeoJsonFeatureCollection)
  }));
  const incomingIds = new Set(incomingTrails.map(({ lipasId }) => lipasId));

  return (trail: MappedPark) => {
    if (!incomingIds.has(trail.lipasId)) return;
    const incoming = routeProximity(trail.boundaryGeoJson);
    return existing.find(
      (match) =>
        nearbyTrailBounds(trail.boundingBox, match.bounds) &&
        measureTrailCoverage(incoming, match.proximity) >= duplicateCoverage &&
        measureTrailCoverage(match.proximity, incoming) >= duplicateCoverage
    );
  };
};

export const describeTrailMatchSource = ({
  lipasId,
  managedByLipasImport,
  relationId,
  selectionKey
}: {
  lipasId: number;
  managedByLipasImport: boolean;
  relationId: number | null;
  selectionKey: string | null;
}) => {
  if (relationId !== null)
    return `OpenStreetMap <https://www.openstreetmap.org/relation/${relationId}>`;
  if (selectionKey !== null) return `OpenStreetMap, reittivalinta ${selectionKey}`;
  if (managedByLipasImport) return `LIPAS <https://www.lipas.fi/liikuntapaikat/${lipasId}>`;
  return 'muu paikallinen tuonti';
};
