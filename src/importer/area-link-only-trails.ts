import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { DbClient } from '../db/database.js';
import { parks, trailAreaLinks } from '../db/schema.js';
import { trailTypeCodes } from '../parks/park-types.js';
import type { GeoJsonFeatureCollection } from './geometry.js';
import type { MappedPark } from './map-lipas-park.js';
import {
  isValidWgs84Coordinate,
  measureTrailAreaOverlap,
  qualifiesTrailAreaOverlap
} from './trail-area-geometry.js';

const MAX_GEOMETRY_BATCH_BYTES = 2 * 1024 * 1024;
const MAX_GEOMETRY_BATCH_ROWS = 50;

export const loadParkGeometries = async (
  database: DbClient,
  metadata: { id: number; geometryBytes: number }[]
) => {
  const geometries = new Map<number, string>();
  let ids: number[] = [];
  let bytes = 0;
  const flushGeometryBatch = async () => {
    const rows = await database
      .select({ id: parks.id, geometry: parks.boundaryGeojson })
      .from(parks)
      .where(inArray(parks.id, ids));
    for (const row of rows) geometries.set(row.id, row.geometry);
    ids = [];
    bytes = 0;
  };
  for (const park of metadata) {
    if (
      ids.length > 0 &&
      (ids.length === MAX_GEOMETRY_BATCH_ROWS ||
        bytes + park.geometryBytes > MAX_GEOMETRY_BATCH_BYTES)
    ) {
      await flushGeometryBatch();
    }
    ids.push(park.id);
    bytes += park.geometryBytes;
  }
  if (ids.length > 0) await flushGeometryBatch();
  return geometries;
};

export const selectVisibleTrailParents = async (
  database: DbClient,
  isRetained: (lipasId: number) => boolean
) => {
  const rows = await database
    .select({
      id: parks.id,
      lipasId: parks.lipasId,
      managedByLipasImport: parks.managedByLipasImport,
      bboxMinLon: parks.bboxMinLon,
      bboxMinLat: parks.bboxMinLat,
      bboxMaxLon: parks.bboxMaxLon,
      bboxMaxLat: parks.bboxMaxLat,
      geometryBytes: sql<number>`length(cast(${parks.boundaryGeojson} as blob))`
    })
    .from(parks)
    .where(
      and(
        eq(parks.catalogStatus, 'active'),
        eq(parks.removed, false),
        eq(parks.trailPublicationRole, 'independent'),
        notInArray(parks.typeId, [...trailTypeCodes])
      )
    );
  const visibleAreas = rows.filter(
    (area) => !area.managedByLipasImport || isRetained(area.lipasId)
  );
  const geometries = await loadParkGeometries(database, visibleAreas);
  return visibleAreas.map((area) => ({
    ...area,
    geometry: JSON.parse(geometries.get(area.id)!) as GeoJsonFeatureCollection
  }));
};

export const qualifiesForVisibleParent = (
  trail: MappedPark,
  parents: Awaited<ReturnType<typeof selectVisibleTrailParents>>
) => {
  const bounds = trail.boundingBox;
  if (
    trail.boundaryGeoJson.features.some(
      ({ geometry }) =>
        geometry.type === 'LineString' &&
        geometry.coordinates.some((point) => !isValidWgs84Coordinate(point))
    )
  )
    return false;
  return parents.some((area) => {
    if (
      bounds.minLon > area.bboxMaxLon ||
      bounds.maxLon < area.bboxMinLon ||
      bounds.minLat > area.bboxMaxLat ||
      bounds.maxLat < area.bboxMinLat
    )
      return false;
    const overlap = measureTrailAreaOverlap(trail.boundaryGeoJson, area.geometry);
    return overlap.status === 'ok' && qualifiesTrailAreaOverlap(overlap.ratio);
  });
};

export const listAreaLinkOnlyParentSlugs = async (database: DbClient) => {
  const areas = alias(parks, 'area_link_only_parents');
  const rows = await database
    .selectDistinct({ slug: areas.slug })
    .from(trailAreaLinks)
    .innerJoin(parks, eq(parks.id, trailAreaLinks.trailId))
    .innerJoin(areas, eq(areas.id, trailAreaLinks.areaId))
    .where(eq(parks.areaLinkOnly, true));
  return rows.map(({ slug }) => slug);
};
