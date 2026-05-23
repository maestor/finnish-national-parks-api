import { and, asc, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';

import type { SupportedParkTypeSlug } from '../parks/park-types.js';
import { supportedParkTypes } from '../parks/park-types.js';
import type { Database, DbClient } from './database.js';
import {
  admins,
  importRuns,
  parks,
  parkTypes,
  parkVisits,
  publicDataVersions,
  visitImages
} from './schema.js';

type PutVisitInput = {
  author?: string | null | undefined;
  note?: string | null | undefined;
  route?: string | null | undefined;
  visitedOn: string;
};

type UpdateVisitInput = {
  author?: string | null | undefined;
  note?: string | null | undefined;
  route?: string | null | undefined;
  visitedOn?: string | undefined;
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

type TypedParkRow = {
  park: typeof parks.$inferSelect;
  parkType: typeof parkTypes.$inferSelect;
};

type VisitRowWithPark = {
  park: typeof parks.$inferSelect;
  visit: typeof parkVisits.$inferSelect;
};

type PublicParkRow = {
  areaKm2: number | null;
  bboxMaxLat: number;
  bboxMaxLon: number;
  bboxMinLat: number;
  bboxMinLon: number;
  establishmentYear: number | null;
  locationLabel: string;
  luontoonUrl: string | null;
  markerLat: number;
  markerLon: number;
  name: string;
  parkId: number;
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
  updatedAt: string;
  visitedOn: string;
};

type PublicVisitVersion = {
  updatedAt: string | null;
  version: number;
};

const PUBLIC_VISIT_DATA_VERSION_KEY = 'public-visits';

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

const visibleParkBySlugWhere = (slug: string) =>
  and(eq(parks.slug, slug), eq(parks.removed, false));

const visibleCatalogWhere = (typeSlug?: SupportedParkTypeSlug) => {
  return typeSlug
    ? and(eq(parks.catalogStatus, 'active'), eq(parks.removed, false), eq(parkTypes.slug, typeSlug))
    : and(eq(parks.catalogStatus, 'active'), eq(parks.removed, false));
};

const removedCatalogWhere = () => eq(parks.removed, true);

const toLocation = (locationLabel: string, postalOffice: string | null) => {
  return postalOffice ? `${locationLabel}, ${postalOffice}` : locationLabel;
};

const toPark = (row: TypedParkRow) => {
  return {
    areaKm2: row.park.areaKm2,
    boundingBox: toBoundingBox(row.park),
    boundaryGeoJson: JSON.parse(row.park.boundaryGeojson) as Record<string, unknown>,
    catalogStatus: row.park.catalogStatus as 'active' | 'inactive',
    establishmentYear: row.park.establishmentYear,
    lipasId: row.park.lipasId,
    location: toLocation(row.park.locationLabel, row.park.postalOffice),
    luontoonUrl: row.park.luontoonUrl,
    markerPoint: toMarkerPoint(row.park),
    municipalityCode: row.park.municipalityCode,
    name: row.park.name,
    postalOffice: row.park.postalOffice,
    slug: row.park.slug,
    sourceEventDate: row.park.sourceEventDate,
    type: toParkType(row.parkType),
    updatedAt: row.park.updatedAt
  };
};

const toPublicPark = (row: PublicParkRow) => {
  return {
    areaKm2: row.areaKm2,
    boundingBox: {
      maxLat: row.bboxMaxLat,
      maxLon: row.bboxMaxLon,
      minLat: row.bboxMinLat,
      minLon: row.bboxMinLon
    },
    establishmentYear: row.establishmentYear,
    location: toLocation(row.locationLabel, row.postalOffice),
    luontoonUrl: row.luontoonUrl,
    markerPoint: {
      lat: row.markerLat,
      lon: row.markerLon
    },
    name: row.name,
    slug: row.slug,
    type: {
      code: row.typeCode,
      id: row.typeId,
      name: row.typeName,
      slug: row.typeSlug as SupportedParkTypeSlug
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

const toVisit = (row: typeof parkVisits.$inferSelect, images: VisitImage[] = []) => {
  return {
    author: row.author,
    createdAt: row.createdAt,
    id: row.id,
    images,
    note: row.note,
    route: row.route,
    updatedAt: row.updatedAt,
    visitedOn: row.visitedOn
  };
};

const getParkRecordBySlug = async (database: Database, slug: string) => {
  return database.query.parks.findFirst({
    where: visibleParkBySlugWhere(slug)
  });
};

const getParkRecordBySlugIncludingRemoved = async (database: Database, slug: string) => {
  return database.query.parks.findFirst({
    where: eq(parks.slug, slug)
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

const listTypedParks = async (
  database: Database,
  options: { typeSlug?: SupportedParkTypeSlug } = {}
) => {
  return database
    .select({
      park: parks,
      parkType: parkTypes
    })
    .from(parks)
    .innerJoin(parkTypes, eq(parks.typeId, parkTypes.id))
    .where(visibleCatalogWhere(options.typeSlug))
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
      establishmentYear: parks.establishmentYear,
      locationLabel: parks.locationLabel,
      luontoonUrl: parks.luontoonUrl,
      markerLat: parks.markerLat,
      markerLon: parks.markerLon,
      name: parks.name,
      parkId: parks.id,
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

const getVisitsForPark = async (database: Database, parkId: number) => {
  return database.query.parkVisits.findMany({
    orderBy: [desc(parkVisits.visitedOn), desc(parkVisits.id)],
    where: eq(parkVisits.parkId, parkId)
  });
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

  return visitRows.map((visit) => toVisit(visit, visitImagesByVisitId.get(visit.id)!));
};

const toVisitedSummary = (visits: Array<{ visitedOn: string }>) => {
  return {
    lastVisitedOn: visits[0]?.visitedOn ?? null,
    visitCount: visits.length,
    visited: visits.length > 0
  };
};

const listVisitRowsWithPark = async (database: Database) => {
  return database
    .select({
      park: parks,
      visit: parkVisits
    })
    .from(parkVisits)
    .innerJoin(parks, eq(parkVisits.parkId, parks.id))
    .where(eq(parks.removed, false))
    .orderBy(desc(parkVisits.visitedOn), desc(parkVisits.id));
};

const listPublicVisitRows = async (database: Database) => {
  return database
    .select({
      createdAt: parkVisits.createdAt,
      id: parkVisits.id,
      parkId: parkVisits.parkId,
      parkName: parks.name,
      parkSlug: parks.slug,
      updatedAt: parkVisits.updatedAt,
      visitedOn: parkVisits.visitedOn
    })
    .from(parkVisits)
    .innerJoin(parks, eq(parkVisits.parkId, parks.id))
    .where(eq(parks.removed, false))
    .orderBy(desc(parkVisits.visitedOn), desc(parkVisits.id));
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
    where: inArray(parks.lipasId, lipasIds)
  });
};

export const listParks = async (
  database: Database,
  options: { typeSlug?: SupportedParkTypeSlug } = {}
) => {
  return (await listTypedParks(database, options)).map(toPark);
};

export const listRemovedParks = async (database: Database) => {
  const rows = await database
    .select({
      park: parks,
      parkType: parkTypes
    })
    .from(parks)
    .innerJoin(parkTypes, eq(parks.typeId, parkTypes.id))
    .where(removedCatalogWhere())
    .orderBy(parks.name);

  return rows.map((row) => ({
    areaKm2: row.park.areaKm2,
    boundingBox: toBoundingBox(row.park),
    catalogStatus: row.park.catalogStatus as 'active' | 'inactive',
    establishmentYear: row.park.establishmentYear,
    location: toLocation(row.park.locationLabel, row.park.postalOffice),
    luontoonUrl: row.park.luontoonUrl,
    markerPoint: toMarkerPoint(row.park),
    name: row.park.name,
    removed: true as const,
    slug: row.park.slug,
    type: toParkType(row.parkType),
    updatedAt: row.park.updatedAt
  }));
};

export const getParkBySlug = async (database: Database, slug: string) => {
  const row = await getTypedParkBySlug(database, slug);
  return row ? toPark(row) : null;
};

export const listVisits = async (
  database: Database,
  getImagePublicUrl: (key: string) => Promise<string>
) => {
  const rows = await listVisitRowsWithPark(database);

  return Promise.all(rows.map((row) => buildVisitWithPark(database, row, getImagePublicUrl)));
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

  const publicParks = parkRows.map(toPublicPark);
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
          visitedParks: number;
        }
      >
    >((accumulator, park, index) => {
      const existing = accumulator.get(park.type.slug) ?? {
        totalParks: 0,
        totalVisits: 0,
        type: park.type,
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
    progressByType,
    recentVisits,
    totalVisits: visitRows.length,
    uniqueVisitedParks: visitsByParkId.size,
    updatedAt: version.updatedAt,
    version: version.version
  };
};

export const getPublicMapSummary = async (database: Database) => {
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
    parks: parkRows.map((parkRow) => ({
      ...toPublicPark(parkRow),
      visitedSummary: toVisitedSummary(visitsByParkId.get(parkRow.parkId) ?? [])
    })),
    updatedAt: version.updatedAt,
    version: version.version
  };
};

export const createVisit = async (database: Database, slug: string, input: PutVisitInput) => {
  const park = await getParkRecordBySlug(database, slug);

  if (!park) {
    throw new Error(`Park not found for slug "${slug}".`);
  }

  const timestamp = new Date().toISOString();
  const row = (
    await database
      .insert(parkVisits)
      .values({
        author: input.author?.trim() || null,
        createdAt: timestamp,
        note: input.note?.trim() || null,
        parkId: park.id,
        route: input.route?.trim() || null,
        updatedAt: timestamp,
        visitedOn: input.visitedOn
      })
      .returning()
  )[0]!;

  await bumpPublicVisitDataVersion(database, timestamp);

  return toVisit(row);
};

export const updateParkRemoved = async (database: Database, slug: string, removed: boolean) => {
  const park = await getParkRecordBySlugIncludingRemoved(database, slug);

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

export const updateVisit = async (database: Database, visitId: number, input: UpdateVisitInput) => {
  const [existingVisit] = await database
    .select()
    .from(parkVisits)
    .where(eq(parkVisits.id, visitId));

  if (!existingVisit) {
    return null;
  }

  const timestamp = new Date().toISOString();

  await database
    .update(parkVisits)
    .set({
      author: input.author === undefined ? existingVisit.author : input.author?.trim() || null,
      note: input.note === undefined ? existingVisit.note : input.note?.trim() || null,
      route: input.route === undefined ? existingVisit.route : input.route?.trim() || null,
      updatedAt: timestamp,
      visitedOn: input.visitedOn ?? existingVisit.visitedOn
    })
    .where(eq(parkVisits.id, visitId));

  const updatedVisit = (
    await database.select().from(parkVisits).where(eq(parkVisits.id, visitId))
  )[0]!;

  await bumpPublicVisitDataVersion(database, timestamp);

  return toVisit(updatedVisit);
};

export const deleteVisit = async (database: Database, visitId: number) => {
  const result = await database.delete(parkVisits).where(eq(parkVisits.id, visitId));

  if (Number(result.rowsAffected) > 0) {
    await bumpPublicVisitDataVersion(database, new Date().toISOString());
  }

  return Number(result.rowsAffected) > 0;
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

export const upsertImportedPark = async (
  database: DbClient,
  values: Omit<typeof parks.$inferInsert, 'id'>
) => {
  await database
    .insert(parks)
    .values(values)
    .onConflictDoUpdate({
      set: {
        areaKm2: values.areaKm2,
        bboxMaxLat: values.bboxMaxLat,
        bboxMaxLon: values.bboxMaxLon,
        bboxMinLat: values.bboxMinLat,
        bboxMinLon: values.bboxMinLon,
        boundaryGeojson: values.boundaryGeojson,
        catalogStatus: values.catalogStatus,
        establishmentYear: values.establishmentYear,
        lastImportRunId: values.lastImportRunId,
        locationLabel: values.locationLabel,
        luontoonUrl: values.luontoonUrl,
        markerLat: values.markerLat,
        markerLon: values.markerLon,
        municipalityCode: values.municipalityCode,
        name: values.name,
        postalOffice: values.postalOffice,
        slug: values.slug,
        sourceEventDate: values.sourceEventDate,
        typeId: values.typeId,
        updatedAt: values.updatedAt
      },
      target: parks.lipasId
    });
};

export const markMissingParksInactive = async (
  database: DbClient,
  activeLipasIds: number[],
  lastImportRunId: number,
  updatedAt: string
) => {
  if (activeLipasIds.length === 0) {
    await database.update(parks).set({
      catalogStatus: 'inactive',
      lastImportRunId,
      updatedAt
    });
    return;
  }

  await database
    .update(parks)
    .set({
      catalogStatus: 'inactive',
      lastImportRunId,
      updatedAt
    })
    .where(and(eq(parks.catalogStatus, 'active'), notInArray(parks.lipasId, activeLipasIds)));
};

export const getCatalogListEtagSeed = async (
  database: Database,
  options: { typeSlug?: SupportedParkTypeSlug } = {}
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
      .where(visibleCatalogWhere(options.typeSlug))
  )[0]!;

  return {
    activeCount: summary.activeCount,
    latestImportRunId: summary.latestImportRunId,
    latestUpdatedAt: summary.latestUpdatedAt,
    typeSlug: options.typeSlug ?? null
  };
};

export const findAdminByEmail = async (db: DbClient, email: string) => {
  const rows = await db.select().from(admins).where(eq(admins.email, email)).limit(1);
  return rows[0] ?? null;
};
