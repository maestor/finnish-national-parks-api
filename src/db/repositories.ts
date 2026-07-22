import { and, asc, desc, eq, gt, gte, inArray, lt, lte, notInArray, sql } from 'drizzle-orm';

import type { GeoJsonFeatureCollection } from '../importer/geometry.js';
import { createParkSlug, normalizeParkUrl } from '../parks/park-normalization.js';
import type { SupportedParkCategorySlug, SupportedParkTypeSlug } from '../parks/park-types.js';
import {
  getParkCategoryByTypeSlug,
  getSupportedParkTypeSlugsByCategorySlug,
  isHikingAndWildernessAreaTypeSlug,
  isTrailTypeSlug,
  supportedParkTypes
} from '../parks/park-types.js';
import type { TripPlannerParkCandidate } from '../trip-planner/types.js';
import type { Database, DbClient } from './database.js';
import {
  admins,
  importRuns,
  parks,
  parkTypes,
  parkVisits,
  publicDataVersions,
  trips,
  visitImages
} from './schema.js';

type PutVisitInput = {
  author?: string | null | undefined;
  note?: string | null | undefined;
  route?: string | null | undefined;
  tripId?: number | null | undefined;
  tripStopOrder?: number | undefined;
  visitedOn: string;
};

type UpdateVisitInput = {
  author?: string | null | undefined;
  note?: string | null | undefined;
  route?: string | null | undefined;
  tripId?: number | null | undefined;
  tripStopOrder?: number | undefined;
  visitedOn?: string | undefined;
};

type PutTripInput = {
  description?: string | null | undefined;
  name: string;
};

type UpdateTripInput = {
  description?: string | null | undefined;
  name?: string | undefined;
};

type UpdateParkDetailsInput = {
  areaKm2?: number | null | undefined;
  displayTypeName?: string | null | undefined;
  establishmentYear?: number | null | undefined;
  locationLabel?: string | undefined;
  parkUrl?: string | null | undefined;
  name?: string | undefined;
  postalCode?: string | null | undefined;
  postalOffice?: string | null | undefined;
  slug?: string | undefined;
};

type ReassignParkVisitsInput = {
  dryRun?: boolean | undefined;
  fromSlug: string;
  toSlug: string;
};

type ReassignParkVisitsResult = {
  dryRun: boolean;
  fromPark: {
    id: number;
    name: string;
    slug: string;
  };
  movedImageCount: number;
  movedVisitCount: number;
  movedVisitIds: number[];
  toPark: {
    id: number;
    name: string;
    slug: string;
  };
};

type BoundingBox = {
  maxLat: number;
  maxLon: number;
  minLat: number;
  minLon: number;
};

type MarkerPoint = {
  lat: number;
  lon: number;
};

type GetLogoPublicUrl = (key: string, updatedAt: string) => string | Promise<string>;
type GetMapPublicUrl = (key: string, updatedAt: string) => string | Promise<string>;

type TypedParkRow = {
  park: typeof parks.$inferSelect;
  parkType: typeof parkTypes.$inferSelect;
};

type TripReference = {
  id: number;
  name: string;
};

type VisitRowWithPark = {
  park: typeof parks.$inferSelect;
  visit: typeof parkVisits.$inferSelect;
};

type TripRow = {
  createdAt: string;
  description: string | null;
  endVisitedOn: string | null;
  id: number;
  name: string;
  startVisitedOn: string | null;
  updatedAt: string;
  visitCount: number;
};

type PublicParkRow = {
  areaKm2: number | null;
  bboxMaxLat: number;
  bboxMaxLon: number;
  bboxMinLat: number;
  bboxMinLon: number;
  displayTypeName: string | null;
  establishmentYear: number | null;
  locationLabel: string;
  logoKey: string | null;
  logoUpdatedAt: string | null;
  parkUrl: string | null;
  mapKey: string | null;
  mapUpdatedAt: string | null;
  markerLat: number;
  markerLon: number;
  name: string;
  parkId: number;
  postalCode: string | null;
  postalOffice: string | null;
  slug: string;
  typeCode: number;
  typeId: number;
  typeName: string;
  typeSlug: string;
};

type TripPlannerParkRow = {
  bboxMaxLat: number;
  bboxMaxLon: number;
  bboxMinLat: number;
  bboxMinLon: number;
  boundaryGeojson: string;
  displayTypeName: string | null;
  locationLabel: string;
  markerLat: number;
  markerLon: number;
  name: string;
  parkId: number;
  postalCode: string | null;
  postalOffice: string | null;
  slug: string;
  typeCode: number;
  typeId: number;
  typeName: string;
  typeSlug: string;
};

type LightweightParkRow = {
  bboxMaxLat: number;
  bboxMaxLon: number;
  bboxMinLat: number;
  bboxMinLon: number;
  displayTypeName: string | null;
  locationLabel: string;
  markerLat: number;
  markerLon: number;
  name: string;
  postalCode: string | null;
  postalOffice: string | null;
  slug: string;
  typeCode: number;
  typeId: number;
  typeName: string;
  typeSlug: string;
};

type PublicVisitRow = {
  createdAt: string;
  id: number;
  parkId: number;
  parkName: string;
  parkSlug: string;
  tripId: number | null;
  tripStopOrder: number | null;
  updatedAt: string;
  visitedOn: string;
};

type VisitTimelineRow = {
  createdAt: string;
  displayTypeName: string | null;
  id: number;
  imageCount: number;
  parkName: string;
  parkSlug: string;
  route: string | null;
  tripId: number | null;
  tripName: string | null;
  tripStopOrder: number | null;
  typeName: string;
  visitedOn: string;
};

type PublicVisitVersion = {
  updatedAt: string | null;
  version: number;
};

type UpsertCatalogParkInput = Omit<
  typeof parks.$inferInsert,
  | 'id'
  | 'importedAreaKm2'
  | 'importedDisplayTypeName'
  | 'importedEstablishmentYear'
  | 'importedLocationLabel'
  | 'importedParkUrl'
  | 'importedName'
  | 'importedPostalCode'
  | 'importedPostalOffice'
  | 'importedSlug'
>;

const PUBLIC_VISIT_DATA_VERSION_KEY = 'public-visits';

export class RepositoryNotFoundError extends Error {}
export class RepositoryValidationError extends Error {}

const normalizeOptionalText = (value?: string | null) => value?.trim() || null;

const normalizeRequiredText = (value: string, fieldName: string) => {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }

  return normalized;
};

type TripAwareVisitOrder = {
  createdAt: string;
  id: number;
  tripId: number | null;
  tripStopOrder: number | null;
  visitedOn: string;
};

const compareTripAwareVisitOrder = (a: TripAwareVisitOrder, b: TripAwareVisitOrder) => {
  if (b.visitedOn !== a.visitedOn) {
    return b.visitedOn.localeCompare(a.visitedOn);
  }

  const sameTrip = a.tripId !== null && a.tripId === b.tripId;

  if (sameTrip && a.tripStopOrder !== null && b.tripStopOrder !== null) {
    if (a.tripStopOrder !== b.tripStopOrder) {
      return a.tripStopOrder - b.tripStopOrder;
    }
  }

  if (b.createdAt !== a.createdAt) {
    return b.createdAt.localeCompare(a.createdAt);
  }

  return b.id - a.id;
};

const sortTripAwareVisitRows = <T extends TripAwareVisitOrder>(visitRows: T[]) => {
  return [...visitRows].sort(compareTripAwareVisitOrder);
};

const toBoundingBox = (row: typeof parks.$inferSelect): BoundingBox => {
  return {
    maxLat: row.bboxMaxLat,
    maxLon: row.bboxMaxLon,
    minLat: row.bboxMinLat,
    minLon: row.bboxMinLon
  };
};

const toMarkerPoint = (row: typeof parks.$inferSelect): MarkerPoint => {
  return {
    lat: row.markerLat,
    lon: row.markerLon
  };
};

const toParkType = (row: typeof parkTypes.$inferSelect) => {
  return {
    code: row.code,
    id: row.id,
    name: row.name,
    slug: row.slug as SupportedParkTypeSlug
  };
};

const toParkCategory = (typeSlug: SupportedParkTypeSlug) => getParkCategoryByTypeSlug(typeSlug);

const resolveTypeLabel = (park: { displayTypeName: string | null; typeName: string }) => {
  return park.displayTypeName ?? park.typeName;
};

const toLogo = async (
  logoKey: string | null,
  logoUpdatedAt: string | null,
  getLogoPublicUrl?: GetLogoPublicUrl
) => {
  if (!(logoKey && logoUpdatedAt && getLogoPublicUrl)) {
    return null;
  }

  return {
    key: logoKey,
    updatedAt: logoUpdatedAt,
    url: await getLogoPublicUrl(logoKey, logoUpdatedAt)
  };
};

