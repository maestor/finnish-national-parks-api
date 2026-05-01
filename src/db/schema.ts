import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const importRuns = sqliteTable('import_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourceUrl: text('source_url').notNull(),
  activeCount: integer('active_count').notNull(),
  importedAt: text('imported_at').notNull(),
  responseShapeVersion: text('response_shape_version').notNull()
});

export const parkTypes = sqliteTable(
  'park_types',
  {
    id: integer('id').primaryKey(),
    code: integer('code').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull()
  },
  (table) => ({
    codeIndex: uniqueIndex('park_types_code_idx').on(table.code),
    slugIndex: uniqueIndex('park_types_slug_idx').on(table.slug)
  })
);

export const parks = sqliteTable(
  'parks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    lipasId: integer('lipas_id').notNull(),
    typeId: integer('type_id')
      .notNull()
      .references(() => parkTypes.id),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    areaKm2: real('area_km2'),
    establishmentYear: integer('establishment_year'),
    locationLabel: text('location_label').notNull(),
    postalOffice: text('postal_office'),
    municipalityCode: integer('municipality_code'),
    luontoonUrl: text('luontoon_url'),
    sourceEventDate: text('source_event_date'),
    boundaryGeojson: text('boundary_geojson').notNull(),
    bboxMinLon: real('bbox_min_lon').notNull(),
    bboxMinLat: real('bbox_min_lat').notNull(),
    bboxMaxLon: real('bbox_max_lon').notNull(),
    bboxMaxLat: real('bbox_max_lat').notNull(),
    markerLon: real('marker_lon').notNull(),
    markerLat: real('marker_lat').notNull(),
    catalogStatus: text('catalog_status').notNull(),
    lastImportRunId: integer('last_import_run_id')
      .notNull()
      .references(() => importRuns.id),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (table) => ({
    lipasIdIndex: uniqueIndex('parks_lipas_id_idx').on(table.lipasId),
    slugIndex: uniqueIndex('parks_slug_idx').on(table.slug),
    typeIndex: index('parks_type_id_idx').on(table.typeId),
    statusIndex: index('parks_catalog_status_idx').on(table.catalogStatus)
  })
);

export const parkNotes = sqliteTable('park_notes', {
  parkId: integer('park_id')
    .primaryKey()
    .references(() => parks.id),
  note: text('note').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
});

export const parkVisits = sqliteTable(
  'park_visits',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    parkId: integer('park_id')
      .notNull()
      .references(() => parks.id),
    visitedOn: text('visited_on').notNull(),
    note: text('note'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (table) => ({
    parkIdIndex: index('park_visits_park_id_idx').on(table.parkId),
    visitedOnIndex: index('park_visits_visited_on_idx').on(table.visitedOn)
  })
);
