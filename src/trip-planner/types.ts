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

export type TripPlannerNearbySearchInput = {
  maxDistanceKm?: number | undefined;
  originQuery: string;
};

export type TripPlannerResolvedLocation = {
  coordinate: TripPlannerCoordinate;
  displayName: string;
  label: string;
};

export type TripPlannerSuggestion = TripPlannerResolvedLocation;

export type TripPlannerRoundTripInput = {
  mode: TripPlannerMode;
  waypoints: TripPlannerResolvedLocation[];
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

export type TripPlannerNearbyParkResult = Omit<TripPlannerParkCandidate, 'boundaryGeoJson'> & {
  distanceFromOriginKm: number;
};

export type TripPlannerSearchResponse = {
  defaultDistanceKm: number;
  destination: TripPlannerResolvedLocation;
  maxDistanceKm: number;
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

export type TripPlannerNearbySearchResponse = {
  defaultDistanceKm: number;
  maxDistanceKm: number;
  origin: TripPlannerResolvedLocation;
  parks: TripPlannerNearbyParkResult[];
  searchArea: {
    boundingBox: BoundingBox;
    center: TripPlannerCoordinate;
    maxDistanceKm: number;
  };
};

export type TripPlannerRoundTripRoute = {
  distanceMeters: number;
  durationSeconds: number;
  geometry: LineStringGeometry;
  returnsToStart: boolean;
  waypointCount: number;
};

export type TripPlannerProvider = {
  geocode: (query: string) => Promise<TripPlannerResolvedLocation | null>;
  route: (input: {
    destination: TripPlannerCoordinate;
    mode: TripPlannerMode;
    origin: TripPlannerCoordinate;
  }) => Promise<TripPlannerRoute | null>;
  suggest: (query: string) => Promise<TripPlannerSuggestion[]>;
};

export type TripPlannerService = {
  buildRoundTripRoute?: (
    input: TripPlannerRoundTripInput
  ) => Promise<TripPlannerRoundTripRoute | null>;
  search: (input: TripPlannerSearchInput) => Promise<TripPlannerSearchResponse>;
  searchNearby: (input: TripPlannerNearbySearchInput) => Promise<TripPlannerNearbySearchResponse>;
  suggest: (query: string) => Promise<TripPlannerSuggestion[]>;
};