const toMap = async (
  mapKey: string | null,
  mapUpdatedAt: string | null,
  getMapPublicUrl?: GetMapPublicUrl
) => {
  if (!(mapKey && mapUpdatedAt && getMapPublicUrl)) {
    return null;
  }

  return {
    key: mapKey,
    updatedAt: mapUpdatedAt,
    url: await getMapPublicUrl(mapKey, mapUpdatedAt)
  };
};

const visibleParkBySlugWhere = (slug: string) =>
  and(eq(parks.slug, slug), eq(parks.removed, false));

const categoryWhere = (categorySlug: SupportedParkCategorySlug) => {
  const typeSlugs = getSupportedParkTypeSlugsByCategorySlug(categorySlug);

  if (typeSlugs.length !== 1) {
    return inArray(parkTypes.slug, typeSlugs);
  }

  return eq(parkTypes.slug, typeSlugs[0]!);
};

const visibleCatalogWhere = (
  options: { categorySlug?: SupportedParkCategorySlug; typeSlug?: SupportedParkTypeSlug } = {}
) => {
  const conditions = [eq(parks.catalogStatus, 'active'), eq(parks.removed, false)];

  if (options.typeSlug) {
    conditions.push(eq(parkTypes.slug, options.typeSlug));
  }

  if (options.categorySlug) {
    conditions.push(categoryWhere(options.categorySlug));
  }

  return and(...conditions);
};

const removedCatalogWhere = () => eq(parks.removed, true);

const withOptionalDisplayTypeName = <T extends object>(
  park: { displayTypeName: string | null },
  value: T
) => {
  if (!park.displayTypeName) {
    return value;
  }

  return {
    ...value,
    displayTypeName: park.displayTypeName
  };
};

const toAddress = (
  locationLabel: string,
  postalCode: string | null,
  postalOffice: string | null
) => {
  const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
  const normalizedLocationLabel = locationLabel.trim();
  const normalizedPostalCode = postalCode?.trim() ?? '';
  const normalizedPostalOffice = capitalize(postalOffice?.trim().toLowerCase() ?? '');
  const postalLocation = [normalizedPostalCode, normalizedPostalOffice].filter(Boolean).join(' ');

  if (!normalizedLocationLabel || normalizedLocationLabel === '-') {
    return postalLocation;
  }

  if (!postalLocation) {
    return normalizedLocationLabel;
  }

  if (normalizedLocationLabel === normalizedPostalOffice) {
    return normalizedPostalCode
      ? `${normalizedLocationLabel}, ${normalizedPostalCode}`
      : normalizedLocationLabel;
  }

  return `${normalizedLocationLabel}, ${postalLocation}`;
};

const toRawLocationFields = (
  locationLabel: string,
  postalCode: string | null,
  postalOffice: string | null
) => ({
  locationLabel,
  postalCode,
  postalOffice
});

const toPark = async (
  row: TypedParkRow,
  getLogoPublicUrl?: GetLogoPublicUrl,
  getMapPublicUrl?: GetMapPublicUrl
) => {
  return withOptionalDisplayTypeName(row.park, {
    address: toAddress(row.park.locationLabel, row.park.postalCode, row.park.postalOffice),
    areaKm2: row.park.areaKm2,
    boundingBox: toBoundingBox(row.park),
    boundaryGeoJson: JSON.parse(row.park.boundaryGeojson) as GeoJsonFeatureCollection,
    category: toParkCategory(row.parkType.slug as SupportedParkTypeSlug),
    catalogStatus: row.park.catalogStatus as 'active' | 'inactive',
    establishmentYear: row.park.establishmentYear,
    lipasId: row.park.lipasId,
    logo: await toLogo(row.park.logoKey, row.park.logoUpdatedAt, getLogoPublicUrl),
    parkUrl: row.park.parkUrl,
    map: await toMap(row.park.mapKey, row.park.mapUpdatedAt, getMapPublicUrl),
    markerPoint: toMarkerPoint(row.park),
    municipalityCode: row.park.municipalityCode,
    name: row.park.name,
    ...toRawLocationFields(row.park.locationLabel, row.park.postalCode, row.park.postalOffice),
    slug: row.park.slug,
    sourceEventDate: row.park.sourceEventDate,
    type: toParkType(row.parkType),
    updatedAt: row.park.updatedAt
  });
};

const toPublicPark = async (
  row: PublicParkRow,
  getLogoPublicUrl?: GetLogoPublicUrl,
  getMapPublicUrl?: GetMapPublicUrl
) => {
  return withOptionalDisplayTypeName(row, {
    address: toAddress(row.locationLabel, row.postalCode, row.postalOffice),
    areaKm2: row.areaKm2,
    boundingBox: {
      maxLat: row.bboxMaxLat,
      maxLon: row.bboxMaxLon,
      minLat: row.bboxMinLat,
      minLon: row.bboxMinLon
    },
    category: toParkCategory(row.typeSlug as SupportedParkTypeSlug),
    establishmentYear: row.establishmentYear,
    logo: await toLogo(row.logoKey, row.logoUpdatedAt, getLogoPublicUrl),
    parkUrl: row.parkUrl,
    map: await toMap(row.mapKey, row.mapUpdatedAt, getMapPublicUrl),
    markerPoint: {
      lat: row.markerLat,
      lon: row.markerLon
    },
    name: row.name,
    ...toRawLocationFields(row.locationLabel, row.postalCode, row.postalOffice),
    slug: row.slug,
    type: {
      code: row.typeCode,
      id: row.typeId,
      name: row.typeName,
      slug: row.typeSlug as SupportedParkTypeSlug
    }
  });
};

const toSearchPark = (row: LightweightParkRow) => {
  return withOptionalDisplayTypeName(row, {
    address: toAddress(row.locationLabel, row.postalCode, row.postalOffice),
    ...toRawLocationFields(row.locationLabel, row.postalCode, row.postalOffice),
    name: row.name,
    slug: row.slug,
    type: {
      code: row.typeCode,
      id: row.typeId,
      name: row.typeName,
      slug: row.typeSlug as SupportedParkTypeSlug
    }
  });
};

const toTripPlannerPark = (row: TripPlannerParkRow, visits: Array<{ visitedOn: string }>) => {
  return withOptionalDisplayTypeName(row, {
    address: toAddress(row.locationLabel, row.postalCode, row.postalOffice),
    boundingBox: {
      maxLat: row.bboxMaxLat,
      maxLon: row.bboxMaxLon,
      minLat: row.bboxMinLat,
      minLon: row.bboxMinLon
    },
    boundaryGeoJson: JSON.parse(row.boundaryGeojson) as GeoJsonFeatureCollection,
    category: toParkCategory(row.typeSlug as SupportedParkTypeSlug),
    locationLabel: row.locationLabel,
    markerPoint: {
      lat: row.markerLat,
      lon: row.markerLon
    },
    name: row.name,
    postalCode: row.postalCode,
    postalOffice: row.postalOffice,
    slug: row.slug,
    type: {
      code: row.typeCode,
      id: row.typeId,
      name: row.typeName,
      slug: row.typeSlug as SupportedParkTypeSlug
    },
    visitedSummary: toVisitedSummary(visits)
  }) as TripPlannerParkCandidate;
};

const toAdminVisibilityPark = (row: LightweightParkRow) => {
  return {
    ...toSearchPark(row),
    boundingBox: {
      maxLat: row.bboxMaxLat,
      maxLon: row.bboxMaxLon,
      minLat: row.bboxMinLat,
      minLon: row.bboxMinLon
    },
    markerPoint: {
      lat: row.markerLat,
      lon: row.markerLon
    }
  };
};

export type VisitImage = {
  id: number;
  fullUrl: string;
  thumbUrl: string;
  fullWidth: number | null;
  fullHeight: number | null;
  thumbWidth: number | null;
  thumbHeight: number | null;
  originalName: string | null;
  displayOrder: number;
  createdAt: string;
};

const toVisitImage = async (
  row: typeof visitImages.$inferSelect,
  getPublicUrl: (key: string) => Promise<string>
): Promise<VisitImage> => ({
  id: row.id,
  fullUrl: await getPublicUrl(row.fullKey),
  thumbUrl: await getPublicUrl(row.thumbKey),
  fullWidth: row.fullWidth,
  fullHeight: row.fullHeight,
  thumbWidth: row.thumbWidth,
  thumbHeight: row.thumbHeight,
  originalName: row.originalName,
  displayOrder: row.displayOrder,
  createdAt: row.createdAt
});

const toTripReference = (row: typeof trips.$inferSelect): TripReference => {
  return {
    id: row.id,
    name: row.name
  };
};

