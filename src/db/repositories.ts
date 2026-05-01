import { and, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';

import type { SupportedParkTypeSlug } from '../parks/park-types.js';
import { supportedParkTypes } from '../parks/park-types.js';
import type { Database } from './database.js';
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

function toBoundingBox(row: typeof parks.$inferSelect): BoundingBox {
  return {
    maxLat: row.bboxMaxLat,
    maxLon: row.bboxMaxLon,
    minLat: row.bboxMinLat,
    minLon: row.bboxMinLon
  };
}

function toMarkerPoint(row: typeof parks.$inferSelect): MarkerPoint {
  return {
    lat: row.markerLat,
    lon: row.markerLon
  };
}

function toParkType(row: typeof parkTypes.$inferSelect) {
  return {
    code: row.code,
    id: row.id,
    name: row.name,
    slug: row.slug as SupportedParkTypeSlug
  };
}

function toPark(row: TypedParkRow) {
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
}

function toVisit(row: typeof parkVisits.$inferSelect) {
  return {
    createdAt: row.createdAt,
    id: row.id,
    note: row.note,
    updatedAt: row.updatedAt,
    visitedOn: row.visitedOn
  };
}

async function getParkRecordBySlug(database: Database, slug: string) {
  return database.query.parks.findFirst({
    where: eq(parks.slug, slug)
  });
}

async function getTypedParkBySlug(database: Database, slug: string) {
  return (await database
    .select({
      park: parks,
      parkType: parkTypes
    })
    .from(parks)
    .innerJoin(parkTypes, eq(parks.typeId, parkTypes.id))
    .where(eq(parks.slug, slug)))[0] ?? null;
}

async function listTypedParks(database: Database, options: { typeSlug?: SupportedParkTypeSlug } = {}) {
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
}

async function getVisitsForPark(database: Database, parkId: number) {
  const rows = await database.query.parkVisits.findMany({
    orderBy: [desc(parkVisits.visitedOn), desc(parkVisits.id)],
    where: eq(parkVisits.parkId, parkId)
  });

  return rows.map(toVisit);
}

async function getNoteForPark(database: Database, parkId: number) {
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
}

async function buildPersonalPark(database: Database, row: TypedParkRow) {
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
}

export async function syncParkTypes(database: Database) {
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
}

export async function createImportRun(
  database: Database,
  values: typeof importRuns.$inferInsert
) {
  const row = (await database.insert(importRuns).values(values).returning({
    id: importRuns.id
  }))[0]!;

  return row.id;
}

export async function listExistingParksByLipasIds(database: Database, lipasIds: number[]) {
  if (lipasIds.length === 0) {
    return [];
  }

  return database.query.parks.findMany({
    where: inArray(parks.lipasId, lipasIds)
  });
}

export async function listParks(
  database: Database,
  options: { typeSlug?: SupportedParkTypeSlug } = {}
) {
  return (await listTypedParks(database, options)).map(toPark);
}

export async function getParkBySlug(database: Database, slug: string) {
  const row = await getTypedParkBySlug(database, slug);
  return row ? toPark(row) : null;
}

export async function getPersonalParkBySlug(database: Database, slug: string) {
  const row = await getTypedParkBySlug(database, slug);
  return row ? buildPersonalPark(database, row) : null;
}

export async function listPersonalParks(database: Database) {
  return Promise.all((await listTypedParks(database)).map((row) => buildPersonalPark(database, row)));
}

export async function putParkNote(database: Database, slug: string, note: string) {
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
}

export async function createVisit(database: Database, slug: string, input: PutVisitInput) {
  const park = await getParkRecordBySlug(database, slug);

  if (!park) {
    throw new Error(`Park not found for slug "${slug}".`);
  }

  const timestamp = new Date().toISOString();
  const row = (await database
    .insert(parkVisits)
    .values({
      createdAt: timestamp,
      note: input.note?.trim() || null,
      parkId: park.id,
      updatedAt: timestamp,
      visitedOn: input.visitedOn
    })
    .returning())[0]!;

  return toVisit(row);
}

export async function updateVisit(database: Database, visitId: number, input: UpdateVisitInput) {
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

  const updatedVisit = (await database
    .select()
    .from(parkVisits)
    .where(eq(parkVisits.id, visitId)))[0]!;

  return toVisit(updatedVisit);
}

export async function deleteVisit(database: Database, visitId: number) {
  const result = await database.delete(parkVisits).where(eq(parkVisits.id, visitId));
  return Number(result.rowsAffected) > 0;
}

export async function upsertImportedPark(
  database: Database,
  values: Omit<typeof parks.$inferInsert, 'id'>
) {
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
}

export async function markMissingParksInactive(
  database: Database,
  activeLipasIds: number[],
  lastImportRunId: number,
  updatedAt: string
) {
  if (activeLipasIds.length === 0) {
    await database
      .update(parks)
      .set({
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
    .where(
      and(
        eq(parks.catalogStatus, 'active'),
        notInArray(parks.lipasId, activeLipasIds)
      )
    );
}

export async function getCatalogListEtagSeed(
  database: Database,
  options: { typeSlug?: SupportedParkTypeSlug } = {}
) {
  const whereClause = options.typeSlug
    ? and(eq(parks.catalogStatus, 'active'), eq(parkTypes.slug, options.typeSlug))
    : eq(parks.catalogStatus, 'active');
  const summary = (await database
    .select({
      activeCount: sql<number>`COUNT(*)`,
      latestImportRunId: sql<number | null>`MAX(${parks.lastImportRunId})`,
      latestUpdatedAt: sql<string | null>`MAX(${parks.updatedAt})`
    })
    .from(parks)
    .innerJoin(parkTypes, eq(parks.typeId, parkTypes.id))
    .where(whereClause))[0]!;

  return {
    activeCount: summary.activeCount,
    latestImportRunId: summary.latestImportRunId,
    latestUpdatedAt: summary.latestUpdatedAt,
    typeSlug: options.typeSlug ?? null
  };
}
