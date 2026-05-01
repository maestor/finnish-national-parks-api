import { z } from 'zod';

import { getSupportedParkTypeByCode } from '../parks/park-types.js';

const geometryPolygonSchema = z.object({
  coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))),
  type: z.literal('Polygon')
});

const lipasParkSchema = z.object({
  'construction-year': z.number().int().optional(),
  'event-date': z.string().datetime().optional(),
  'lipas-id': z.number().int(),
  admin: z.string(),
  comment: z.string().optional(),
  email: z.string().optional(),
  location: z.object({
    'postal-office': z.string().optional(),
    address: z.string().optional(),
    city: z
      .object({
        'city-code': z.number().int().optional()
      })
      .optional(),
    geometries: z.object({
      features: z.array(
        z.object({
          geometry: geometryPolygonSchema,
          type: z.literal('Feature')
        })
      ),
      type: z.literal('FeatureCollection')
    })
  }),
  name: z.string().min(1),
  owner: z.string(),
  'phone-number': z.string().optional(),
  properties: z.object({
    'area-km2': z.number().optional()
  }),
  status: z.string(),
  type: z.object({
    'type-code': z.number().int()
  }),
  www: z.string().optional()
});

export type LipasPark = z.infer<typeof lipasParkSchema>;

export type MappedPark = {
  areaKm2: number | null;
  boundingBox: {
    maxLat: number;
    maxLon: number;
    minLat: number;
    minLon: number;
  };
  boundaryGeoJson: {
    features: Array<{
      geometry: {
        coordinates: number[][][];
        type: 'Polygon';
      };
      type: 'Feature';
    }>;
    type: 'FeatureCollection';
  };
  establishmentYear: number | null;
  lipasId: number;
  locationLabel: string;
  luontoonUrl: string | null;
  markerPoint: {
    lat: number;
    lon: number;
  };
  municipalityCode: number | null;
  name: string;
  postalOffice: string | null;
  slug: string;
  sourceEventDate: string | null;
  type: {
    code: number;
    id: number;
    name: string;
    slug: string;
  };
};

function normalizeLuontoonUrl(value?: string) {
  if (!value) {
    return null;
  }

  const normalizedInput = value.startsWith('http://') || value.startsWith('https://')
    ? value
    : value.startsWith('/')
      ? `https://www.luontoon.fi${value}`
      : `https://${value}`;
  const url = new URL(normalizedInput);
  const pathname = url.pathname.replace(/\/+$/, '');

  return `https://www.luontoon.fi${pathname}`;
}

function createSlug(name: string) {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'park';
}

function deriveBoundingBox(coordinates: number[][][]) {
  let minLon = Number.POSITIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;

  for (const ring of coordinates) {
    for (const coordinate of ring) {
      const lon = coordinate[0]!;
      const lat = coordinate[1]!;

      minLon = Math.min(minLon, lon);
      minLat = Math.min(minLat, lat);
      maxLon = Math.max(maxLon, lon);
      maxLat = Math.max(maxLat, lat);
    }
  }

  return {
    maxLat,
    maxLon,
    minLat,
    minLon
  };
}

function combineBoundingBoxes(boxes: Array<ReturnType<typeof deriveBoundingBox>>) {
  return boxes.reduce(
    (combined, box) => ({
      maxLat: Math.max(combined.maxLat, box.maxLat),
      maxLon: Math.max(combined.maxLon, box.maxLon),
      minLat: Math.min(combined.minLat, box.minLat),
      minLon: Math.min(combined.minLon, box.minLon)
    }),
    {
      maxLat: Number.NEGATIVE_INFINITY,
      maxLon: Number.NEGATIVE_INFINITY,
      minLat: Number.POSITIVE_INFINITY,
      minLon: Number.POSITIVE_INFINITY
    }
  );
}

export function mapLipasPark(source: unknown, existingSlug?: string): MappedPark {
  const park = lipasParkSchema.parse(source);
  const parkType = getSupportedParkTypeByCode(park.type['type-code']);
  const boxes = park.location.geometries.features.map((feature) =>
    deriveBoundingBox(feature.geometry.coordinates)
  );
  const boundingBox = combineBoundingBoxes(boxes);

  return {
    areaKm2: park.properties['area-km2'] ?? null,
    boundingBox,
    boundaryGeoJson: park.location.geometries,
    establishmentYear: park['construction-year'] ?? null,
    lipasId: park['lipas-id'],
    locationLabel: park.location.address ?? park.location['postal-office'] ?? park.name,
    luontoonUrl: normalizeLuontoonUrl(park.www),
    markerPoint: {
      lat: (boundingBox.minLat + boundingBox.maxLat) / 2,
      lon: (boundingBox.minLon + boundingBox.maxLon) / 2
    },
    municipalityCode: park.location.city?.['city-code'] ?? null,
    name: park.name,
    postalOffice: park.location['postal-office'] ?? null,
    slug: existingSlug ?? createSlug(park.name),
    sourceEventDate: park['event-date'] ?? null,
    type: parkType
  };
}