const toTrip = (row: TripRow) => {
  return {
    createdAt: row.createdAt,
    dateRange:
      row.startVisitedOn && row.endVisitedOn
        ? {
            end: row.endVisitedOn,
            start: row.startVisitedOn
          }
        : null,
    description: row.description,
    id: row.id,
    name: row.name,
    updatedAt: row.updatedAt,
    visitCount: row.visitCount
  };
};

const toVisit = (
  row: typeof parkVisits.$inferSelect,
  images: VisitImage[] = [],
  trip: TripReference | null = null
) => {
  return {
    author: row.author,
    createdAt: row.createdAt,
    id: row.id,
    images,
    note: row.note,
    route: row.route,
    trip,
    tripStopOrder: row.tripStopOrder,
    updatedAt: row.updatedAt,
    visitedOn: row.visitedOn
  };
};

const getParkRecordBySlug = async (database: Database, slug: string) => {
  return database.query.parks.findFirst({
    where: visibleParkBySlugWhere(slug)
  });
};

const getTripRecordById = async (database: DbClient, tripId: number) => {
  return database.query.trips.findFirst({
    where: eq(trips.id, tripId)
  });
};

const resolveTripId = async (database: Database, tripId?: number | null) => {
  if (tripId === undefined) {
    return undefined;
  }

  if (tripId === null) {
    return null;
  }

  const trip = await getTripRecordById(database, tripId);

  if (!trip) {
    throw new RepositoryNotFoundError('Trip not found.');
  }

  return trip.id;
};

export const findParkRecordBySlugIncludingRemoved = async (database: Database, slug: string) => {
  return database.query.parks.findFirst({
    where: eq(parks.slug, slug)
  });
};

export const listParkRecordsIncludingRemoved = async (database: Database) => {
  return database.query.parks.findMany({
    columns: {
      displayTypeName: true,
      slug: true
    },
    orderBy: parks.slug
  });
};

const getTypedParkBySlug = async (database: Database, slug: string) => {
  return (
    (
      await database
        .select({
          park: parks,
          parkType: parkTypes
        })
        .from(parks)
        .innerJoin(parkTypes, eq(parks.typeId, parkTypes.id))
        .where(visibleParkBySlugWhere(slug))
    )[0] ?? null
  );
};

const getTypedParkBySlugIncludingRemoved = async (database: Database, slug: string) => {
  return (
    (
      await database
        .select({
          park: parks,
          parkType: parkTypes
        })
        .from(parks)
        .innerJoin(parkTypes, eq(parks.typeId, parkTypes.id))
        .where(eq(parks.slug, slug))
    )[0] ?? null
  );
};

const listTypedParks = async (
  database: Database,
  options: { categorySlug?: SupportedParkCategorySlug; typeSlug?: SupportedParkTypeSlug } = {}
) => {
  return database
    .select({
      park: parks,
      parkType: parkTypes
    })
    .from(parks)
    .innerJoin(parkTypes, eq(parks.typeId, parkTypes.id))
    .where(visibleCatalogWhere(options))
    .orderBy(parks.name);
};

const listPublicParkRows = async (database: Database) => {
  return database
    .select({
      areaKm2: parks.areaKm2,
      bboxMaxLat: parks.bboxMaxLat,
      bboxMaxLon: parks.bboxMaxLon,
      bboxMinLat: parks.bboxMinLat,
      bboxMinLon: parks.bboxMinLon,
      displayTypeName: parks.displayTypeName,
      establishmentYear: parks.establishmentYear,
      locationLabel: parks.locationLabel,
      logoKey: parks.logoKey,
      logoUpdatedAt: parks.logoUpdatedAt,
      parkUrl: parks.parkUrl,
      mapKey: parks.mapKey,
      mapUpdatedAt: parks.mapUpdatedAt,
      markerLat: parks.markerLat,
      markerLon: parks.markerLon,
      name: parks.name,
      parkId: parks.id,
      postalCode: parks.postalCode,
      postalOffice: parks.postalOffice,
      slug: parks.slug,
      typeCode: parkTypes.code,
      typeId: parkTypes.id,
      typeName: parkTypes.name,
      typeSlug: parkTypes.slug
    })
    .from(parks)
    .innerJoin(parkTypes, eq(parks.typeId, parkTypes.id))
    .where(visibleCatalogWhere())
    .orderBy(parks.name);
};

const listTripPlannerParkRows = async (database: Database) => {
  return database
    .select({
      bboxMaxLat: parks.bboxMaxLat,
      bboxMaxLon: parks.bboxMaxLon,
      bboxMinLat: parks.bboxMinLat,
      bboxMinLon: parks.bboxMinLon,
      boundaryGeojson: parks.boundaryGeojson,
      displayTypeName: parks.displayTypeName,
      locationLabel: parks.locationLabel,
      markerLat: parks.markerLat,
      markerLon: parks.markerLon,
      name: parks.name,
      parkId: parks.id,
      postalCode: parks.postalCode,
      postalOffice: parks.postalOffice,
      slug: parks.slug,
      typeCode: parkTypes.code,
      typeId: parkTypes.id,
      typeName: parkTypes.name,
      typeSlug: parkTypes.slug
    })
    .from(parks)
    .innerJoin(parkTypes, eq(parks.typeId, parkTypes.id))
    .where(visibleCatalogWhere())
    .orderBy(parks.name);
};

const listLightweightParkRows = async (
  database: Database,
  where: ReturnType<typeof visibleCatalogWhere> | ReturnType<typeof removedCatalogWhere>
) => {
  return database
    .select({
      bboxMaxLat: parks.bboxMaxLat,
      bboxMaxLon: parks.bboxMaxLon,
      bboxMinLat: parks.bboxMinLat,
      bboxMinLon: parks.bboxMinLon,
      displayTypeName: parks.displayTypeName,
      locationLabel: parks.locationLabel,
      markerLat: parks.markerLat,
      markerLon: parks.markerLon,
      name: parks.name,
      postalCode: parks.postalCode,
      postalOffice: parks.postalOffice,
      slug: parks.slug,
      typeCode: parkTypes.code,
      typeId: parkTypes.id,
      typeName: parkTypes.name,
      typeSlug: parkTypes.slug
    })
    .from(parks)
    .innerJoin(parkTypes, eq(parks.typeId, parkTypes.id))
    .where(where)
    .orderBy(parks.name);
};

const getVisitsForPark = async (database: Database, parkId: number) => {
  const visitRows = await database.query.parkVisits.findMany({
    orderBy: [desc(parkVisits.visitedOn), desc(parkVisits.id)],
    where: eq(parkVisits.parkId, parkId)
  });

  return sortTripAwareVisitRows(visitRows);
};

const getImagesForVisitIds = async (database: Database, visitIds: number[]) => {
  if (visitIds.length === 0) {
    return [];
  }

  return database.query.visitImages.findMany({
    orderBy: [asc(visitImages.displayOrder), asc(visitImages.createdAt)],
    where: inArray(visitImages.visitId, visitIds)
  });
};

const buildVisitImagesByVisitId = async (
  database: Database,
  visitIds: number[],
  getImagePublicUrl: (key: string) => Promise<string>
) => {
  const imageRows = await getImagesForVisitIds(database, visitIds);
  const imagesByVisitId = new Map<number, (typeof visitImages.$inferSelect)[]>();

  for (const img of imageRows) {
    const list = imagesByVisitId.get(img.visitId) ?? [];
    list.push(img);
    imagesByVisitId.set(img.visitId, list);
  }

  const visitImagesByVisitId = new Map<number, VisitImage[]>();
  for (const visitId of visitIds) {
    const images = await Promise.all(
      (imagesByVisitId.get(visitId) ?? []).map((img) => toVisitImage(img, getImagePublicUrl))
    );
    visitImagesByVisitId.set(visitId, images);
  }

  return visitImagesByVisitId;
};

const buildVisitTripsByTripId = async (
  database: Database,
  visitRows: (typeof parkVisits.$inferSelect)[]
) => {
  const tripIds = [
    ...new Set(
      visitRows.map((visit) => visit.tripId).filter((tripId): tripId is number => tripId !== null)
    )
  ];

  if (tripIds.length === 0) {
    return new Map<number, TripReference>();
  }

  const tripRows = await database.query.trips.findMany({
    where: inArray(trips.id, tripIds)
  });

  return new Map(tripRows.map((trip) => [trip.id, toTripReference(trip)]));
};

const buildVisits = async (
  database: Database,
  visitRows: (typeof parkVisits.$inferSelect)[],
  getImagePublicUrl: (key: string) => Promise<string>
) => {
  const visitIds = visitRows.map((visit) => visit.id);
  const visitImagesByVisitId = await buildVisitImagesByVisitId(
    database,
    visitIds,
    getImagePublicUrl
  );
  const visitTripsByTripId = await buildVisitTripsByTripId(database, visitRows);

  return visitRows.map((visit) =>
    toVisit(
      visit,
      visitImagesByVisitId.get(visit.id)!,
      visit.tripId === null ? null : visitTripsByTripId.get(visit.tripId)!
    )
  );
};

