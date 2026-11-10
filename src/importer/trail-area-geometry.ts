import CoordinateFilter from 'jsts/org/locationtech/jts/geom/CoordinateFilter.js';
import type Geometry from 'jsts/org/locationtech/jts/geom/Geometry.js';
import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js';
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js';
import BoundaryOp from 'jsts/org/locationtech/jts/operation/BoundaryOp.js';
import OverlayOp from 'jsts/org/locationtech/jts/operation/overlay/OverlayOp.js';
import UnaryUnionOp from 'jsts/org/locationtech/jts/operation/union/UnaryUnionOp.js';
import IsValidOp from 'jsts/org/locationtech/jts/operation/valid/IsValidOp.js';
import proj4 from 'proj4';

import type {
  GeoJsonCoordinate,
  GeoJsonFeatureCollection,
  LineStringGeometry
} from './geometry.js';

const projection = '+proj=utm +zone=35 +ellps=GRS80 +units=m +no_defs';
export const isValidWgs84Coordinate = (coordinate: GeoJsonCoordinate) =>
  Number.isFinite(coordinate[0]) &&
  Number.isFinite(coordinate[1]) &&
  coordinate[0] >= -180 &&
  coordinate[0] <= 180 &&
  coordinate[1] >= -90 &&
  coordinate[1] <= 90;
const project = (coordinate: GeoJsonCoordinate) => {
  if (!isValidWgs84Coordinate(coordinate)) throw new Error('Invalid WGS84 coordinate.');
  return proj4('WGS84', projection, coordinate.slice(0, 2));
};
const reader = new GeoJSONReader(new GeometryFactory());

const projectedLength = (geometry: Geometry) => {
  const projected = geometry.copy() as Geometry & {
    apply: (filter: {
      interfaces_: (typeof CoordinateFilter)[];
      filter: (coordinate: { x: number; y: number }) => void;
    }) => void;
  };
  projected.apply({
    interfaces_: [CoordinateFilter],
    filter: (coordinate) => {
      const transformed = project([coordinate.x, coordinate.y]);
      coordinate.x = transformed[0]!;
      coordinate.y = transformed[1]!;
    }
  });
  projected.geometryChanged();
  return projected.getLength();
};

export const hasUsableLineLength = (line: LineStringGeometry) =>
  line.coordinates.some((point, index) => {
    const previous = line.coordinates[index - 1];
    return previous !== undefined && (point[0] !== previous[0] || point[1] !== previous[1]);
  });

export const qualifiesTrailAreaOverlap = (ratio: number) => ratio + 1e-7 >= 0.1;

type Measurement =
  | { status: 'ok'; overlapMetres: number; routeMetres: number; ratio: number }
  | { status: 'missing-line' | 'invalid-line' | 'invalid-area' };

export const measureTrailAreaOverlap = (
  trail: GeoJsonFeatureCollection,
  area: GeoJsonFeatureCollection
): Measurement => {
  const lineParts = trail.features.flatMap(({ geometry }) =>
    geometry.type === 'LineString' ? [geometry] : []
  );
  if (!lineParts.length) return { status: 'missing-line' };
  const lines = lineParts.filter(hasUsableLineLength);
  if (!lines.length) return { status: 'invalid-line' };
  const polygons = area.features.filter((feature) => feature.geometry.type === 'Polygon');
  if (!polygons.length) return { status: 'invalid-area' };

  let route: Geometry;
  let routeMetres: number;
  try {
    const lineGeometry = reader.read({
      type: 'GeometryCollection',
      geometries: lines.map((geometry) => ({
        type: 'LineString',
        coordinates: geometry.coordinates
      }))
    });
    route = UnaryUnionOp.union(lineGeometry) as Geometry;
    routeMetres = projectedLength(route);
    if (!Number.isFinite(routeMetres) || routeMetres <= 0) return { status: 'invalid-line' };
  } catch {
    return { status: 'invalid-line' };
  }

  try {
    if (
      polygons.some(
        ({ geometry }) =>
          geometry.type === 'Polygon' &&
          geometry.coordinates.some((ring) =>
            ring.some((coordinate) => !isValidWgs84Coordinate(coordinate))
          )
      )
    )
      return { status: 'invalid-area' };
    const areaGeometry = reader.read({
      type: 'GeometryCollection',
      geometries: polygons.map(({ geometry }) => ({
        type: 'Polygon',
        coordinates: geometry.coordinates
      }))
    });
    for (let index = 0; index < areaGeometry.getNumGeometries(); index += 1) {
      if (!IsValidOp.isValid(areaGeometry.getGeometryN(index))) return { status: 'invalid-area' };
    }
    const areaUnion = UnaryUnionOp.union(areaGeometry);
    if (areaUnion.getArea() <= 0) return { status: 'invalid-area' };
    const clipped = OverlayOp.intersection(route, areaUnion);
    const interior = OverlayOp.difference(clipped, BoundaryOp.getBoundary(areaUnion));
    const overlapMetres = Math.min(routeMetres, projectedLength(interior as Geometry));
    return { status: 'ok', overlapMetres, routeMetres, ratio: overlapMetres / routeMetres };
  } catch {
    return { status: 'invalid-area' };
  }
};
