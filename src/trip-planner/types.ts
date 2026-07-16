import type {
  BoundingBox,
  GeoJsonFeatureCollection,
  LineStringGeometry
} from '../importer/geometry.js';
import type { SupportedParkCategorySlug, SupportedParkTypeSlug } from '../parks/park-types.js';

export type TripPlannerMode = 'drive';

export type TripPlannerCoordinate = {
  lat: number;
  lon: number;
};

export type TripPlannerSearchInput = {
  destinationQuery: string;
  maxDistanceKm?: number | undefined;
  mode: TripPlannerMode;
  originQuery: string;
};

export type TripPlannerResolvedLocation = {
  coordinate: TripPlannerCoordinate;
  label: string;
};

export type TripPlannerRoute = {
  boundingBox: BoundingBox;
  distanceMeters: number;
  durationSeconds: number;
  geometry: GeoJsonFeatureCollection;
  mode: TripPlannerMode;
};

export type TripPlannerVisitedSummary = {
  lastVisitedOn: string | null;
  visitCount: number;
  visited: boolean;
};

export type TripPlannerParkType = {
  code: number;
  id: number;
  name: string;
  slug: SupportedParkTypeSlug;
};

export type TripPlannerParkCategory = {
  name: string;
  slug: SupportedParkCategorySlug;
};

export type TripPlannerParkCandidate = {
  address: string;
  boundingBox: BoundingBox;
  boundaryGeoJson: GeoJsonFeatureCollection | null;
  category: TripPlannerParkCategory;
  displayTypeName?: string | null | undefined;
  locationLabel: string;
  markerPoint: TripPlannerCoordinate;
  name: string;
  postalCode: string | null;
  postalOffice: string | null;
  slug: string;
  type: TripPlannerParkType;
  visitedSummary: TripPlannerVisitedSummary;
};

export type TripPlannerParkResult = Omit<TripPlannerParkCandidate, 'boundaryGeoJson'> & {
  distanceFromRouteKm: number;
};

export type TripPlannerSearchResponse = {
  destination: TripPlannerResolvedLocation;
  origin: TripPlannerResolvedLocation;
  parks: TripPlannerParkResult[];
  route: {
    boundingBox: BoundingBox;
    distanceMeters: number;
    durationSeconds: number;
    geometry: LineStringGeometry;
    mode: TripPlannerMode;
  };
};

export type TripPlannerProvider = {
  geocode: (query: string) => Promise<TripPlannerResolvedLocation | null>;
  route: (input: {
    destination: TripPlannerCoordinate;
    mode: TripPlannerMode;
    origin: TripPlannerCoordinate;
  }) => Promise<TripPlannerRoute | null>;
};

export type TripPlannerService = {
  search: (input: TripPlannerSearchInput) => Promise<TripPlannerSearchResponse>;
};
