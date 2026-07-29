import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeoJsonFeatureCollection } from '../../src/importer/geometry.js';
import type { TripPlannerParkCandidate } from '../../src/trip-planner/types.js';

const {
  getRouteDistanceToBoundingBoxMeters,
  getRouteDistanceToFeatureCollectionMeters,
  getRouteDistanceToPointMeters
} = vi.hoisted(() => ({
  getRouteDistanceToBoundingBoxMeters: vi.fn(),
  getRouteDistanceToFeatureCollectionMeters: vi.fn(),
  getRouteDistanceToPointMeters: vi.fn()
}));

vi.mock('../../src/trip-planner/geometry.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/trip-planner/geometry.js')>(
    '../../src/trip-planner/geometry.js'
  );

  return {
    ...actual,
    getRouteDistanceToBoundingBoxMeters,
    getRouteDistanceToFeatureCollectionMeters,
    getRouteDistanceToPointMeters
  };
});

const { getDistanceFromRouteMetersWithinThreshold } = await import(
  '../../src/trip-planner/search.js'
);

const routeGeometry: GeoJsonFeatureCollection = {
  features: [
    {
      geometry: {
        coordinates: [
          [24, 60],
          [24.2, 60]
        ],
        type: 'LineString'
      },
      type: 'Feature'
    }
  ],
  type: 'FeatureCollection'
};

const createCandidate = (
  overrides: Partial<TripPlannerParkCandidate> = {}
): TripPlannerParkCandidate => ({
  address: 'Testitie 1, 00100 Helsinki',
  boundingBox: {
    maxLat: 60.01,
    maxLon: 24.05,
    minLat: 59.99,
    minLon: 24.02
  },
  boundaryGeoJson: {
    features: [
      {
        geometry: {
          coordinates: [
            [
              [24.02, 59.99],
              [24.05, 59.99],
              [24.05, 60.01],
              [24.02, 60.01],
              [24.02, 59.99]
            ]
          ],
          type: 'Polygon'
        },
        type: 'Feature'
      }
    ],
    type: 'FeatureCollection'
  },
  category: {
    name: 'Ulkoilu-/virkistysalue',
    slug: 'outdoor-recreation-area'
  },
  locationLabel: 'Testitie 1',
  markerPoint: {
    lat: 60,
    lon: 24.03
  },
  name: 'A Park',
  postalCode: '00100',
  postalOffice: 'Helsinki',
  slug: 'a-park',
  type: {
    code: 103,
    id: 103,
    name: 'Ulkoilu-/virkistysalue',
    slug: 'outdoor-recreation-area'
  },
  visitedSummary: {
    lastVisitedOn: null,
    visitCount: 0,
    visited: false
  },
  ...overrides
});

describe('trip planner route pruning', () => {
  beforeEach(() => {
    getRouteDistanceToBoundingBoxMeters.mockReset();
    getRouteDistanceToFeatureCollectionMeters.mockReset();
    getRouteDistanceToPointMeters.mockReset();
  });

  it('short-circuits expensive boundary distance work when the bounding box is already outside the corridor', () => {
    getRouteDistanceToBoundingBoxMeters.mockReturnValue(30_000);
    getRouteDistanceToFeatureCollectionMeters.mockReturnValue(1_000);

    const result = getDistanceFromRouteMetersWithinThreshold(
      routeGeometry,
      createCandidate(),
      25_000
    );

    expect(result).toBe(Number.POSITIVE_INFINITY);
    expect(getRouteDistanceToFeatureCollectionMeters).not.toHaveBeenCalled();
    expect(getRouteDistanceToPointMeters).not.toHaveBeenCalled();
  });

  it('still computes full boundary distance when the bounding box could qualify', () => {
    getRouteDistanceToBoundingBoxMeters.mockReturnValue(9_000);
    getRouteDistanceToFeatureCollectionMeters.mockReturnValue(7_500);

    const result = getDistanceFromRouteMetersWithinThreshold(
      routeGeometry,
      createCandidate({
        boundaryGeoJson: null,
        boundaryGeoJsonSource: JSON.stringify(createCandidate().boundaryGeoJson)
      }),
      10_000
    );

    expect(result).toBe(7_500);
    expect(getRouteDistanceToFeatureCollectionMeters).toHaveBeenCalledOnce();
  });

  it('does not parse lazy boundary geometry when the bounding box is already outside the corridor', () => {
    getRouteDistanceToBoundingBoxMeters.mockReturnValue(30_000);

    const result = getDistanceFromRouteMetersWithinThreshold(
      routeGeometry,
      createCandidate({
        boundaryGeoJson: null,
        boundaryGeoJsonSource: 'not-json'
      }),
      25_000
    );

    expect(result).toBe(Number.POSITIVE_INFINITY);
    expect(getRouteDistanceToFeatureCollectionMeters).not.toHaveBeenCalled();
    expect(getRouteDistanceToPointMeters).not.toHaveBeenCalled();
  });

  it('reuses the bounding box distance directly for parks without boundary geometry', () => {
    getRouteDistanceToBoundingBoxMeters.mockReturnValue(8_000);

    const result = getDistanceFromRouteMetersWithinThreshold(
      routeGeometry,
      createCandidate({
        boundaryGeoJson: null
      }),
      25_000
    );

    expect(result).toBe(8_000);
    expect(getRouteDistanceToFeatureCollectionMeters).not.toHaveBeenCalled();
    expect(getRouteDistanceToPointMeters).not.toHaveBeenCalled();
  });
});