const toVisitedSummary = (visits: Array<{ visitedOn: string }>) => {
  return {
    lastVisitedOn: visits[0]?.visitedOn ?? null,
    visitCount: visits.length,
    visited: visits.length > 0
  };
};

const getSeasonFromVisitedOn = (visitedOn: string) => {
  const month = Number(visitedOn.slice(5, 7));

  if (month >= 3 && month <= 5) {
    return 'spring';
  }

  if (month >= 6 && month <= 8) {
    return 'summer';
  }

  if (month >= 9 && month <= 11) {
    return 'autumn';
  }

  return 'winter';
};

const countVisitsBySeason = (visits: Array<{ visitedOn: string }>) => {
  const counts = { autumn: 0, spring: 0, summer: 0, winter: 0 };

  for (const visit of visits) {
    counts[getSeasonFromVisitedOn(visit.visitedOn)] += 1;
  }

  return counts;
};

const listVisitRowsWithPark = async (database: Database) => {
  const visitRows = await database
    .select({
      park: parks,
      visit: parkVisits
    })
    .from(parkVisits)
    .innerJoin(parks, eq(parkVisits.parkId, parks.id))
    .where(eq(parks.removed, false))
    .orderBy(desc(parkVisits.visitedOn), desc(parkVisits.id));

  return sortTripAwareVisitRows(visitRows.map((row) => row.visit)).map(
    (visit) => visitRows.find((row) => row.visit.id === visit.id)!
  );
};

const listPublicVisitRows = async (database: Database) => {
  return database
    .select({
      createdAt: parkVisits.createdAt,
      id: parkVisits.id,
      parkId: parkVisits.parkId,
      parkName: parks.name,
      parkSlug: parks.slug,
      tripId: parkVisits.tripId,
      tripStopOrder: parkVisits.tripStopOrder,
      updatedAt: parkVisits.updatedAt,
      visitedOn: parkVisits.visitedOn
    })
    .from(parkVisits)
    .innerJoin(parks, eq(parkVisits.parkId, parks.id))
    .where(eq(parks.removed, false))
    .orderBy(desc(parkVisits.createdAt), desc(parkVisits.id));
};

const listTripRows = async (database: Database): Promise<TripRow[]> => {
  return database
    .select({
      createdAt: trips.createdAt,
      description: trips.description,
      endVisitedOn: sql<
        string | null
      >`MAX(CASE WHEN ${parks.removed} = 0 THEN ${parkVisits.visitedOn} END)`,
      id: trips.id,
      name: trips.name,
      startVisitedOn: sql<
        string | null
      >`MIN(CASE WHEN ${parks.removed} = 0 THEN ${parkVisits.visitedOn} END)`,
      updatedAt: trips.updatedAt,
      visitCount: sql<number>`COUNT(CASE WHEN ${parks.removed} = 0 THEN ${parkVisits.id} END)`
    })
    .from(trips)
    .leftJoin(parkVisits, eq(parkVisits.tripId, trips.id))
    .leftJoin(parks, eq(parkVisits.parkId, parks.id))
    .groupBy(trips.id, trips.createdAt, trips.description, trips.name, trips.updatedAt)
    .orderBy(asc(trips.name), asc(trips.id));
};

const listVisitTimelineRows = async (database: Database): Promise<VisitTimelineRow[]> => {
  return database
    .select({
      createdAt: parkVisits.createdAt,
      displayTypeName: parks.displayTypeName,
      id: parkVisits.id,
      imageCount: sql<number>`COUNT(${visitImages.id})`,
      parkName: parks.name,
      parkSlug: parks.slug,
      route: parkVisits.route,
      tripId: trips.id,
      tripName: trips.name,
      tripStopOrder: parkVisits.tripStopOrder,
      typeName: parkTypes.name,
      visitedOn: parkVisits.visitedOn
    })
    .from(parkVisits)
    .innerJoin(parks, eq(parkVisits.parkId, parks.id))
    .innerJoin(parkTypes, eq(parks.typeId, parkTypes.id))
    .leftJoin(trips, eq(parkVisits.tripId, trips.id))
    .leftJoin(visitImages, eq(visitImages.visitId, parkVisits.id))
    .where(visibleCatalogWhere())
    .groupBy(
      parkVisits.id,
      parkVisits.createdAt,
      parkVisits.route,
      parkVisits.tripId,
      parkVisits.tripStopOrder,
      parkVisits.visitedOn,
      parks.displayTypeName,
      parks.name,
      parks.slug,
      trips.id,
      trips.name,
      parkTypes.name
    )
    .orderBy(desc(parkVisits.visitedOn), desc(parkVisits.createdAt), desc(parkVisits.id));
};

const getTripVisitCount = async (database: DbClient, tripId: number, excludeVisitId?: number) => {
  const where =
    excludeVisitId === undefined
      ? eq(parkVisits.tripId, tripId)
      : and(eq(parkVisits.tripId, tripId), sql`${parkVisits.id} <> ${excludeVisitId}`);

  const rows = await database
    .select({
      count: sql<number>`COUNT(*)`
    })
    .from(parkVisits)
    .where(where);

  const [row] = rows;

  return Number(row!.count);
};

const normalizeTripStopOrder = (requestedOrder: number | undefined, maxOrder: number) => {
  if (requestedOrder === undefined) {
    return maxOrder;
  }

  return Math.min(Math.max(requestedOrder, 1), maxOrder);
};

const shiftTripStopOrdersUpFrom = async (
  database: DbClient,
  tripId: number,
  fromOrder: number,
  timestamp: string
) => {
  await database
    .update(parkVisits)
    .set({
      tripStopOrder: sql`${parkVisits.tripStopOrder} + 1`,
      updatedAt: timestamp
    })
    .where(and(eq(parkVisits.tripId, tripId), gte(parkVisits.tripStopOrder, fromOrder)));
};

const closeTripStopOrderGap = async (
  database: DbClient,
  tripId: number,
  removedOrder: number,
  timestamp: string
) => {
  await database
    .update(parkVisits)
    .set({
      tripStopOrder: sql`${parkVisits.tripStopOrder} - 1`,
      updatedAt: timestamp
    })
    .where(and(eq(parkVisits.tripId, tripId), gt(parkVisits.tripStopOrder, removedOrder)));
};

const resolveCreateTripStopOrder = async (
  database: DbClient,
  tripId: number | null,
  requestedOrder: number | undefined,
  timestamp: string
) => {
  if (tripId === null) {
    if (requestedOrder !== undefined) {
      throw new RepositoryValidationError('Trip stop order requires an assigned trip.');
    }

    return null;
  }

  const tripVisitCount = await getTripVisitCount(database, tripId);
  const nextOrder = normalizeTripStopOrder(requestedOrder, tripVisitCount + 1);

  if (nextOrder <= tripVisitCount) {
    await shiftTripStopOrdersUpFrom(database, tripId, nextOrder, timestamp);
  }

  return nextOrder;
};

const resolveUpdatedTripStopOrder = async (
  database: DbClient,
  existingVisit: typeof parkVisits.$inferSelect,
  nextTripId: number | null,
  requestedOrder: number | undefined,
  timestamp: string
) => {
  const currentTripId = existingVisit.tripId;
  const currentOrder = existingVisit.tripStopOrder;

  if (nextTripId === null) {
    if (requestedOrder !== undefined) {
      throw new RepositoryValidationError('Trip stop order requires an assigned trip.');
    }

    if (currentTripId !== null && currentOrder !== null) {
      await closeTripStopOrderGap(database, currentTripId, currentOrder, timestamp);
    }

    return null;
  }

  if (currentTripId === null || currentTripId !== nextTripId) {
    if (currentTripId !== null && currentOrder !== null) {
      await closeTripStopOrderGap(database, currentTripId, currentOrder, timestamp);
    }

    const nextTripVisitCount = await getTripVisitCount(database, nextTripId);
    const nextOrder = normalizeTripStopOrder(requestedOrder, nextTripVisitCount + 1);

    if (nextOrder <= nextTripVisitCount) {
      await shiftTripStopOrdersUpFrom(database, nextTripId, nextOrder, timestamp);
    }

    return nextOrder;
  }

  if (requestedOrder === undefined) {
    if (currentOrder !== null) {
      return currentOrder;
    }

    const nextTripVisitCount = await getTripVisitCount(database, nextTripId, existingVisit.id);
    return nextTripVisitCount + 1;
  }

  const tripVisitCount = await getTripVisitCount(database, nextTripId);
  const nextOrder = normalizeTripStopOrder(requestedOrder, tripVisitCount);

  if (currentOrder === null) {
    await shiftTripStopOrdersUpFrom(database, nextTripId, nextOrder, timestamp);
    return nextOrder;
  }

  if (nextOrder === currentOrder) {
    return currentOrder;
  }

  if (nextOrder < currentOrder) {
    await database
      .update(parkVisits)
      .set({
        tripStopOrder: sql`${parkVisits.tripStopOrder} + 1`,
        updatedAt: timestamp
      })
      .where(
        and(
          eq(parkVisits.tripId, nextTripId),
          gte(parkVisits.tripStopOrder, nextOrder),
          lt(parkVisits.tripStopOrder, currentOrder)
        )
      );
  } else {
    await database
      .update(parkVisits)
      .set({
        tripStopOrder: sql`${parkVisits.tripStopOrder} - 1`,
        updatedAt: timestamp
      })
      .where(
        and(
          eq(parkVisits.tripId, nextTripId),
          gt(parkVisits.tripStopOrder, currentOrder),
          lte(parkVisits.tripStopOrder, nextOrder)
        )
      );
  }

  return nextOrder;
};

