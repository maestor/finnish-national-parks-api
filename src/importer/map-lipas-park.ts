import { z } from 'zod';
import { createParkSlug, normalizeLuontoonUrl } from '../parks/park-normalization.js';
import { getSupportedParkTypeByCode, getSupportedParkTypeBySlug } from '../parks/park-types.js';
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
  sourceTypeCode: number;
  slug: string;
  sourceEventDate: string | null;
  type: {
    code: number;
    id: number;
    name: string;
    slug: string;
  };
};

const shouldPromoteToHikingArea = (park: LipasPark) => {
  const normalizedName = park.name.trim().toLowerCase();
  const typeCode = park.type['type-code'];

  return normalizedName.endsWith('retkeilyalue') && (typeCode === 103 || typeCode === 112);
};

export const mapLipasPark = (source: unknown, existingSlug?: string): MappedPark => {
  const park = lipasParkSchema.parse(source);
  const sourceTypeCode = park.type['type-code'];
  const parkType = shouldPromoteToHikingArea(park)
    ? getSupportedParkTypeBySlug('hiking-area')
    : getSupportedParkTypeByCode(sourceTypeCode);
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
    sourceTypeCode,
    slug: existingSlug ?? createParkSlug(park.name),
    sourceEventDate: park['event-date'] ?? null,
    type: parkType
  };
};
