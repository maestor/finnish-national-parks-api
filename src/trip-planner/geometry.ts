import type {
  BoundingBox,
  GeoJsonCoordinate,
  GeoJsonFeatureCollection,
  LineStringGeometry,
  PolygonGeometry
} from '../importer/geometry.js';
import type { TripPlannerCoordinate } from './types.js';

type CartesianPoint = {
  x: number;
  y: number;
};

type PlanarProjector = {
  toCartesian: (coordinate: GeoJsonCoordinate) => CartesianPoint;
};

type RouteSegment = {
  end: GeoJsonCoordinate;
  start: GeoJsonCoordinate;
};

const EARTH_METERS_PER_DEGREE = 111_320;

const clamp = (value: number, min: number, max: number) => {
  return Math.min(Math.max(value, min), max);
};

const toRadians = (value: number) => (value * Math.PI) / 180;

const createProjector = (reference: TripPlannerCoordinate): PlanarProjector => {
  const metersPerDegreeLat = EARTH_METERS_PER_DEGREE;
  const metersPerDegreeLon =
    EARTH_METERS_PER_DEGREE * Math.cos(toRadians(clamp(reference.lat, -89.9999, 89.9999)));

  return {
    toCartesian: ([lon, lat]) => ({
      x: (lon - reference.lon) * metersPerDegreeLon,
      y: (lat - reference.lat) * metersPerDegreeLat
    })
  };
};

const createBBoxReferencePoint = (boundingBox: BoundingBox): TripPlannerCoordinate => {
  return {
    lat: (boundingBox.minLat + boundingBox.maxLat) / 2,
    lon: (boundingBox.minLon + boundingBox.maxLon) / 2
  };
};

const subtract = (a: CartesianPoint, b: CartesianPoint) => ({
  x: a.x - b.x,
  y: a.y - b.y
});

const dot = (a: CartesianPoint, b: CartesianPoint) => a.x * b.x + a.y * b.y;

const squaredLength = (point: CartesianPoint) => point.x * point.x + point.y * point.y;