const bumpPublicVisitDataVersion = async (database: DbClient, updatedAt: string) => {
  await database
    .insert(publicDataVersions)
    .values({
      key: PUBLIC_VISIT_DATA_VERSION_KEY,
      updatedAt,
      version: 1
    })
    .onConflictDoUpdate({
      set: {
        updatedAt,
        version: sql`${publicDataVersions.version} + 1`
      },
      target: publicDataVersions.key
    });
};

const getPublicVisitDataVersionRecord = async (database: Database) => {
  const rows = await database
    .select({
      updatedAt: publicDataVersions.updatedAt,
      version: publicDataVersions.version
    })
    .from(publicDataVersions)
    .where(eq(publicDataVersions.key, PUBLIC_VISIT_DATA_VERSION_KEY))
    .limit(1);

  return rows[0] ?? null;
};

const getVisitRowWithParkById = async (database: Database, visitId: number) => {
  return (
    (
      await database
        .select({
          park: parks,
          visit: parkVisits
        })
        .from(parkVisits)
        .innerJoin(parks, eq(parkVisits.parkId, parks.id))
        .where(and(eq(parkVisits.id, visitId), eq(parks.removed, false)))
    )[0] ?? null
  );
};

const buildVisitWithPark = async (
  database: Database,
  row: VisitRowWithPark,
  getImagePublicUrl: (key: string) => Promise<string>
) => {
  const [visit] = await buildVisits(database, [row.visit], getImagePublicUrl);

  return {
    ...visit!,
    park: {
      name: row.park.name,
      slug: row.park.slug
    }
  };
};

export const getParkVisitsBySlug = async (
  database: Database,
  slug: string,
  getImagePublicUrl: (key: string) => Promise<string>
) => {
  const park = await getParkRecordBySlug(database, slug);

  if (!park) {
    return null;
  }

  const visitRows = await getVisitsForPark(database, park.id);
  const visits = await buildVisits(database, visitRows, getImagePublicUrl);

  return {
    visitedSummary: toVisitedSummary(visits),
    visits
  };
};

export const syncParkTypes = async (database: DbClient) => {
  await database
    .insert(parkTypes)
    .values([...supportedParkTypes])
    .onConflictDoUpdate({
      set: {
        code: sql`excluded.code`,
        name: sql`excluded.name`,
        slug: sql`excluded.slug`
      },
      target: parkTypes.id
    });
};

export const createImportRun = async (
  database: DbClient,
  values: typeof importRuns.$inferInsert
) => {
  const row = (
    await database.insert(importRuns).values(values).returning({
      id: importRuns.id
    })
  )[0]!;

  return row.id;
};

export const listExistingParksByLipasIds = async (database: Database, lipasIds: number[]) => {
  if (lipasIds.length === 0) {
    return [];
  }

  return database.query.parks.findMany({
    where: and(inArray(parks.lipasId, lipasIds), eq(parks.managedByLipasImport, true))
  });
};

export const listParks = async (
  database: Database,
  options: { categorySlug?: SupportedParkCategorySlug; typeSlug?: SupportedParkTypeSlug } = {},
  getLogoPublicUrl?: GetLogoPublicUrl,
  getMapPublicUrl?: GetMapPublicUrl
) => {
  return Promise.all(
    (await listTypedParks(database, options)).map((row) =>
      toPark(row, getLogoPublicUrl, getMapPublicUrl)
    )
  );
};

export const listRemovedParks = async (
  database: Database,
  getLogoPublicUrl?: GetLogoPublicUrl,
  getMapPublicUrl?: GetMapPublicUrl
) => {
  const rows = await database
    .select({
      park: parks,
      parkType: parkTypes
    })
    .from(parks)
    .innerJoin(parkTypes, eq(parks.typeId, parkTypes.id))
    .where(removedCatalogWhere())
    .orderBy(parks.name);

  return Promise.all(
    rows.map(async (row) =>
      withOptionalDisplayTypeName(row.park, {
        address: toAddress(row.park.locationLabel, row.park.postalCode, row.park.postalOffice),
        areaKm2: row.park.areaKm2,
        boundingBox: toBoundingBox(row.park),
        catalogStatus: row.park.catalogStatus as 'active' | 'inactive',
        establishmentYear: row.park.establishmentYear,
        logo: await toLogo(row.park.logoKey, row.park.logoUpdatedAt, getLogoPublicUrl),
        parkUrl: row.park.parkUrl,
        map: await toMap(row.park.mapKey, row.park.mapUpdatedAt, getMapPublicUrl),
        markerPoint: toMarkerPoint(row.park),
        name: row.park.name,
        ...toRawLocationFields(row.park.locationLabel, row.park.postalCode, row.park.postalOffice),
        removed: true as const,
        slug: row.park.slug,
        category: toParkCategory(row.parkType.slug as SupportedParkTypeSlug),
        type: toParkType(row.parkType),
        updatedAt: row.park.updatedAt
      })
    )
  );
};

export const listParkSearchEntries = async (
  database: Database,
  options: { categorySlug?: SupportedParkCategorySlug; typeSlug?: SupportedParkTypeSlug } = {}
) => {
  const rows = await listLightweightParkRows(database, visibleCatalogWhere(options));

  return rows.map((row) => toSearchPark(row));
};

export const listAdminParkVisibility = async (database: Database) => {
  const [visibleRows, removedRows] = await Promise.all([
    listLightweightParkRows(database, visibleCatalogWhere()),
    listLightweightParkRows(database, removedCatalogWhere())
  ]);

  return {
    removedParks: removedRows.map((row) => toAdminVisibilityPark(row)),
    visibleParks: visibleRows.map((row) => toAdminVisibilityPark(row))
  };
};

export const getParkBySlug = async (
  database: Database,
  slug: string,
  getLogoPublicUrl?: GetLogoPublicUrl,
  getMapPublicUrl?: GetMapPublicUrl
) => {
  const row = await getTypedParkBySlug(database, slug);
  return row ? await toPark(row, getLogoPublicUrl, getMapPublicUrl) : null;
};

export const getParkBySlugIncludingRemoved = async (
  database: Database,
  slug: string,
  getLogoPublicUrl?: GetLogoPublicUrl,
  getMapPublicUrl?: GetMapPublicUrl
) => {
  const row = await getTypedParkBySlugIncludingRemoved(database, slug);
  return row ? await toPark(row, getLogoPublicUrl, getMapPublicUrl) : null;
};

export const listVisits = async (
  database: Database,
  getImagePublicUrl: (key: string) => Promise<string>
) => {
  const rows = await listVisitRowsWithPark(database);

  return Promise.all(rows.map((row) => buildVisitWithPark(database, row, getImagePublicUrl)));
};

export const listTrips = async (database: Database) => {
  const rows = await listTripRows(database);
  return rows.map((row) => toTrip(row));
};

export const getVisitById = async (
  database: Database,
  visitId: number,
  getImagePublicUrl: (key: string) => Promise<string>
) => {
  const row = await getVisitRowWithParkById(database, visitId);
  return row ? buildVisitWithPark(database, row, getImagePublicUrl) : null;
};

export const getPublicVisitDataVersion = async (
  database: Database
): Promise<PublicVisitVersion> => {
  const version = await getPublicVisitDataVersionRecord(database);

  return version ?? { updatedAt: null, version: 0 };
};

