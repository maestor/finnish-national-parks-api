import proj4 from 'proj4';
import type { BoundingBox, GeoJsonFeatureCollection } from './geometry.js';

const projection = '+proj=utm +zone=35 +ellps=GRS80 +units=m +no_defs';
const proximityMetres = 25;
const gridSizeMetres = 100;
export const buildTrailProximity = (
  geometry: GeoJsonFeatureCollection,
  sampleSpacingMetres = 50
) => {
  const grid = new Map<string, number[][]>();
  const samples: { x: number; y: number; weight: number }[] = [];
  let length = 0;
  for (const feature of geometry.features) {
    if (feature.geometry.type !== 'LineString') continue;
    const points = feature.geometry.coordinates.map((point) =>
      proj4('WGS84', projection, point.slice(0, 2))
    );
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      const distance = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!);
      if (!distance) continue;
      const pieces = Math.ceil(distance / gridSizeMetres);
      for (let k = 0; k < pieces; k++) {
        const x1 = a[0]! + (k / pieces) * (b[0]! - a[0]!);
        const y1 = a[1]! + (k / pieces) * (b[1]! - a[1]!);
        const x2 = a[0]! + ((k + 1) / pieces) * (b[0]! - a[0]!);
        const y2 = a[1]! + ((k + 1) / pieces) * (b[1]! - a[1]!);
        const segment = [x1, y1, x2, y2];
        for (
          let x = Math.floor((Math.min(x1, x2) - proximityMetres) / gridSizeMetres);
          x <= Math.floor((Math.max(x1, x2) + proximityMetres) / gridSizeMetres);
          x++
        )
          for (
            let y = Math.floor((Math.min(y1, y2) - proximityMetres) / gridSizeMetres);
            y <= Math.floor((Math.max(y1, y2) + proximityMetres) / gridSizeMetres);
            y++
          ) {
            const key = `${x}:${y}`;
            const entries = grid.get(key) ?? [];
            entries.push(segment);
            grid.set(key, entries);
          }
      }
      length += distance;
      const n = Math.ceil(distance / sampleSpacingMetres);
      for (let j = 0; j < n; j++) {
        const t = (j + 0.5) / n;
        samples.push({
          x: a[0]! + t * (b[0]! - a[0]!),
          y: a[1]! + t * (b[1]! - a[1]!),
          weight: distance / n
        });
      }
    }
  }
  return { grid, samples, length };
};
export const measureTrailCoverage = (
  a: ReturnType<typeof buildTrailProximity>,
  b: ReturnType<typeof buildTrailProximity>
) => {
  let matched = 0;
  for (const p of a.samples)
    for (const s of b.grid.get(
      `${Math.floor(p.x / gridSizeMetres)}:${Math.floor(p.y / gridSizeMetres)}`
    ) ?? []) {
      const dx = s[2]! - s[0]!;
      const dy = s[3]! - s[1]!;
      const t = Math.max(
        0,
        Math.min(1, ((p.x - s[0]!) * dx + (p.y - s[1]!) * dy) / (dx * dx + dy * dy))
      );
      if ((p.x - s[0]! - t * dx) ** 2 + (p.y - s[1]! - t * dy) ** 2 <= proximityMetres ** 2) {
        matched += p.weight;
        break;
      }
    }
  return matched / a.length;
};
export const nearbyTrailBounds = (a: BoundingBox, b: BoundingBox) =>
  a.minLon <= b.maxLon + 0.001 &&
  a.maxLon + 0.001 >= b.minLon &&
  a.minLat <= b.maxLat + 0.001 &&
  a.maxLat + 0.001 >= b.minLat;
