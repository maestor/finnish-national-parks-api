import { describe, expect, it } from 'vitest';

import type { GeoJsonFeatureCollection } from '../../src/importer/geometry.js';
import {
  deriveBoundingBox,
  hasAnyPointInsideArea,
  isFullyInsideArea
} from '../../src/importer/geometry.js';

describe('geometry helpers', () => {
  it('derives bounds from a mixed polygon and linestring feature collection', () => {
    const boundingBox = deriveBoundingBox({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [24, 60],
                [26, 60],
                [26, 62],
                [24, 62],
                [24, 60]
              ]
            ]
          }
        },
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [30, 64],
              [31, 65]
            ]
          }
        }
      ]
    });

    expect(boundingBox).toEqual({
      minLon: 24,
      minLat: 60,
      maxLon: 31,
      maxLat: 65
    });
  });

  it('treats routes inside polygon holes as outside the area', () => {
    const area: GeoJsonFeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [24, 60],
                [30, 60],
                [30, 66],
                [24, 66],
                [24, 60]
              ],
              [
                [26, 62],
                [28, 62],
                [28, 64],
                [26, 64],
                [26, 62]
              ]
            ]
          }
        }
      ]
    };

    const routeInsideHole: GeoJsonFeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [26.5, 62.5],
              [27, 63],
              [27.5, 63.5]
            ]
          }
        }
      ]
    };

    expect(isFullyInsideArea(routeInsideHole, area)).toBe(false);
  });

  it('treats routes inside the outer polygon and outside its holes as inside the area', () => {
    const area: GeoJsonFeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [24, 60],
                [30, 60],
                [30, 66],
                [24, 66],
                [24, 60]
              ],
              [
                [26, 62],
                [28, 62],
                [28, 64],
                [26, 64],
                [26, 62]
              ]
            ]
          }
        }
      ]
    };

    const routeOutsideHole: GeoJsonFeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [24.5, 60.5],
              [25, 61],
              [25.5, 61.5]
            ]
          }
        }
      ]
    };

    expect(isFullyInsideArea(routeOutsideHole, area)).toBe(true);
    expect(hasAnyPointInsideArea(routeOutsideHole, area)).toBe(true);
  });

  it('detects partial route overlap when any linestring point is inside the area', () => {
    const area: GeoJsonFeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [24, 60],
                [30, 60],
                [30, 66],
                [24, 66],
                [24, 60]
              ]
            ]
          }
        }
      ]
    };

    const partiallyOverlappingRoute: GeoJsonFeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [23.5, 59.5],
              [24.5, 60.5],
              [31, 67]
            ]
          }
        }
      ]
    };

    expect(hasAnyPointInsideArea(partiallyOverlappingRoute, area)).toBe(true);
    expect(isFullyInsideArea(partiallyOverlappingRoute, area)).toBe(false);
  });

  it('treats empty polygons and non-linestring route features as outside the area', () => {
    const emptyArea: GeoJsonFeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: []
          }
        }
      ]
    };

    const lineRouteAgainstEmptyArea: GeoJsonFeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [24.5, 60.5],
              [24.7, 60.7]
            ]
          }
        }
      ]
    };

    const polygonOnlyRoute: GeoJsonFeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [24, 60],
                [25, 60],
                [25, 61],
                [24, 61],
                [24, 60]
              ]
            ]
          }
        }
      ]
    };

    expect(isFullyInsideArea(lineRouteAgainstEmptyArea, emptyArea)).toBe(false);
    expect(isFullyInsideArea(polygonOnlyRoute, emptyArea)).toBe(false);
    expect(hasAnyPointInsideArea(lineRouteAgainstEmptyArea, emptyArea)).toBe(false);
    expect(hasAnyPointInsideArea(polygonOnlyRoute, emptyArea)).toBe(false);
  });
});