export const getPublicHomeSummary = async (database: Database) => {
  const [parkRows, visitRows, version] = await Promise.all([
    listPublicParkRows(database),
    listPublicVisitRows(database),
    getPublicVisitDataVersion(database)
  ]);

  const publicParks = await Promise.all(parkRows.map((row) => toPublicPark(row)));
  const parksById = new Map(publicParks.map((park, index) => [parkRows[index]!.parkId, park]));
  const visitsByParkId = new Map<number, PublicVisitRow[]>();

  for (const visit of visitRows) {
    const visits = visitsByParkId.get(visit.parkId) ?? [];
    visits.push(visit);
    visitsByParkId.set(visit.parkId, visits);
  }

  const progressByType = Array.from(
    publicParks.reduce<
      Map<
        SupportedParkTypeSlug,
        {
          totalParks: number;
          totalVisits: number;
          type: (typeof publicParks)[number]['type'];
          visible: boolean;
          visitedParks: number;
        }
      >
    >((accumulator, park, index) => {
      const existing = accumulator.get(park.type.slug) ?? {
        totalParks: 0,
        totalVisits: 0,
        type: park.type,
        visible:
          !isTrailTypeSlug(park.type.slug) && !isHikingAndWildernessAreaTypeSlug(park.type.slug),
        visitedParks: 0
      };
      const parkVisits = visitsByParkId.get(parkRows[index]!.parkId) ?? [];

      existing.totalParks += 1;
      existing.totalVisits += parkVisits.length;
      if (parkVisits.length > 0) {
        existing.visitedParks += 1;
      }

      accumulator.set(park.type.slug, existing);
      return accumulator;
    }, new Map())
  )
    .map(([, value]) => value)
    .sort((a, b) => a.type.name.localeCompare(b.type.name));

  const progressByCategory = Array.from(
    publicParks.reduce<
      Map<
        SupportedParkCategorySlug,
        {
          category: (typeof publicParks)[number]['category'];
          totalParks: number;
          totalVisits: number;
          visitedParks: number;
        }
      >
    >((accumulator, park, index) => {
      const existing = accumulator.get(park.category.slug) ?? {
        category: park.category,
        totalParks: 0,
        totalVisits: 0,
        visitedParks: 0
      };
      const parkVisits = visitsByParkId.get(parkRows[index]!.parkId) ?? [];

      existing.totalParks += 1;
      existing.totalVisits += parkVisits.length;
      if (parkVisits.length > 0) {
        existing.visitedParks += 1;
      }

      accumulator.set(park.category.slug, existing);
      return accumulator;
    }, new Map())
  )
    .map(([, value]) => value)
    .sort((a, b) => a.category.name.localeCompare(b.category.name));

  const parkVisitSummaries = Array.from(visitsByParkId.entries()).map(([parkId, visits]) => {
    const park = parksById.get(parkId)!;

    return {
      park: {
        name: park.name,
        slug: park.slug
      },
      visitedSummary: toVisitedSummary(visits)
    };
  });

  const mostVisitedParks = [...parkVisitSummaries]
    .sort((a, b) => {
      if (b.visitedSummary.visitCount !== a.visitedSummary.visitCount) {
        return b.visitedSummary.visitCount - a.visitedSummary.visitCount;
      }

      if (b.visitedSummary.lastVisitedOn !== a.visitedSummary.lastVisitedOn) {
        return b.visitedSummary.lastVisitedOn!.localeCompare(a.visitedSummary.lastVisitedOn!);
      }

      return a.park.name.localeCompare(b.park.name);
    })
    .map(({ park, visitedSummary }) => ({
      lastVisitedOn: visitedSummary.lastVisitedOn,
      park,
      visitCount: visitedSummary.visitCount
    }))
    .slice(0, 10);

  const recentVisits = [...parkVisitSummaries]
    .sort((a, b) => {
      if (b.visitedSummary.lastVisitedOn !== a.visitedSummary.lastVisitedOn) {
        return b.visitedSummary.lastVisitedOn!.localeCompare(a.visitedSummary.lastVisitedOn!);
      }

      return a.park.name.localeCompare(b.park.name);
    })
    .slice(0, 10);

  return {
    latestVisitEntries: visitRows.slice(0, 10).map((visit) => ({
      createdAt: visit.createdAt,
      id: visit.id,
      park: {
        name: visit.parkName,
        slug: visit.parkSlug
      },
      updatedAt: visit.updatedAt,
      visitedOn: visit.visitedOn
    })),
    mostVisitedParks,
    progressByCategory,
    progressByType,
    recentVisits,
    seasonalVisitCounts: countVisitsBySeason(visitRows),
    totalVisits: visitRows.length,
    uniqueVisitedParks: visitsByParkId.size,
    updatedAt: version.updatedAt,
    version: version.version
  };
};

export const getPublicMapSummary = async (
  database: Database,
  getLogoPublicUrl?: GetLogoPublicUrl,
  getMapPublicUrl?: GetMapPublicUrl
) => {
  const [parkRows, visitRows, version] = await Promise.all([
    listPublicParkRows(database),
    listPublicVisitRows(database),
    getPublicVisitDataVersion(database)
  ]);

  const visitsByParkId = new Map<number, PublicVisitRow[]>();

  for (const visit of visitRows) {
    const visits = visitsByParkId.get(visit.parkId) ?? [];
    visits.push(visit);
    visitsByParkId.set(visit.parkId, visits);
  }

  return {
    parks: await Promise.all(
      parkRows.map(async (parkRow) => ({
        ...(await toPublicPark(parkRow, getLogoPublicUrl, getMapPublicUrl)),
        visitedSummary: toVisitedSummary(visitsByParkId.get(parkRow.parkId) ?? [])
      }))
    ),
    updatedAt: version.updatedAt,
    version: version.version
  };
};

export const listVisitsTimeline = async (database: Database) => {
  const visitRows = sortTripAwareVisitRows(await listVisitTimelineRows(database));

  return visitRows.map((visit) => ({
    createdAt: visit.createdAt,
    id: visit.id,
    imageCount: visit.imageCount,
    park: {
      name: visit.parkName,
      slug: visit.parkSlug,
      typeLabel: resolveTypeLabel(visit)
    },
    route: visit.route,
    trip:
      visit.tripId === null || !visit.tripName
        ? null
        : {
            id: visit.tripId,
            name: visit.tripName
          },
    tripStopOrder: visit.tripStopOrder,
    visitedOn: visit.visitedOn
  }));
};

export const listTripPlannerCandidateParks = async (database: Database) => {
  const [parkRows, visitRows] = await Promise.all([
    listTripPlannerParkRows(database),
    listPublicVisitRows(database)
  ]);
  const visitsByParkId = new Map<number, PublicVisitRow[]>();

  for (const visit of visitRows) {
    const visits = visitsByParkId.get(visit.parkId) ?? [];
    visits.push(visit);
    visitsByParkId.set(visit.parkId, visits);
  }

  return parkRows.map((parkRow) =>
    toTripPlannerPark(parkRow, visitsByParkId.get(parkRow.parkId) ?? [])
  );
};

export const createTrip = async (database: Database, input: PutTripInput) => {
  const timestamp = new Date().toISOString();
  const row = (
    await database
      .insert(trips)
      .values({
        createdAt: timestamp,
        description: normalizeOptionalText(input.description),
        name: normalizeRequiredText(input.name, 'Trip name'),
        updatedAt: timestamp
      })
      .returning()
  )[0]!;

  await bumpPublicVisitDataVersion(database, timestamp);

  return toTrip({
    createdAt: row.createdAt,
    description: row.description,
    endVisitedOn: null,
    id: row.id,
    name: row.name,
    startVisitedOn: null,
    updatedAt: row.updatedAt,
    visitCount: 0
  });
};

export const createVisit = async (database: Database, slug: string, input: PutVisitInput) => {
  const park = await getParkRecordBySlug(database, slug);

  if (!park) {
    throw new RepositoryNotFoundError(`Park not found for slug "${slug}".`);
  }

  const tripId = await resolveTripId(database, input.tripId);
  const timestamp = new Date().toISOString();

  return database.transaction(async (tx) => {
    const tripStopOrder = await resolveCreateTripStopOrder(
      tx,
      tripId ?? null,
      input.tripStopOrder,
      timestamp
    );
    const row = (
      await tx
        .insert(parkVisits)
        .values({
          author: input.author?.trim() || null,
          createdAt: timestamp,
          note: input.note?.trim() || null,
          parkId: park.id,
          route: input.route?.trim() || null,
          tripId: tripId ?? null,
          tripStopOrder,
          updatedAt: timestamp,
          visitedOn: input.visitedOn
        })
        .returning()
    )[0]!;

    await bumpPublicVisitDataVersion(tx, timestamp);

    const trip =
      row.tripId === null ? null : toTripReference((await getTripRecordById(tx, row.tripId))!);

    return toVisit(row, [], trip);
  });
};

