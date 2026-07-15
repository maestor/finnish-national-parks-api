import { describe, expect, it } from 'vitest';

import type { GeoJsonFeatureCollection } from '../../src/importer/geometry.js';
import {
  boundingBoxesIntersect,
  deriveBoundingBox,
  expandBoundingBoxByKm,
  getRouteDistanceToBoundingBoxMeters,
  getRouteDistanceToFeatureCollectionMeters,
  getRouteDistanceToLineStringMeters,
  getRouteDistanceToPointMeters,
  getRouteDistanceToPolygonMeters
} from '../../src/trip-planner/geometry.js';

const route: GeoJsonFeatureCollection = {
  features: [
    {
      geometry: {
        coordinates: [
          [24, 60],
          [24.1, 60]
        ],
        type: 'LineString'
      },
      type: 'Feature'
    }
  ],
  type: 'FeatureCollection'
};

describe('trip planner geometry', () => {
  it('expands route bounding boxes by corridor distance', () => {
    const boundingBox = deriveBoundingBox(route);
    const expanded = expandBoundingBoxByKm(boundingBox, 25);

    expect(boundingBox).toEqual({
      maxLat: 60,
      maxLon: 24.1,
      minLat: 60,
      minLon: 24
    });
    expect(expanded.minLat).toBeLessThan(59.8);
    expect(expanded.maxLat).toBeGreaterThan(60.2);
    expect(expanded.maxLon).toBeGreaterThan(24.5);
    expect(
      boundingBoxesIntersect(expanded, {
        maxLat: 60.2,
        maxLon: 24.2,
        minLat: 60.15,
        minLon: 24.15
      })
    ).toBe(true);
  });

  it('measures route distance to a nearby parallel linestring', () => {
    const distance = getRouteDistanceToLineStringMeters(route, {
      coordinates: [
        [24, 60.009],
        [24.1, 60.009]
      ],
      type: 'LineString'
    });

    expect(distance).toBeGreaterThan(950);
    expect(distance).toBeLessThan(1_050);
  });

  it('returns zero when route and line segments cross at an interior point', () => {
    const distance = getRouteDistanceToLineStringMeters(route, {
      coordinates: [
        [24.05, 59.99],
        [24.05, 60.01]
      ],
      type: 'LineString'
    });

    expect(distance).toBe(0);
  });

  it('returns zero when the route overlaps a polygon', () => {
    const distance = getRouteDistanceToPolygonMeters(route, {
      coordinates: [
        [
          [24.03, 59.99],
          [24.07, 59.99],
          [24.07, 60.01],
          [24.03, 60.01],
          [24.03, 59.99]
        ]
      ],
      type: 'Polygon'
    });

    expect(distance).toBe(0);
  });

  it('returns zero when a route point is inside the polygon', () => {
    const distance = getRouteDistanceToPolygonMeters(
      {
        features: [
          {
            geometry: {
              coordinates: [
                [24.04, 60],
                [24.1, 60]
              ],
              type: 'LineString'
            },
            type: 'Feature'
          }
        ],
        type: 'FeatureCollection'
      },
      {
        coordinates: [
          [
            [24.03, 59.99],
            [24.07, 59.99],
            [24.07, 60.01],
            [24.03, 60.01],
            [24.03, 59.99]
          ]
        ],
        type: 'Polygon'
      }
    );

    expect(distance).toBe(0);
  });

  it('treats points inside polygon holes as outside the area', () => {
    const distance = getRouteDistanceToPolygonMeters(
      {
        features: [
          {
            geometry: {
              coordinates: [
                [24.045, 60],
                [24.055, 60]
              ],
              type: 'LineString'
            },
            type: 'Feature'
          }
        ],
        type: 'FeatureCollection'
      },
      {
        coordinates: [
          [
            [24.03, 59.99],
            [24.07, 59.99],
            [24.07, 60.01],
            [24.03, 60.01],
            [24.03, 59.99]
          ],
          [
            [24.04, 59.995],
            [24.06, 59.995],
            [24.06, 60.005],
            [24.04, 60.005],
            [24.04, 59.995]
          ]
        ],
        type: 'Polygon'
      }
    );

    expect(distance).toBeGreaterThan(250);
    expect(distance).toBeLessThan(300);
  });

  it('still treats a point inside the outer shell as inside when it is outside the hole', () => {
    const distance = getRouteDistanceToPolygonMeters(
      {
        features: [
          {
            geometry: {
              coordinates: [
                [24.035, 60],
                [24.1, 60]
              ],
              type: 'LineString'
            },
            type: 'Feature'
          }
        ],
        type: 'FeatureCollection'
      },
      {
        coordinates: [
          [
            [24.03, 59.99],
            [24.07, 59.99],
            [24.07, 60.01],
            [24.03, 60.01],
            [24.03, 59.99]
          ],
          [
            [24.04, 59.995],
            [24.06, 59.995],
            [24.06, 60.005],
            [24.04, 60.005],
            [24.04, 59.995]
          ]
        ],
        type: 'Polygon'
      }
    );

    expect(distance).toBe(0);
  });

  it('uses the nearest feature distance from a mixed park geometry collection', () => {
    const distance = getRouteDistanceToFeatureCollectionMeters(route, {
      features: [
        {
          geometry: {
            coordinates: [
              [
                [24.02, 60.03],
                [24.04, 60.03],
                [24.04, 60.05],
                [24.02, 60.05],
                [24.02, 60.03]
              ]
            ],
            type: 'Polygon'
          },
          type: 'Feature'
        },
        {
          geometry: {
            coordinates: [
              [24.05, 60.018],
              [24.08, 60.018]
            ],
            type: 'LineString'
          },
          type: 'Feature'
        }
      ],
      type: 'FeatureCollection'
    });

    expect(distance).toBeGreaterThan(1_900);
    expect(distance).toBeLessThan(2_100);
  });

  it('returns infinite distance for an empty route and supports bounding box wrappers', () => {
    const emptyRoute: GeoJsonFeatureCollection = {
      features: [],
      type: 'FeatureCollection'
    };

    expect(
      getRouteDistanceToPointMeters(emptyRoute, {
        lat: 60,
        lon: 24
      })
    ).toBe(Number.POSITIVE_INFINITY);

    const distance = getRouteDistanceToBoundingBoxMeters(route, {
      maxLat: 60.01,
      maxLon: 24.08,
      minLat: 59.99,
      minLon: 24.04
    });

    expect(distance).toBe(0);
  });

  it('ignores non-linestring route features and handles ringless polygons defensively', () => {
    const mixedRoute: GeoJsonFeatureCollection = {
      features: [
        {
          geometry: {
            coordinates: [
              [
                [23.9, 59.9],
                [23.95, 59.9],
                [23.95, 59.95],
                [23.9, 59.95],
                [23.9, 59.9]
              ]
            ],
            type: 'Polygon'
          },
          type: 'Feature'
        },
        route.features[0]!
      ],
      type: 'FeatureCollection'
    };

    expect(
      getRouteDistanceToPolygonMeters(mixedRoute, {
        coordinates: [
          [
            [24.03, 59.99],
            [24.07, 59.99],
            [24.07, 60.01],
            [24.03, 60.01],
            [24.03, 59.99]
          ]
        ],
        type: 'Polygon'
      })
    ).toBe(0);

    expect(
      getRouteDistanceToPolygonMeters(route, {
        coordinates: [],
        type: 'Polygon'
      })
    ).toBe(Number.POSITIVE_INFINITY);
  });

  it('handles degenerate and collinear route segments', () => {
    const degenerateRoute: GeoJsonFeatureCollection = {
      features: [
        {
          geometry: {
            coordinates: [
              [24, 60],
              [24, 60]
            ],
            type: 'LineString'
          },
          type: 'Feature'
        }
      ],
      type: 'FeatureCollection'
    };

    const pointDistance = getRouteDistanceToPointMeters(degenerateRoute, {
      lat: 60.01,
      lon: 24
    });
    const lineDistance = getRouteDistanceToLineStringMeters(degenerateRoute, {
      coordinates: [
        [24, 60],
        [24.02, 60]
      ],
      type: 'LineString'
    });

    expect(pointDistance).toBeGreaterThan(1_000);
    expect(pointDistance).toBeLessThan(1_200);
    expect(lineDistance).toBe(0);
  });

  it('returns infinite distances when a route has fewer than two points', () => {
    const singlePointRoute: GeoJsonFeatureCollection = {
      features: [
        {
          geometry: {
            coordinates: [[24, 60]],
            type: 'LineString'
          },
          type: 'Feature'
        }
      ],
      type: 'FeatureCollection'
    };

    expect(
      getRouteDistanceToPolygonMeters(singlePointRoute, {
        coordinates: [
          [
            [24.03, 59.99],
            [24.07, 59.99],
            [24.07, 60.01],
            [24.03, 60.01],
            [24.03, 59.99]
          ]
        ],
        type: 'Polygon'
      })
    ).toBe(Number.POSITIVE_INFINITY);

    expect(
      getRouteDistanceToLineStringMeters(singlePointRoute, {
        coordinates: [
          [24.03, 60],
          [24.07, 60]
        ],
        type: 'LineString'
      })
    ).toBe(Number.POSITIVE_INFINITY);
  });
});
