import { z } from 'zod';
import { getSupportedParkTypeByCode } from '../parks/park-types.js';
import type { BoundingBox, GeoJsonFeatureCollection } from './geometry.js';
import { deriveBoundingBox } from './geometry.js';

const coordinateSchema = z.tuple([z.number(), z.number()]).rest(z.number());

const geometryPolygonSchema = z.object({
  coordinates: z.array(z.array(coordinateSchema)),
  type: z.literal('Polygon')
});

const geometryLineStringSchema = z.object({
  coordinates: z.array(coordinateSchema),
  type: z.literal('LineString')
});

const lipasParkSchema = z.object({
  'construction-year': z.number().int().optional(),
  'event-date': z.string().datetime().optional(),
  'lipas-id': z.number().int(),
  admin: z.string(),
  comment: z.string().optional(),
  email: z.string().optional(),
  location: z.object({
    'postal-code': z.string().optional(),
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
          geometry: z.union([geometryPolygonSchema, geometryLineStringSchema]),
          type: z.literal('Feature')
        })
      ),
      type: z.literal('FeatureCollection')
    })
  }),
  name: z.string().min(1),
  owner: z.string(),
  'phone-number': z.string().optional(),
  properties: z
    .object({
      'area-km2': z.number().optional()
    })
    .passthrough()
    .optional(),
  status: z.string(),
  type: z.object({
    'type-code': z.number().int()
  }),
  www: z.string().optional()
});

export type LipasPark = z.infer<typeof lipasParkSchema>;

export type MappedPark = {
  areaKm2: number | null;
  boundingBox: BoundingBox;
  boundaryGeoJson: GeoJsonFeatureCollection;
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
  postalCode: string | null;
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

const normalizeLuontoonUrl = (value?: string) => {
  if (!value) {
    return null;
  }

  const normalizedInput =
    value.startsWith('http://') || value.startsWith('https://')
      ? value
      : value.startsWith('/')
        ? `https://www.luontoon.fi${value}`
        : `https://${value}`;
  const url = new URL(normalizedInput);
  const pathname = url.pathname.replace(/\/+$/, '');

  return `https://www.luontoon.fi${pathname}`;
};

const createSlug = (name: string) => {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'park';
};

export const mapLipasPark = (source: unknown, existingSlug?: string): MappedPark => {
  const park = lipasParkSchema.parse(source);
  const parkType = getSupportedParkTypeByCode(park.type['type-code']);
  const boundaryGeoJson = park.location.geometries as GeoJsonFeatureCollection;
  const boundingBox = deriveBoundingBox(boundaryGeoJson);

  return {
    areaKm2: park.properties?.['area-km2'] ?? null,
    boundingBox,
    boundaryGeoJson,
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
    postalCode: park.location['postal-code'] ?? null,
    postalOffice: park.location['postal-office'] ?? null,
    slug: existingSlug ?? createSlug(park.name),
    sourceEventDate: park['event-date'] ?? null,
    type: parkType
  };
};