export const reassignParkVisits = async (
  database: Database,
  input: ReassignParkVisitsInput
): Promise<ReassignParkVisitsResult> => {
  const fromSlug = input.fromSlug.trim();
  const toSlug = input.toSlug.trim();
  const dryRun = input.dryRun ?? false;

  if (!fromSlug || !toSlug) {
    throw new Error('Both fromSlug and toSlug are required.');
  }

  if (fromSlug === toSlug) {
    throw new Error('Source and target park slugs must be different.');
  }

  const [fromPark] = await database.select().from(parks).where(eq(parks.slug, fromSlug)).limit(1);

  if (!fromPark) {
    throw new Error(`Source park not found for slug "${fromSlug}".`);
  }

  const [toPark] = await database.select().from(parks).where(eq(parks.slug, toSlug)).limit(1);

  if (!toPark) {
    throw new Error(`Target park not found for slug "${toSlug}".`);
  }

  if (toPark.removed) {
    throw new Error(`Target park "${toSlug}" is removed and cannot receive visits.`);
  }

  const visitRows = await database
    .select({ id: parkVisits.id })
    .from(parkVisits)
    .where(eq(parkVisits.parkId, fromPark.id))
    .orderBy(asc(parkVisits.id));

  const movedVisitIds = visitRows.map((visit) => visit.id);
  const movedVisitCount = movedVisitIds.length;

  const imageRows =
    movedVisitIds.length === 0
      ? []
      : await database
          .select({ id: visitImages.id })
          .from(visitImages)
          .where(inArray(visitImages.visitId, movedVisitIds));

  const movedImageCount = imageRows.length;

  if (!dryRun && movedVisitCount > 0) {
    const timestamp = new Date().toISOString();

    await database.transaction(async (tx) => {
      await tx
        .update(parkVisits)
        .set({
          parkId: toPark.id,
          updatedAt: timestamp
        })
        .where(eq(parkVisits.parkId, fromPark.id));

      await bumpPublicVisitDataVersion(tx, timestamp);
    });
  }

  return {
    dryRun,
    fromPark: {
      id: fromPark.id,
      name: fromPark.name,
      slug: fromPark.slug
    },
    movedImageCount,
    movedVisitCount,
    movedVisitIds,
    toPark: {
      id: toPark.id,
      name: toPark.name,
      slug: toPark.slug
    }
  };
};

export const findVisitRecordById = async (database: Database, visitId: number) => {
  const rows = await database.select().from(parkVisits).where(eq(parkVisits.id, visitId)).limit(1);
  return rows[0] ?? null;
};

export const updateParkRemoved = async (database: Database, slug: string, removed: boolean) => {
  const park = await findParkRecordBySlugIncludingRemoved(database, slug);

  if (!park) {
    return false;
  }

  await database
    .update(parks)
    .set({
      removed,
      updatedAt: new Date().toISOString()
    })
    .where(eq(parks.id, park.id));

  return true;
};

export const updateParkDetails = async (
  database: Database,
  slug: string,
  input: UpdateParkDetailsInput,
  getLogoPublicUrl?: GetLogoPublicUrl,
  getMapPublicUrl?: GetMapPublicUrl
) => {
  const park = await findParkRecordBySlugIncludingRemoved(database, slug);

  if (!park) {
    return null;
  }

  const nextName = input.name === undefined ? park.name : normalizeRequiredText(input.name, 'Name');
  const nextSlug =
    input.slug !== undefined
      ? createParkSlug(normalizeRequiredText(input.slug, 'Slug'))
      : input.name !== undefined
        ? createParkSlug(nextName)
        : park.slug;
  const nextLocationLabel =
    input.locationLabel === undefined
      ? park.locationLabel
      : normalizeRequiredText(input.locationLabel, 'Location label');
  const nextParkUrl =
    input.parkUrl === undefined
      ? park.parkUrl
      : input.parkUrl === null
        ? null
        : normalizeParkUrl(input.parkUrl);

  if (input.parkUrl !== undefined && input.parkUrl !== null && !nextParkUrl) {
    throw new Error('Invalid park URL.');
  }

  const conflictingPark = await database.query.parks.findFirst({
    where: eq(parks.slug, nextSlug)
  });

  if (conflictingPark && conflictingPark.id !== park.id) {
    throw new Error(`Park slug "${nextSlug}" is already in use.`);
  }

  const timestamp = new Date().toISOString();

  await database
    .update(parks)
    .set({
      areaKm2: input.areaKm2 === undefined ? park.areaKm2 : input.areaKm2,
      displayTypeName:
        input.displayTypeName === undefined
          ? park.displayTypeName
          : normalizeOptionalText(input.displayTypeName),
      establishmentYear:
        input.establishmentYear === undefined ? park.establishmentYear : input.establishmentYear,
      locationLabel: nextLocationLabel,
      parkUrl: nextParkUrl,
      name: nextName,
      postalCode:
        input.postalCode === undefined ? park.postalCode : normalizeOptionalText(input.postalCode),
      postalOffice:
        input.postalOffice === undefined
          ? park.postalOffice
          : normalizeOptionalText(input.postalOffice),
      slug: nextSlug,
      updatedAt: timestamp
    })
    .where(eq(parks.id, park.id));

  return getParkBySlugIncludingRemoved(database, nextSlug, getLogoPublicUrl, getMapPublicUrl);
};

export const updateParkLogo = async (
  database: Database,
  slug: string,
  logo: { key: string; updatedAt: string }
) => {
  const park = await findParkRecordBySlugIncludingRemoved(database, slug);

  if (!park) {
    return null;
  }

  await database
    .update(parks)
    .set({
      logoKey: logo.key,
      logoUpdatedAt: logo.updatedAt,
      updatedAt: logo.updatedAt
    })
    .where(eq(parks.id, park.id));

  return {
    id: park.id,
    name: park.name,
    slug: park.slug
  };
};

export const updateParkMap = async (
  database: Database,
  slug: string,
  map: { key: string; updatedAt: string }
) => {
  const park = await findParkRecordBySlugIncludingRemoved(database, slug);

  if (!park) {
    return null;
  }

  await database
    .update(parks)
    .set({
      mapKey: map.key,
      mapUpdatedAt: map.updatedAt,
      updatedAt: map.updatedAt
    })
    .where(eq(parks.id, park.id));

  return {
    id: park.id,
    name: park.name,
    slug: park.slug
  };
};

export const updateTrip = async (database: Database, tripId: number, input: UpdateTripInput) => {
  const existingTrip = await getTripRecordById(database, tripId);

  if (!existingTrip) {
    return null;
  }

  const timestamp = new Date().toISOString();

  await database
    .update(trips)
    .set({
      description:
        input.description === undefined
          ? existingTrip.description
          : normalizeOptionalText(input.description),
      name:
        input.name === undefined
          ? existingTrip.name
          : normalizeRequiredText(input.name, 'Trip name'),
      updatedAt: timestamp
    })
    .where(eq(trips.id, tripId));

  await bumpPublicVisitDataVersion(database, timestamp);

  const row = (await listTripRows(database)).find((trip) => trip.id === tripId)!;

  return toTrip(row);
};

export const updateVisit = async (database: Database, visitId: number, input: UpdateVisitInput) => {
  const [existingVisit] = await database
    .select()
    .from(parkVisits)
    .where(eq(parkVisits.id, visitId));

  if (!existingVisit) {
    return null;
  }

  const nextTripId = await resolveTripId(database, input.tripId);
  const timestamp = new Date().toISOString();

  return database.transaction(async (tx) => {
    const resolvedTripId = nextTripId === undefined ? existingVisit.tripId : nextTripId;
    const tripStopOrder = await resolveUpdatedTripStopOrder(
      tx,
      existingVisit,
      resolvedTripId,
      input.tripStopOrder,
      timestamp
    );

    await tx
      .update(parkVisits)
      .set({
        author: input.author === undefined ? existingVisit.author : input.author?.trim() || null,
        note: input.note === undefined ? existingVisit.note : input.note?.trim() || null,
        route: input.route === undefined ? existingVisit.route : input.route?.trim() || null,
        tripId: resolvedTripId,
        tripStopOrder,
        updatedAt: timestamp,
        visitedOn: input.visitedOn ?? existingVisit.visitedOn
      })
      .where(eq(parkVisits.id, visitId));

    const updatedVisit = (await tx.select().from(parkVisits).where(eq(parkVisits.id, visitId)))[0]!;

    await bumpPublicVisitDataVersion(tx, timestamp);

    const trip =
      updatedVisit.tripId === null
        ? null
        : toTripReference((await getTripRecordById(tx, updatedVisit.tripId))!);

    return toVisit(updatedVisit, [], trip);
  });
};

