import { and, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';

import type { SupportedParkTypeSlug } from '../parks/park-types.js';
import { supportedParkTypes } from '../parks/park-types.js';
import type { Database, DbClient } from './database.js';
import { importRuns, parkNotes, parks, parkTypes, parkVisits } from './schema.js';

type PutVisitInput = {
  note?: string | null | undefined;
  visitedOn: string;
};

type UpdateVisitInput = {
  note?: string | null | undefined;
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

const toVisit = (row: typeof parkVisits.$inferSelect) => {
  return {
    createdAt: row.createdAt,
    id: row.id,
    note: row.note,
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
  const rows = await database.query.parkVisits.findMany({
    orderBy: [desc(parkVisits.visitedOn), desc(parkVisits.id)],
    where: eq(parkVisits.parkId, parkId)
  });

  return rows.map(toVisit);
};

const getNoteForPark = async (database: Database, parkId: number) => {
  const row = await database.query.parkNotes.findFirst({
    where: eq(parkNotes.parkId, parkId)
  });

  if (!row) {
    return null;
  }

  return {
    note: row.note,
    updatedAt: row.updatedAt
  };
};

const getNotesForParkIds = async (database: Database, parkIds: number[]) => {
  if (parkIds.length === 0) {
    return [];
  }

  return database.query.parkNotes.findMany({
    where: inArray(parkNotes.parkId, parkIds)
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

const buildPersonalPark = async (database: Database, row: TypedParkRow) => {
  const [note, visits] = await Promise.all([
    getNoteForPark(database, row.park.id),
    getVisitsForPark(database, row.park.id)
  ]);

  return {
    ...toPark(row),
    note,
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

export const getPersonalParkBySlug = async (database: Database, slug: string) => {
  const row = await getTypedParkBySlug(database, slug);
  return row ? buildPersonalPark(database, row) : null;
};

export const listPersonalParks = async (database: Database) => {
  const rows = await listTypedParks(database);
  const parkIds = rows.map((row) => row.park.id);

  const [allNotes, allVisits] = await Promise.all([
    getNotesForParkIds(database, parkIds),
    getVisitsForParkIds(database, parkIds)
  ]);

  const notesByParkId = new Map(
    allNotes.map((row) => [row.parkId, { note: row.note, updatedAt: row.updatedAt }])
  );

  const visitsByParkId = new Map<number, (typeof parkVisits.$inferSelect)[]>();
  for (const visit of allVisits) {
    const list = visitsByParkId.get(visit.parkId) ?? [];
    list.push(visit);
    visitsByParkId.set(visit.parkId, list);
  }

  return rows.map((row) => {
    const note = notesByParkId.get(row.park.id) ?? null;
    const visits = (visitsByParkId.get(row.park.id) ?? []).map(toVisit);

    return {
      ...toPark(row),
      note,
      visitedSummary: {
        lastVisitedOn: visits[0]?.visitedOn ?? null,
        visitCount: visits.length,
        visited: visits.length > 0
      },
      visits
    };
  });
};

export const putParkNote = async (database: Database, slug: string, note: string) => {
  const park = await getParkRecordBySlug(database, slug);

  if (!park) {
    throw new Error(`Park not found for slug "${slug}".`);
  }

  const normalizedNote = note.trim();
  const timestamp = new Date().toISOString();

  if (normalizedNote.length === 0) {
    await database.delete(parkNotes).where(eq(parkNotes.parkId, park.id));
    return null;
  }

  await database
    .insert(parkNotes)
    .values({
      createdAt: timestamp,
      note: normalizedNote,
      parkId: park.id,
      updatedAt: timestamp
    })
    .onConflictDoUpdate({
      set: {
        note: normalizedNote,
        updatedAt: timestamp
      },
      target: parkNotes.parkId
    });

  return getNoteForPark(database, park.id);
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
        createdAt: timestamp,
        note: input.note?.trim() || null,
        parkId: park.id,
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
      note: input.note === undefined ? existingVisit.note : input.note?.trim() || null,
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
