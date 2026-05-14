import { and, asc, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';

import type { SupportedParkTypeSlug } from '../parks/park-types.js';
import { supportedParkTypes } from '../parks/park-types.js';
import type { Database, DbClient } from './database.js';
import { admins, importRuns, parks, parkTypes, parkVisits, visitImages } from './schema.js';

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

const toPark = (row: TypedParkRow) => {
  return {
    areaKm2: row.park.areaKm2,
    boundingBox: toBoundingBox(row.park),
    boundaryGeoJson: JSON.parse(row.park.boundaryGeojson) as Record<string, unknown>,
    catalogStatus: row.park.catalogStatus as 'active' | 'inactive',
    establishmentYear: row.park.establishmentYear,
    lipasId: row.park.lipasId,
    locationLabel: row.park.locationLabel,
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

const toVisitImage = (
  row: typeof visitImages.$inferSelect,
  getPublicUrl: (key: string) => string
): VisitImage => ({
  id: row.id,
  fullUrl: getPublicUrl(row.fullKey),
  thumbUrl: getPublicUrl(row.thumbKey),
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
        .where(eq(parks.slug, slug))
    )[0] ?? null
  );
};

const listTypedParks = async (
  database: Database,
  options: { typeSlug?: SupportedParkTypeSlug } = {}
) => {
  const whereClause = options.typeSlug
    ? and(eq(parks.catalogStatus, 'active'), eq(parkTypes.slug, options.typeSlug))
    : eq(parks.catalogStatus, 'active');

  return database
    .select({
      park: parks,
      parkType: parkTypes
    })
    .from(parks)
    .innerJoin(parkTypes, eq(parks.typeId, parkTypes.id))
    .where(whereClause)
    .orderBy(parks.name);
};

const getVisitsForPark = async (database: Database, parkId: number) => {
  return database.query.parkVisits.findMany({
    orderBy: [desc(parkVisits.visitedOn), desc(parkVisits.id)],
    where: eq(parkVisits.parkId, parkId)
  });
};

const getVisitsForParkIds = async (database: Database, parkIds: number[]) => {
  if (parkIds.length === 0) {
    return [];
  }

  return database.query.parkVisits.findMany({
    orderBy: [desc(parkVisits.visitedOn), desc(parkVisits.id)],
    where: inArray(parkVisits.parkId, parkIds)
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

const buildPersonalPark = async (
  database: Database,
  row: TypedParkRow,
  getImagePublicUrl: (key: string) => string
) => {
  const visitRows = await getVisitsForPark(database, row.park.id);
  const visitIds = visitRows.map((v) => v.id);
  const imageRows = await getImagesForVisitIds(database, visitIds);

  const imagesByVisitId = new Map<number, (typeof visitImages.$inferSelect)[]>();
  for (const img of imageRows) {
    const list = imagesByVisitId.get(img.visitId) ?? [];
    list.push(img);
    imagesByVisitId.set(img.visitId, list);
  }

  const visits = visitRows.map((v) => {
    const imgs = (imagesByVisitId.get(v.id) ?? []).map((img) =>
      toVisitImage(img, getImagePublicUrl)
    );
    return toVisit(v, imgs);
  });

  return {
    ...toPark(row),
    visitedSummary: {
      lastVisitedOn: visits[0]?.visitedOn ?? null,
      visitCount: visits.length,
      visited: visits.length > 0
    },
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

export const getParkBySlug = async (database: Database, slug: string) => {
  const row = await getTypedParkBySlug(database, slug);
  return row ? toPark(row) : null;
};

export const getPersonalParkBySlug = async (
  database: Database,
  slug: string,
  getImagePublicUrl: (key: string) => string
) => {
  const row = await getTypedParkBySlug(database, slug);
  return row ? buildPersonalPark(database, row, getImagePublicUrl) : null;
};

export const listPersonalParks = async (
  database: Database,
  getImagePublicUrl: (key: string) => string
) => {
  const rows = await listTypedParks(database);
  const parkIds = rows.map((row) => row.park.id);

  const allVisits = await getVisitsForParkIds(database, parkIds);
  const visitIds = allVisits.map((v) => v.id);
  const allImages = await getImagesForVisitIds(database, visitIds);

  const visitsByParkId = new Map<number, (typeof parkVisits.$inferSelect)[]>();
  for (const visit of allVisits) {
    const list = visitsByParkId.get(visit.parkId) ?? [];
    list.push(visit);
    visitsByParkId.set(visit.parkId, list);
  }

  const imagesByVisitId = new Map<number, (typeof visitImages.$inferSelect)[]>();
  for (const img of allImages) {
    const list = imagesByVisitId.get(img.visitId) ?? [];
    list.push(img);
    imagesByVisitId.set(img.visitId, list);
  }

  return rows.map((row) => {
    const visits = (visitsByParkId.get(row.park.id) ?? []).map((v) => {
      const imgs = (imagesByVisitId.get(v.id) ?? []).map((img) =>
        toVisitImage(img, getImagePublicUrl)
      );
      return toVisit(v, imgs);
    });

    return {
      ...toPark(row),
      visitedSummary: {
        lastVisitedOn: visits[0]?.visitedOn ?? null,
        visitCount: visits.length,
        visited: visits.length > 0
      },
      visits
    };
  });
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

  return toVisit(row);
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

  return toVisit(updatedVisit);
};

export const deleteVisit = async (database: Database, visitId: number) => {
  const result = await database.delete(parkVisits).where(eq(parkVisits.id, visitId));
  return Number(result.rowsAffected) > 0;
};

export const createVisitImage = async (
  database: Database,
  values: typeof visitImages.$inferInsert
) => {
  const row = (await database.insert(visitImages).values(values).returning())[0]!;
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
  const whereClause = options.typeSlug
    ? and(eq(parks.catalogStatus, 'active'), eq(parkTypes.slug, options.typeSlug))
    : eq(parks.catalogStatus, 'active');
  const summary = (
    await database
      .select({
        activeCount: sql<number>`COUNT(*)`,
        latestImportRunId: sql<number | null>`MAX(${parks.lastImportRunId})`,
        latestUpdatedAt: sql<string | null>`MAX(${parks.updatedAt})`
      })
      .from(parks)
      .innerJoin(parkTypes, eq(parks.typeId, parkTypes.id))
      .where(whereClause)
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
