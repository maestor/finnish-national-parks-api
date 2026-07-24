import type { SupportedParkTypeSlug } from '../../parks/park-types.js';

export type SpecialParkMetadata = {
  areaKm2: number | null;
  establishmentYear: number | null;
};

export type SpecialParkConfig = {
  displayTypeName: string | null;
  extractMetadata?: (
    features: Array<{ properties?: Record<string, unknown> | undefined }>
  ) => SpecialParkMetadata;
  filterFeatures?: (feature: { properties: { ely?: string | undefined; nimi: string } }) => boolean;
  locationLabel: string;
  markerPoint?: {
    lat: number;
    lon: number;
  };
  parkUrl: string | null;
  name: string;
  parkTypeSlug: SupportedParkTypeSlug;
  postalCode: string | null;
  postalOffice: string | null;
  responseShapeVersion: string;
  slug: string;
  sourceFeatureId?: number;
  sourceParser?: 'geojson' | 'syke' | 'world-heritage-area';
  sourceUrl: string;
  syntheticLipasId: number;
};

export type SykeProtectedSitesSourceType = 'private' | 'state';

export type SykeSpecialParkSeed = {
  displayTypeName: string | null;
  locationLabel?: string;
  parkUrl: string | null;
  name: string;
  parkTypeSlug: SupportedParkTypeSlug;
  postalCode?: string | null;
  postalOffice?: string | null;
  slug: string;
  sourceName: string;
  sourceType?: SykeProtectedSitesSourceType;
  syntheticLipasId: number;
};

export type LuontoonDestinationAreaSeed = {
  displayTypeName: string | null;
  locationLabel?: string;
  parkUrl: string | null;
  name: string;
  parkTypeSlug: SupportedParkTypeSlug;
  postalCode?: string | null;
  postalOffice?: string | null;
  slug: string;
  syntheticLipasId: number;
};

export type MuseovirastoRkyAreaSeed = {
  displayTypeName: string | null;
  excludedSourceNames?: string[];
  locationLabel?: string;
  markerPoint?: {
    lat: number;
    lon: number;
  };
  parkUrl: string | null;
  name: string;
  parkTypeSlug: SupportedParkTypeSlug;
  postalCode?: string | null;
  postalOffice?: string | null;
  slug: string;
  sourceFeatureName?: string;
  sourceName: string;
  syntheticLipasId: number;
};