export const deleteTrip = async (database: Database, tripId: number) => {
  const timestamp = new Date().toISOString();

  return database.transaction(async (tx) => {
    await tx
      .update(parkVisits)
      .set({
        tripStopOrder: null,
        updatedAt: timestamp
      })
      .where(eq(parkVisits.tripId, tripId));

    const result = await tx.delete(trips).where(eq(trips.id, tripId));

    if (Number(result.rowsAffected) > 0) {
      await bumpPublicVisitDataVersion(tx, timestamp);
    }

    return Number(result.rowsAffected) > 0;
  });
};

export const deleteVisit = async (database: Database, visitId: number) => {
  const existingVisit = await findVisitRecordById(database, visitId);

  if (!existingVisit) {
    return false;
  }

  const timestamp = new Date().toISOString();

  return database.transaction(async (tx) => {
    const result = await tx.delete(parkVisits).where(eq(parkVisits.id, visitId));

    if (existingVisit.tripId !== null && existingVisit.tripStopOrder !== null) {
      await closeTripStopOrderGap(tx, existingVisit.tripId, existingVisit.tripStopOrder, timestamp);
    }

    await bumpPublicVisitDataVersion(tx, timestamp);

    return Number(result.rowsAffected) > 0;
  });
};

export const createVisitImage = async (
  database: Database,
  values: typeof visitImages.$inferInsert
) => {
  const row = (await database.insert(visitImages).values(values).returning())[0]!;
  await bumpPublicVisitDataVersion(database, values.updatedAt);
  return row;
};

export const findVisitImageById = async (database: Database, imageId: number) => {
  const rows = await database
    .select()
    .from(visitImages)
    .where(eq(visitImages.id, imageId))
    .limit(1);
  return rows[0] ?? null;
};

export const deleteVisitImage = async (database: Database, imageId: number) => {
  const result = await database.delete(visitImages).where(eq(visitImages.id, imageId));

  if (Number(result.rowsAffected) > 0) {
    await bumpPublicVisitDataVersion(database, new Date().toISOString());
  }

  return Number(result.rowsAffected) > 0;
};

export const reorderVisitImages = async (
  database: Database,
  visitId: number,
  orderedImageIds: number[]
) => {
  const existing = await database
    .select({ id: visitImages.id })
    .from(visitImages)
    .where(eq(visitImages.visitId, visitId));

  const existingIds = new Set(existing.map((r) => r.id));
  if (
    orderedImageIds.length !== existingIds.size ||
    !orderedImageIds.every((id) => existingIds.has(id))
  ) {
    throw new Error('Invalid image order: IDs do not match visit images.');
  }

  const timestamp = new Date().toISOString();

  for (let index = 0; index < orderedImageIds.length; index++) {
    const imageId = orderedImageIds[index]!;
    await database
      .update(visitImages)
      .set({ displayOrder: index, updatedAt: timestamp })
      .where(eq(visitImages.id, imageId));
  }

  await bumpPublicVisitDataVersion(database, timestamp);
};

export const upsertCatalogPark = async (database: DbClient, values: UpsertCatalogParkInput) => {
  const valuesWithImportedFields = {
    ...values,
    importedAreaKm2: values.areaKm2,
    importedDisplayTypeName: values.displayTypeName,
    importedEstablishmentYear: values.establishmentYear,
    importedLocationLabel: values.locationLabel,
    importedParkUrl: values.parkUrl,
    importedName: values.name,
    importedPostalCode: values.postalCode,
    importedPostalOffice: values.postalOffice,
    importedSlug: values.slug
  };

  await database
    .insert(parks)
    .values(valuesWithImportedFields)
    .onConflictDoUpdate({
      set: {
        areaKm2: sql`CASE
          WHEN ${parks.areaKm2} IS ${parks.importedAreaKm2}
            THEN excluded.imported_area_km2
          ELSE ${parks.areaKm2}
        END`,
        bboxMaxLat: values.bboxMaxLat,
        bboxMaxLon: values.bboxMaxLon,
        bboxMinLat: values.bboxMinLat,
        bboxMinLon: values.bboxMinLon,
        boundaryGeojson: values.boundaryGeojson,
        catalogStatus: values.catalogStatus,
        displayTypeName: sql`CASE
          WHEN ${parks.displayTypeName} IS ${parks.importedDisplayTypeName}
            THEN excluded.imported_display_type_name
          ELSE ${parks.displayTypeName}
        END`,
        establishmentYear: sql`CASE
          WHEN ${parks.establishmentYear} IS ${parks.importedEstablishmentYear}
            THEN excluded.imported_establishment_year
          ELSE ${parks.establishmentYear}
        END`,
        importedAreaKm2: valuesWithImportedFields.importedAreaKm2,
        importedDisplayTypeName: valuesWithImportedFields.importedDisplayTypeName,
        importedEstablishmentYear: valuesWithImportedFields.importedEstablishmentYear,
        importedLocationLabel: valuesWithImportedFields.importedLocationLabel,
        importedParkUrl: valuesWithImportedFields.importedParkUrl,
        importedName: valuesWithImportedFields.importedName,
        importedPostalCode: valuesWithImportedFields.importedPostalCode,
        importedPostalOffice: valuesWithImportedFields.importedPostalOffice,
        importedSlug: valuesWithImportedFields.importedSlug,
        lastImportRunId: values.lastImportRunId,
        locationLabel: sql`CASE
          WHEN ${parks.locationLabel} IS ${parks.importedLocationLabel}
            THEN excluded.imported_location_label
          ELSE ${parks.locationLabel}
        END`,
        parkUrl: sql`CASE
          WHEN ${parks.parkUrl} IS ${parks.importedParkUrl}
            THEN excluded.imported_park_url
          ELSE ${parks.parkUrl}
        END`,
        managedByLipasImport: values.managedByLipasImport,
        markerLat: values.markerLat,
        markerLon: values.markerLon,
        municipalityCode: values.municipalityCode,
        name: sql`CASE
          WHEN ${parks.name} IS ${parks.importedName}
            THEN excluded.imported_name
          ELSE ${parks.name}
        END`,
        postalCode: sql`CASE
          WHEN ${parks.postalCode} IS ${parks.importedPostalCode}
            THEN excluded.imported_postal_code
          ELSE ${parks.postalCode}
        END`,
        postalOffice: sql`CASE
          WHEN ${parks.postalOffice} IS ${parks.importedPostalOffice}
            THEN excluded.imported_postal_office
          ELSE ${parks.postalOffice}
        END`,
        slug: sql`CASE
          WHEN ${parks.slug} IS ${parks.importedSlug}
            THEN excluded.imported_slug
          ELSE ${parks.slug}
        END`,
        sourceEventDate: values.sourceEventDate,
        typeId: values.typeId,
        updatedAt: values.updatedAt
      },
      target: parks.lipasId
    });
};

export const upsertImportedPark = async (database: DbClient, values: UpsertCatalogParkInput) =>
  upsertCatalogPark(database, values);

export const markMissingParksInactive = async (
  database: DbClient,
  activeLipasIds: number[],
  lastImportRunId: number,
  updatedAt: string
) => {
  if (activeLipasIds.length === 0) {
    await database
      .update(parks)
      .set({
        catalogStatus: 'inactive',
        lastImportRunId,
        updatedAt
      })
      .where(eq(parks.managedByLipasImport, true));
    return;
  }

  await database
    .update(parks)
    .set({
      catalogStatus: 'inactive',
      lastImportRunId,
      updatedAt
    })
    .where(
      and(
        eq(parks.catalogStatus, 'active'),
        eq(parks.managedByLipasImport, true),
        notInArray(parks.lipasId, activeLipasIds)
      )
    );
};

export const getCatalogListEtagSeed = async (
  database: Database,
  options: { categorySlug?: SupportedParkCategorySlug; typeSlug?: SupportedParkTypeSlug } = {}
) => {
  const summary = (
    await database
      .select({
        activeCount: sql<number>`COUNT(*)`,
        latestImportRunId: sql<number | null>`MAX(${parks.lastImportRunId})`,
        latestUpdatedAt: sql<string | null>`MAX(${parks.updatedAt})`
      })
      .from(parks)
      .innerJoin(parkTypes, eq(parks.typeId, parkTypes.id))
      .where(visibleCatalogWhere(options))
  )[0]!;

  const filterKey =
    [
      options.typeSlug ? `type:${options.typeSlug}` : null,
      options.categorySlug ? `category:${options.categorySlug}` : null
    ]
      .filter(Boolean)
      .join('|') || null;

  return {
    activeCount: summary.activeCount,
    filterKey,
    latestImportRunId: summary.latestImportRunId,
    latestUpdatedAt: summary.latestUpdatedAt,
    typeSlug: options.typeSlug ?? null
  };
};

export const findAdminByEmail = async (db: DbClient, email: string) => {
  const rows = await db.select().from(admins).where(eq(admins.email, email)).limit(1);
  return rows[0] ?? null;
};
