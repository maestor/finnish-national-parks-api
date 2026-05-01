import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import type { Database } from './database.js';
import { importRuns, parkNotes, parks, parkVisits } from './schema.js';

type PutVisitInput = {
  note?: string | null;
  visitedOn: string;
};

type UpdateVisitInput = {
  note?: string | null;
  visitedOn?: string;
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

function toPark(row: typeof parks.$inferSelect) {
  return {
    areaKm2: row.areaKm2,
    boundingBox: toBoundingBox(row),
    boundaryGeoJson: JSON.parse(row.boundaryGeojson) as Record<string, unknown>,
    catalogStatus: row.catalogStatus,
    establishmentYear: row.establishmentYear,
    lipasId: row.lipasId,
    locationLabel: row.locationLabel,
    luontoonUrl: row.luontoonUrl,
    markerPoint: toMarkerPoint(row),
    municipalityCode: row.municipalityCode,
    name: row.name,
    postalOffice: row.postalOffice,
    slug: row.slug,
    sourceEventDate: row.sourceEventDate,
    updatedAt: row.updatedAt
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

async function buildPersonalPark(database: Database, row: typeof parks.$inferSelect) {
  const [note, visits] = await Promise.all([
    getNoteForPark(database, row.id),
    getVisitsForPark(database, row.id)
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

export async function createImportRun(
  database: Database,
  values: typeof importRuns.$inferInsert
) {
  const [row] = await database.insert(importRuns).values(values).returning({
    id: importRuns.id
  });

  if (!row) {
    throw new Error('Failed to create import run.');
  }

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

export async function listParks(database: Database) {
  const rows = await database.query.parks.findMany({
    orderBy: [parks.name],
    where: eq(parks.catalogStatus, 'active')
  });

  return rows.map(toPark);
}

export async function listAllParks(database: Database) {
  const rows = await database.query.parks.findMany({
    orderBy: [parks.name]
  });

  return rows.map(toPark);
}

export async function getParkBySlug(database: Database, slug: string) {
  const row = await getParkRecordBySlug(database, slug);
  return row ? toPark(row) : null;
}

export async function getPersonalParkBySlug(database: Database, slug: string) {
  const row = await getParkRecordBySlug(database, slug);
  return row ? buildPersonalPark(database, row) : null;
}

export async function listPersonalParks(database: Database) {
  const rows = await database.query.parks.findMany({
    orderBy: [parks.name],
    where: eq(parks.catalogStatus, 'active')
  });

  return Promise.all(rows.map((row) => buildPersonalPark(database, row)));
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
  const [row] = await database
    .insert(parkVisits)
    .values({
      createdAt: timestamp,
      note: input.note?.trim() || null,
      parkId: park.id,
      updatedAt: timestamp,
      visitedOn: input.visitedOn
    })
    .returning();

  if (!row) {
    throw new Error('Failed to create visit.');
  }

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

  const [updatedVisit] = await database
    .select()
    .from(parkVisits)
    .where(eq(parkVisits.id, visitId));

  return updatedVisit ? toVisit(updatedVisit) : null;
}

export async function deleteVisit(database: Database, visitId: number) {
  const result = await database.delete(parkVisits).where(eq(parkVisits.id, visitId));
  return Number(result.rowsAffected ?? 0) > 0;
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
        sql`${parks.lipasId} NOT IN ${activeLipasIds}`
      )
    );
}

export async function getCatalogListEtagSeed(database: Database) {
  const [summary] = await database
    .select({
      activeCount: sql<number>`COUNT(*)`,
      latestImportRunId: sql<number | null>`MAX(${parks.lastImportRunId})`,
      latestUpdatedAt: sql<string | null>`MAX(${parks.updatedAt})`
    })
    .from(parks)
    .where(eq(parks.catalogStatus, 'active'));

  return {
    activeCount: summary?.activeCount ?? 0,
    latestImportRunId: summary?.latestImportRunId ?? null,
    latestUpdatedAt: summary?.latestUpdatedAt ?? null
  };
}

export async function getLatestImportRun(database: Database) {
  return database.query.importRuns.findFirst({
    orderBy: [desc(importRuns.id)]
  });
}
