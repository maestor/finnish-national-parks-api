export type GeoJsonCoordinate = [number, number, ...number[]];

export type PolygonGeometry = {
  coordinates: GeoJsonCoordinate[][];
  type: 'Polygon';
};

export type LineStringGeometry = {
  coordinates: GeoJsonCoordinate[];
  type: 'LineString';
};

export type GeoJsonFeature = {
  geometry: PolygonGeometry | LineStringGeometry;
  type: 'Feature';
};

export type GeoJsonFeatureCollection = {
  features: GeoJsonFeature[];
  type: 'FeatureCollection';
};

export type BoundingBox = {
  maxLat: number;
  maxLon: number;
  minLat: number;
  minLon: number;
};

const getGeometryPoints = (geometry: GeoJsonFeature['geometry']) => {
  return geometry.type === 'Polygon' ? geometry.coordinates.flat() : geometry.coordinates;
};

export const deriveBoundingBox = (featureCollection: GeoJsonFeatureCollection): BoundingBox => {
  return featureCollection.features.reduce<BoundingBox>(
    (boundingBox, feature) => {
      for (const coordinate of getGeometryPoints(feature.geometry)) {
        const lon = coordinate[0];
        const lat = coordinate[1];

        boundingBox.minLon = Math.min(boundingBox.minLon, lon);
        boundingBox.minLat = Math.min(boundingBox.minLat, lat);
        boundingBox.maxLon = Math.max(boundingBox.maxLon, lon);
        boundingBox.maxLat = Math.max(boundingBox.maxLat, lat);
      }

      return boundingBox;
    },
    {
      maxLat: Number.NEGATIVE_INFINITY,
      maxLon: Number.NEGATIVE_INFINITY,
      minLat: Number.POSITIVE_INFINITY,
      minLon: Number.POSITIVE_INFINITY
    }
  );
};

const pointInRing = (point: GeoJsonCoordinate, ring: GeoJsonCoordinate[]) => {
  const [x, y] = point;
  let inside = false;

  for (
    let index = 0, previousIndex = ring.length - 1;
    index < ring.length;
    previousIndex = index++
  ) {
    const [currentX, currentY] = ring[index]!;
    const [previousX, previousY] = ring[previousIndex]!;
    const intersects =
      currentY > y !== previousY > y &&
      x < ((previousX - currentX) * (y - currentY)) / (previousY - currentY) + currentX;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
};

const pointInPolygon = (point: GeoJsonCoordinate, polygon: PolygonGeometry) => {
  if (!pointInRing(point, polygon.coordinates[0] ?? [])) {
    return false;
  }

  for (let index = 1; index < polygon.coordinates.length; index += 1) {
    if (pointInRing(point, polygon.coordinates[index]!)) {
      return false;
    }
  }

  return true;
};

const pointInArea = (point: GeoJsonCoordinate, area: GeoJsonFeatureCollection) => {
  return area.features.some(
    (feature) => feature.geometry.type === 'Polygon' && pointInPolygon(point, feature.geometry)
  );
};

const getRoutePoints = (route: GeoJsonFeatureCollection) => {
  return route.features.flatMap((feature) =>
    feature.geometry.type === 'LineString' ? feature.geometry.coordinates : []
  );
};

export const hasAnyPointInsideArea = (
  route: GeoJsonFeatureCollection,
  area: GeoJsonFeatureCollection
) => {
  const routePoints = getRoutePoints(route);

  return routePoints.length > 0 && routePoints.some((point) => pointInArea(point, area));
};

export const isFullyInsideArea = (
  route: GeoJsonFeatureCollection,
  area: GeoJsonFeatureCollection
) => {
  const routePoints = getRoutePoints(route);

  return routePoints.length > 0 && routePoints.every((point) => pointInArea(point, area));
};
