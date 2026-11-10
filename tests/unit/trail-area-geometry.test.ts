import proj4 from 'proj4';
import { describe, expect, it } from 'vitest';

import type { GeoJsonFeatureCollection } from '../../src/importer/geometry.js';
import {
  measureTrailAreaOverlap,
  qualifiesTrailAreaOverlap
} from '../../src/importer/trail-area-geometry.js';

const line = (...coordinates: [number, number][]): GeoJsonFeatureCollection => ({
  type: 'FeatureCollection',
  features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates } }]
});
const polygon = (...rings: [number, number][][]): GeoJsonFeatureCollection => ({
  type: 'FeatureCollection',
  features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: rings } }]
});
const square = (west: number, east: number, south = 60, north = 60.01): [number, number][] => [
  [west, south],
  [east, south],
  [east, north],
  [west, north],
  [west, south]
];

describe('trail–area length measurement', () => {
  it('clips crossing segments by length and treats boundary-only contact as outside', () => {
    const area = polygon(square(24, 24.01));
    const crossing = measureTrailAreaOverlap(line([23.99, 60.005], [24.02, 60.005]), area);
    expect(crossing.status).toBe('ok');
    if (crossing.status === 'ok') expect(crossing.ratio).toBeCloseTo(1 / 3, 3);
    const boundary = measureTrailAreaOverlap(line([24, 60], [24.01, 60]), area);
    expect(boundary.status === 'ok' && boundary.overlapMetres).toBe(0);
    const partialBoundary = measureTrailAreaOverlap(line([24.002, 60.01], [24.008, 60.01]), area);
    expect(partialBoundary.status === 'ok' && partialBoundary.overlapMetres).toBe(0);
  });

  it('excludes holes and unions repeated route segments', () => {
    const area = polygon(square(24, 24.02), square(24.005, 24.015, 60.002, 60.008));
    const route = line([24, 60.005], [24.02, 60.005], [24, 60.005]);
    const result = measureTrailAreaOverlap(route, area);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.ratio).toBeCloseTo(0.5, 3);
  });

  it('accepts exactly ten percent and does not impose a distance floor', () => {
    expect(qualifiesTrailAreaOverlap(0.1)).toBe(true);
    expect(qualifiesTrailAreaOverlap(0.099)).toBe(false);
    const tiny = measureTrailAreaOverlap(
      line([24.0001, 60.0001], [24.00011, 60.0001]),
      polygon(square(24, 24.01))
    );
    expect(tiny.status).toBe('ok');
    if (tiny.status === 'ok') {
      expect(tiny.routeMetres).toBeLessThan(100);
      expect(qualifiesTrailAreaOverlap(tiny.ratio)).toBe(true);
    }
  });

  it('measures the threshold from projected length and handles separate polygons independently', () => {
    const inverse = (x: number, y: number): [number, number] =>
      proj4('+proj=utm +zone=35 +ellps=GRS80 +units=m +no_defs', 'WGS84', [x, y]) as [
        number,
        number
      ];
    const route = line(inverse(400000, 6700000), inverse(400100, 6700000));
    const area = (end: number) =>
      polygon([
        inverse(400000, 6699990),
        inverse(end, 6699990),
        inverse(end, 6700010),
        inverse(400000, 6700010),
        inverse(400000, 6699990)
      ]);
    const exact = measureTrailAreaOverlap(route, area(400010));
    const below = measureTrailAreaOverlap(route, area(400009));
    expect(exact.status).toBe('ok');
    expect(below.status).toBe('ok');
    if (exact.status === 'ok' && below.status === 'ok') {
      expect(exact.ratio).toBeCloseTo(0.1, 7);
      expect(qualifiesTrailAreaOverlap(exact.ratio)).toBe(true);
      expect(qualifiesTrailAreaOverlap(below.ratio)).toBe(false);
    }
  });
  it('clips concave exits and combines multipart polygons and lines without double counting', () => {
    const concave = polygon([
      [24, 60],
      [24.02, 60],
      [24.02, 60.02],
      [24.015, 60.02],
      [24.015, 60.005],
      [24.005, 60.005],
      [24.005, 60.02],
      [24, 60.02],
      [24, 60]
    ]);
    const crossing = line([24.001, 60.01], [24.019, 60.01]);
    const result = measureTrailAreaOverlap(crossing, concave);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.ratio).toBeCloseTo(8 / 18, 2);
    const multi: GeoJsonFeatureCollection = {
      type: 'FeatureCollection',
      features: [
        ...polygon(square(24, 24.005)).features,
        ...polygon(square(24.015, 24.02)).features
      ]
    };
    const route: GeoJsonFeatureCollection = {
      type: 'FeatureCollection',
      features: [
        ...line([24, 60.005], [24.01, 60.005]).features,
        ...line([24.01, 60.005], [24.02, 60.005]).features
      ]
    };
    const measured = measureTrailAreaOverlap(route, multi);
    expect(measured.status).toBe('ok');
    if (measured.status === 'ok') expect(measured.ratio).toBeCloseTo(0.5, 3);
  });

  it('reports missing and invalid geometries instead of inventing a match', () => {
    const area = polygon(square(24, 24.01));
    expect(measureTrailAreaOverlap(area, area).status).toBe('missing-line');
    expect(
      measureTrailAreaOverlap(line([24, 60], [24.01, 60]), line([24, 60], [24.01, 60])).status
    ).toBe('invalid-area');
    expect(measureTrailAreaOverlap(line([24, 60]), area).status).toBe('invalid-line');
    expect(measureTrailAreaOverlap(line([24, 60], [24, 999]), area).status).toBe('invalid-line');
    expect(
      measureTrailAreaOverlap(
        line([24, 60], [24.01, 60]),
        polygon([
          [24, 60],
          [25, 60],
          [25, 999],
          [24, 60]
        ])
      ).status
    ).toBe('invalid-area');
    expect(measureTrailAreaOverlap(line([27, 0], [117, 0]), area).status).toBe('invalid-line');
    expect(
      measureTrailAreaOverlap(
        line([24, 60], [24.01, 60]),
        polygon([
          [24, 60],
          [25, 60],
          [25, 61]
        ])
      ).status
    ).toBe('invalid-area');
    expect(measureTrailAreaOverlap(line([24, 60], [24.01, 60]), polygon([])).status).toBe(
      'invalid-area'
    );
    expect(measureTrailAreaOverlap(line([24, 60], [24, 60]), area).status).toBe('invalid-line');
    expect(
      measureTrailAreaOverlap(
        line([24, 60], [24.01, 60]),
        polygon([
          [24, 60],
          [24.01, 60.01],
          [24, 60.01],
          [24.01, 60],
          [24, 60]
        ])
      ).status
    ).toBe('invalid-area');
  });
});