const pointToSegmentDistanceMeters = (
  point: CartesianPoint,
  start: CartesianPoint,
  end: CartesianPoint
) => {
  const segment = subtract(end, start);
  const segmentLength = squaredLength(segment);

  if (segmentLength === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const projection = clamp(dot(subtract(point, start), segment) / segmentLength, 0, 1);
  const closest = {
    x: start.x + segment.x * projection,
    y: start.y + segment.y * projection
  };

  return Math.hypot(point.x - closest.x, point.y - closest.y);
};

const projectPointToSegment = (
  point: CartesianPoint,
  start: CartesianPoint,
  end: CartesianPoint
) => {
  const segment = subtract(end, start);
  const segmentLengthSquared = squaredLength(segment);

  if (segmentLengthSquared === 0) {
    return {
      distanceMeters: Math.hypot(point.x - start.x, point.y - start.y),
      projection: 0,
      segmentLengthMeters: 0
    };
  }

  const projection = clamp(dot(subtract(point, start), segment) / segmentLengthSquared, 0, 1);
  const closest = {
    x: start.x + segment.x * projection,
    y: start.y + segment.y * projection
  };

  return {
    distanceMeters: Math.hypot(point.x - closest.x, point.y - closest.y),
    projection,
    segmentLengthMeters: Math.sqrt(segmentLengthSquared)
  };
};

const pointToSegmentDistanceSquared = (
  point: CartesianPoint,
  start: CartesianPoint,
  end: CartesianPoint
) => {
  const distance = pointToSegmentDistanceMeters(point, start, end);
  return distance * distance;
};

const cross = (a: CartesianPoint, b: CartesianPoint, c: CartesianPoint) => {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
};

const isPointOnSegment = (point: CartesianPoint, start: CartesianPoint, end: CartesianPoint) => {
  const minX = Math.min(start.x, end.x) - 1e-9;
  const maxX = Math.max(start.x, end.x) + 1e-9;
  const minY = Math.min(start.y, end.y) - 1e-9;
  const maxY = Math.max(start.y, end.y) + 1e-9;

  return (
    Math.abs(cross(start, end, point)) <= 1e-9 &&
    point.x >= minX &&
    point.x <= maxX &&
    point.y >= minY &&
    point.y <= maxY
  );
};

const segmentsIntersect = (
  firstStart: CartesianPoint,
  firstEnd: CartesianPoint,
  secondStart: CartesianPoint,
  secondEnd: CartesianPoint
) => {
  const d1 = cross(firstStart, firstEnd, secondStart);
  const d2 = cross(firstStart, firstEnd, secondEnd);
  const d3 = cross(secondStart, secondEnd, firstStart);
  const d4 = cross(secondStart, secondEnd, firstEnd);
  const firstStraddles = d1 * d2 < 0;
  const secondStraddles = d3 * d4 < 0;

  if (firstStraddles && secondStraddles) {
    return true;
  }

  return (
    isPointOnSegment(secondStart, firstStart, firstEnd) ||
    isPointOnSegment(secondEnd, firstStart, firstEnd) ||
    isPointOnSegment(firstStart, secondStart, secondEnd) ||
    isPointOnSegment(firstEnd, secondStart, secondEnd)
  );
};

const segmentToSegmentDistanceMeters = (
  firstStart: CartesianPoint,
  firstEnd: CartesianPoint,
  secondStart: CartesianPoint,
  secondEnd: CartesianPoint
) => {
  if (segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd)) {
    return 0;
  }

  return Math.min(
    pointToSegmentDistanceMeters(firstStart, secondStart, secondEnd),
    pointToSegmentDistanceMeters(firstEnd, secondStart, secondEnd),
    pointToSegmentDistanceMeters(secondStart, firstStart, firstEnd),
    pointToSegmentDistanceMeters(secondEnd, firstStart, firstEnd)
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

const createSegments = (coordinates: GeoJsonCoordinate[]) => {
  const segments: RouteSegment[] = [];

  for (let index = 1; index < coordinates.length; index += 1) {
    segments.push({
      end: coordinates[index]!,
      start: coordinates[index - 1]!
    });
  }

  return segments;
};

const simplifyLineStringCoordinates = (
  coordinates: GeoJsonCoordinate[],
  toleranceMeters: number,
  projector: PlanarProjector
) => {
  if (coordinates.length <= 2 || toleranceMeters <= 0) {
    return coordinates;
  }

  const projectedCoordinates = coordinates.map((coordinate) => projector.toCartesian(coordinate));
  const keep = new Array(coordinates.length).fill(false);
  const segmentsToProcess: Array<[number, number]> = [[0, coordinates.length - 1]];
  const toleranceSquared = toleranceMeters * toleranceMeters;

  keep[0] = true;
  keep[coordinates.length - 1] = true;

  while (segmentsToProcess.length > 0) {
    const [startIndex, endIndex] = segmentsToProcess.pop()!;
    const segmentStart = projectedCoordinates[startIndex]!;
    const segmentEnd = projectedCoordinates[endIndex]!;
    let farthestDistanceSquared = 0;
    let farthestIndex = -1;

    for (let index = startIndex + 1; index < endIndex; index += 1) {
      const distanceSquared = pointToSegmentDistanceSquared(
        projectedCoordinates[index]!,
        segmentStart,
        segmentEnd
      );

      if (distanceSquared > farthestDistanceSquared) {
        farthestDistanceSquared = distanceSquared;
        farthestIndex = index;
      }
    }

    if (farthestIndex !== -1 && farthestDistanceSquared > toleranceSquared) {
      keep[farthestIndex] = true;
      segmentsToProcess.push([startIndex, farthestIndex], [farthestIndex, endIndex]);
    }
  }

  return coordinates.filter((_, index) => keep[index]);
};

const getRouteSegments = (route: GeoJsonFeatureCollection) => {
  return route.features.flatMap((feature) =>
    feature.geometry.type === 'LineString' ? createSegments(feature.geometry.coordinates) : []
  );
};

const getRoutePoints = (route: GeoJsonFeatureCollection) => {
  return route.features.flatMap((feature) =>
    feature.geometry.type === 'LineString' ? feature.geometry.coordinates : []
  );
};

const ringDistanceMeters = (
  routeSegments: RouteSegment[],
  ring: GeoJsonCoordinate[],
  projector: PlanarProjector
) => {
  const ringSegments = createSegments(ring);

  if (ringSegments.length === 0 || routeSegments.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  let minimumDistance = Number.POSITIVE_INFINITY;

  for (const routeSegment of routeSegments) {
    const routeStart = projector.toCartesian(routeSegment.start);
    const routeEnd = projector.toCartesian(routeSegment.end);

    for (const ringSegment of ringSegments) {
      const ringStart = projector.toCartesian(ringSegment.start);
      const ringEnd = projector.toCartesian(ringSegment.end);
      minimumDistance = Math.min(
        minimumDistance,
        segmentToSegmentDistanceMeters(routeStart, routeEnd, ringStart, ringEnd)
      );

      if (minimumDistance === 0) {
        return 0;
      }
    }
  }

  return minimumDistance;
};

const getRouteToLineStringDistanceMeters = (
  routeSegments: RouteSegment[],
  lineString: LineStringGeometry,
  projector: PlanarProjector
) => {
  const lineSegments = createSegments(lineString.coordinates);

  if (routeSegments.length === 0 || lineSegments.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  let minimumDistance = Number.POSITIVE_INFINITY;

  for (const routeSegment of routeSegments) {
    const routeStart = projector.toCartesian(routeSegment.start);
    const routeEnd = projector.toCartesian(routeSegment.end);

    for (const lineSegment of lineSegments) {
      const lineStart = projector.toCartesian(lineSegment.start);
      const lineEnd = projector.toCartesian(lineSegment.end);
      minimumDistance = Math.min(
        minimumDistance,
        segmentToSegmentDistanceMeters(routeStart, routeEnd, lineStart, lineEnd)
      );

      if (minimumDistance === 0) {
        return 0;
      }
    }
  }

  return minimumDistance;
};

const getRouteToPolygonDistanceMeters = (
  routeSegments: RouteSegment[],
  routePoints: GeoJsonCoordinate[],
  polygon: PolygonGeometry,
  projector: PlanarProjector
) => {
  if (routePoints.some((point) => pointInPolygon(point, polygon))) {
    return 0;
  }

  let minimumDistance = Number.POSITIVE_INFINITY;

  for (const ring of polygon.coordinates) {
    minimumDistance = Math.min(minimumDistance, ringDistanceMeters(routeSegments, ring, projector));

    if (minimumDistance === 0) {
      return 0;
    }
  }

  return minimumDistance;
};

const pointToLineStringDistanceMeters = (
  point: GeoJsonCoordinate,
  lineString: LineStringGeometry,
  projector: PlanarProjector
) => {
  const lineSegments = createSegments(lineString.coordinates);

  if (lineSegments.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  const projectedPoint = projector.toCartesian(point);

  return lineSegments.reduce((minimumDistance, lineSegment) => {
    const lineStart = projector.toCartesian(lineSegment.start);
    const lineEnd = projector.toCartesian(lineSegment.end);

    return Math.min(
      minimumDistance,
      pointToSegmentDistanceMeters(projectedPoint, lineStart, lineEnd)
    );
  }, Number.POSITIVE_INFINITY);
};

const pointToPolygonDistanceMeters = (
  point: GeoJsonCoordinate,
  polygon: PolygonGeometry,
  projector: PlanarProjector
) => {
  if (pointInPolygon(point, polygon)) {
    return 0;
  }

  let minimumDistance = Number.POSITIVE_INFINITY;
  const projectedPoint = projector.toCartesian(point);

  for (const ring of polygon.coordinates) {
    const ringSegments = createSegments(ring);

    for (const ringSegment of ringSegments) {
      const ringStart = projector.toCartesian(ringSegment.start);
      const ringEnd = projector.toCartesian(ringSegment.end);

      minimumDistance = Math.min(
        minimumDistance,
        pointToSegmentDistanceMeters(projectedPoint, ringStart, ringEnd)
      );
    }
  }

  return minimumDistance;
};

const createBoundingBoxPolygon = (boundingBox: BoundingBox): PolygonGeometry => ({
  coordinates: [
    [
      [boundingBox.minLon, boundingBox.minLat],
      [boundingBox.maxLon, boundingBox.minLat],
      [boundingBox.maxLon, boundingBox.maxLat],
      [boundingBox.minLon, boundingBox.maxLat],
      [boundingBox.minLon, boundingBox.minLat]
    ]
  ],
  type: 'Polygon'
});

export const deriveBoundingBox = (route: GeoJsonFeatureCollection): BoundingBox => {
  return route.features.reduce<BoundingBox>(
    (boundingBox, feature) => {
      const coordinates =
        feature.geometry.type === 'LineString'
          ? feature.geometry.coordinates
          : feature.geometry.coordinates.flat();

      for (const [lon, lat] of coordinates) {
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

export const simplifyRouteGeometry = (
  route: GeoJsonFeatureCollection,
  toleranceMeters: number
): GeoJsonFeatureCollection => {
  if (toleranceMeters <= 0 || route.features.length === 0) {
    return route;
  }

  const routeBoundingBox = deriveBoundingBox(route);

  if (
    !Number.isFinite(routeBoundingBox.minLat) ||
    !Number.isFinite(routeBoundingBox.minLon) ||
    !Number.isFinite(routeBoundingBox.maxLat) ||
    !Number.isFinite(routeBoundingBox.maxLon)
  ) {
    return route;
  }

  const projector = createProjector(createBBoxReferencePoint(routeBoundingBox));
  let hasChanges = false;
  const simplifiedFeatures = route.features.map((feature) => {
    if (feature.geometry.type !== 'LineString') {
      return feature;
    }

    const simplifiedCoordinates = simplifyLineStringCoordinates(
      feature.geometry.coordinates,
      toleranceMeters,
      projector
    );

    if (simplifiedCoordinates.length === feature.geometry.coordinates.length) {
      return feature;
    }

    hasChanges = true;

    return {
      ...feature,
      geometry: {
        ...feature.geometry,
        coordinates: simplifiedCoordinates
      }
    };
  });

  if (!hasChanges) {
    return route;
  }

  return {
    ...route,
    features: simplifiedFeatures
  };
};

export const toRouteLineString = (route: GeoJsonFeatureCollection): LineStringGeometry | null => {
  const coordinates = route.features.flatMap((feature) =>
    feature.geometry.type === 'LineString' ? feature.geometry.coordinates : []
  );

  if (coordinates.length < 2) {
    return null;
  }

  const deduplicatedCoordinates = coordinates.filter((coordinate, index) => {
    if (index === 0) {
      return true;
    }

    const previous = coordinates[index - 1]!;

    return coordinate[0] !== previous[0] || coordinate[1] !== previous[1];
  });

  if (deduplicatedCoordinates.length < 2) {
    return null;
  }

  return {
    coordinates: deduplicatedCoordinates,
    type: 'LineString'
  };
};

export const expandBoundingBoxByKm = (
  boundingBox: BoundingBox,
  distanceKm: number
): BoundingBox => {
  const centerLat = (boundingBox.minLat + boundingBox.maxLat) / 2;
  const latDelta = distanceKm / 110.574;
  const lonDelta = distanceKm / (111.32 * Math.cos(toRadians(clamp(centerLat, -89.9999, 89.9999))));

  return {
    maxLat: boundingBox.maxLat + latDelta,
    maxLon: boundingBox.maxLon + lonDelta,
    minLat: boundingBox.minLat - latDelta,
    minLon: boundingBox.minLon - lonDelta
  };
};

export const boundingBoxesIntersect = (first: BoundingBox, second: BoundingBox) => {
  return !(
    first.maxLon < second.minLon ||
    first.minLon > second.maxLon ||
    first.maxLat < second.minLat ||
    first.minLat > second.maxLat
  );
};

export const getRouteDistanceToPointMeters = (
  route: GeoJsonFeatureCollection,
  point: TripPlannerCoordinate
) => {
  const routeBoundingBox = deriveBoundingBox(route);
  const projector = createProjector(createBBoxReferencePoint(routeBoundingBox));
  const routeSegments = getRouteSegments(route);
  const projectedPoint = projector.toCartesian([point.lon, point.lat]);

  if (routeSegments.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  return routeSegments.reduce((minimumDistance, routeSegment) => {
    const routeStart = projector.toCartesian(routeSegment.start);
    const routeEnd = projector.toCartesian(routeSegment.end);

    return Math.min(
      minimumDistance,
      pointToSegmentDistanceMeters(projectedPoint, routeStart, routeEnd)
    );
  }, Number.POSITIVE_INFINITY);
};

export const getPointDistanceToBoundingBoxMeters = (
  point: TripPlannerCoordinate,
  boundingBox: BoundingBox
) => {
  return getPointDistanceToPolygonMeters(point, createBoundingBoxPolygon(boundingBox));
};

export const getPointDistanceToPolygonMeters = (
  point: TripPlannerCoordinate,
  polygon: PolygonGeometry
) => {
  const pointBoundingBox = {
    maxLat: point.lat,
    maxLon: point.lon,
    minLat: point.lat,
    minLon: point.lon
  };
  const polygonBoundingBox = deriveBoundingBox({
    features: [{ geometry: polygon, type: 'Feature' }],
    type: 'FeatureCollection'
  });
  const projector = createProjector(
    createBBoxReferencePoint({
      maxLat: Math.max(pointBoundingBox.maxLat, polygonBoundingBox.maxLat),
      maxLon: Math.max(pointBoundingBox.maxLon, polygonBoundingBox.maxLon),
      minLat: Math.min(pointBoundingBox.minLat, polygonBoundingBox.minLat),
      minLon: Math.min(pointBoundingBox.minLon, polygonBoundingBox.minLon)
    })
  );

  return pointToPolygonDistanceMeters([point.lon, point.lat], polygon, projector);
};

export const getPointDistanceToLineStringMeters = (
  point: TripPlannerCoordinate,
  lineString: LineStringGeometry
) => {
  const pointBoundingBox = {
    maxLat: point.lat,
    maxLon: point.lon,
    minLat: point.lat,
    minLon: point.lon
  };
  const lineBoundingBox = deriveBoundingBox({
    features: [{ geometry: lineString, type: 'Feature' }],
    type: 'FeatureCollection'
  });
  const projector = createProjector(
    createBBoxReferencePoint({
      maxLat: Math.max(pointBoundingBox.maxLat, lineBoundingBox.maxLat),
      maxLon: Math.max(pointBoundingBox.maxLon, lineBoundingBox.maxLon),
      minLat: Math.min(pointBoundingBox.minLat, lineBoundingBox.minLat),
      minLon: Math.min(pointBoundingBox.minLon, lineBoundingBox.minLon)
    })
  );

  return pointToLineStringDistanceMeters([point.lon, point.lat], lineString, projector);
};

export const getPointDistanceToFeatureCollectionMeters = (
  point: TripPlannerCoordinate,
  featureCollection: GeoJsonFeatureCollection
) => {
  let minimumDistance = Number.POSITIVE_INFINITY;

  for (const feature of featureCollection.features) {
    minimumDistance = Math.min(
      minimumDistance,
      feature.geometry.type === 'Polygon'
        ? getPointDistanceToPolygonMeters(point, feature.geometry)
        : getPointDistanceToLineStringMeters(point, feature.geometry)
    );

    if (minimumDistance === 0) {
      return 0;
    }
  }

  return minimumDistance;
};

export const getDistanceAlongRouteToPointMeters = (
  route: LineStringGeometry,
  point: TripPlannerCoordinate
) => {
  if (route.coordinates.length < 2) {
    return Number.POSITIVE_INFINITY;
  }

  const [referenceLon, referenceLat] = route.coordinates[0]!;
  const projector = createProjector({
    lat: referenceLat,
    lon: referenceLon
  });
  const projectedPoint = projector.toCartesian([point.lon, point.lat]);
  let bestDistanceMeters = Number.POSITIVE_INFINITY;
  let bestDistanceAlongRouteMeters = Number.POSITIVE_INFINITY;
  let cumulativeDistanceMeters = 0;

  for (let index = 1; index < route.coordinates.length; index += 1) {
    const start = projector.toCartesian(route.coordinates[index - 1]!);
    const end = projector.toCartesian(route.coordinates[index]!);
    const projection = projectPointToSegment(projectedPoint, start, end);
    const distanceAlongRouteMeters =
      cumulativeDistanceMeters + projection.segmentLengthMeters * projection.projection;

    if (projection.distanceMeters < bestDistanceMeters) {
      bestDistanceMeters = projection.distanceMeters;
      bestDistanceAlongRouteMeters = distanceAlongRouteMeters;
    }

    cumulativeDistanceMeters += projection.segmentLengthMeters;
  }

  return bestDistanceAlongRouteMeters;
};

export const getRouteDistanceToBoundingBoxMeters = (
  route: GeoJsonFeatureCollection,
  boundingBox: BoundingBox
) => {
  return getRouteDistanceToPolygonMeters(route, createBoundingBoxPolygon(boundingBox));
};

export const getRouteDistanceToPolygonMeters = (
  route: GeoJsonFeatureCollection,
  polygon: PolygonGeometry
) => {
  const routeBoundingBox = deriveBoundingBox(route);
  const polygonBoundingBox = deriveBoundingBox({
    features: [{ geometry: polygon, type: 'Feature' }],
    type: 'FeatureCollection'
  });
  const projector = createProjector(
    createBBoxReferencePoint({
      maxLat: Math.max(routeBoundingBox.maxLat, polygonBoundingBox.maxLat),
      maxLon: Math.max(routeBoundingBox.maxLon, polygonBoundingBox.maxLon),
      minLat: Math.min(routeBoundingBox.minLat, polygonBoundingBox.minLat),
      minLon: Math.min(routeBoundingBox.minLon, polygonBoundingBox.minLon)
    })
  );
  const routeSegments = getRouteSegments(route);
  const routePoints = getRoutePoints(route);

  return getRouteToPolygonDistanceMeters(routeSegments, routePoints, polygon, projector);
};

export const getRouteDistanceToLineStringMeters = (
  route: GeoJsonFeatureCollection,
  lineString: LineStringGeometry
) => {
  const routeBoundingBox = deriveBoundingBox(route);
  const lineBoundingBox = deriveBoundingBox({
    features: [{ geometry: lineString, type: 'Feature' }],
    type: 'FeatureCollection'
  });
  const projector = createProjector(
    createBBoxReferencePoint({
      maxLat: Math.max(routeBoundingBox.maxLat, lineBoundingBox.maxLat),
      maxLon: Math.max(routeBoundingBox.maxLon, lineBoundingBox.maxLon),
      minLat: Math.min(routeBoundingBox.minLat, lineBoundingBox.minLat),
      minLon: Math.min(routeBoundingBox.minLon, lineBoundingBox.minLon)
    })
  );

  return getRouteToLineStringDistanceMeters(getRouteSegments(route), lineString, projector);
};

export const getRouteDistanceToFeatureCollectionMeters = (
  route: GeoJsonFeatureCollection,
  featureCollection: GeoJsonFeatureCollection
) => {
  let minimumDistance = Number.POSITIVE_INFINITY;

  for (const feature of featureCollection.features) {
    minimumDistance = Math.min(
      minimumDistance,
      feature.geometry.type === 'Polygon'
        ? getRouteDistanceToPolygonMeters(route, feature.geometry)
        : getRouteDistanceToLineStringMeters(route, feature.geometry)
    );

    if (minimumDistance === 0) {
      return 0;
    }
  }

  return minimumDistance;
};
