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
    managedByLipasImport: integer('managed_by_lipas_import', { mode: 'boolean' })
      .notNull()
      .default(true),
    typeId: integer('type_id')
      .notNull()
      .references(() => parkTypes.id),
    slug: text('slug').notNull(),
    importedSlug: text('imported_slug'),
    name: text('name').notNull(),
    importedName: text('imported_name'),
    displayTypeName: text('display_type_name'),
    importedDisplayTypeName: text('imported_display_type_name'),
    areaKm2: real('area_km2'),
    importedAreaKm2: real('imported_area_km2'),
    establishmentYear: integer('establishment_year'),
    importedEstablishmentYear: integer('imported_establishment_year'),
    locationLabel: text('location_label').notNull(),
    importedLocationLabel: text('imported_location_label'),
    postalCode: text('postal_code'),
    importedPostalCode: text('imported_postal_code'),
    postalOffice: text('postal_office'),
    importedPostalOffice: text('imported_postal_office'),
    logoKey: text('logo_key'),
    logoUpdatedAt: text('logo_updated_at'),
    mapKey: text('map_key'),
    mapUpdatedAt: text('map_updated_at'),
    municipalityCode: integer('municipality_code'),
    parkUrl: text('park_url'),
    importedParkUrl: text('imported_park_url'),
    sourceEventDate: text('source_event_date'),
    boundaryGeojson: text('boundary_geojson').notNull(),
    bboxMinLon: real('bbox_min_lon').notNull(),
    bboxMinLat: real('bbox_min_lat').notNull(),
    bboxMaxLon: real('bbox_max_lon').notNull(),
    bboxMaxLat: real('bbox_max_lat').notNull(),
    markerLon: real('marker_lon').notNull(),
    markerLat: real('marker_lat').notNull(),
    catalogStatus: text('catalog_status').notNull(),
    removed: integer('removed', { mode: 'boolean' }).notNull().default(false),
    lastImportRunId: integer('last_import_run_id')
      .notNull()
      .references(() => importRuns.id),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (table) => ({
    lipasIdIndex: uniqueIndex('parks_lipas_id_idx').on(table.lipasId),
    managedByLipasImportIndex: index('parks_managed_by_lipas_import_idx').on(
      table.managedByLipasImport
    ),
    slugIndex: uniqueIndex('parks_slug_idx').on(table.slug),
    typeIndex: index('parks_type_id_idx').on(table.typeId),
    statusIndex: index('parks_catalog_status_idx').on(table.catalogStatus),
    removedIndex: index('parks_removed_idx').on(table.removed)
  })
);

export const trips = sqliteTable(
  'trips',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    startingPointLabel: text('starting_point_label'),
    startingPointLat: real('starting_point_lat'),
    startingPointLon: real('starting_point_lon'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (table) => ({
    nameIndex: index('trips_name_idx').on(table.name),
    slugIndex: uniqueIndex('trips_slug_idx').on(table.slug)
  })
);

export const parkVisits = sqliteTable(
  'park_visits',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    parkId: integer('park_id')
      .notNull()
      .references(() => parks.id),
    tripId: integer('trip_id').references(() => trips.id, { onDelete: 'set null' }),
    tripStopOrder: integer('trip_stop_order'),
    visitedOn: text('visited_on').notNull(),
    note: text('note'),
    route: text('route'),
    author: text('author'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (table) => ({
    parkIdIndex: index('park_visits_park_id_idx').on(table.parkId),
    tripIdIndex: index('park_visits_trip_id_idx').on(table.tripId),
    tripStopOrderIndex: index('park_visits_trip_stop_order_idx').on(
      table.tripId,
      table.tripStopOrder
    ),
    visitedOnIndex: index('park_visits_visited_on_idx').on(table.visitedOn)
  })
);

export const visitImages = sqliteTable(
  'visit_images',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    visitId: integer('visit_id')
      .notNull()
      .references(() => parkVisits.id, { onDelete: 'cascade' }),
    fullKey: text('full_key').notNull(),
    thumbKey: text('thumb_key').notNull(),
    originalName: text('original_name'),
    mimeType: text('mime_type').notNull(),
    fullWidth: integer('full_width'),
    fullHeight: integer('full_height'),
    thumbWidth: integer('thumb_width'),
    thumbHeight: integer('thumb_height'),
    fileSizeBytes: integer('file_size_bytes'),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (table) => ({
    visitIdIndex: index('visit_images_visit_id_idx').on(table.visitId),
    orderIndex: index('visit_images_order_idx').on(table.visitId, table.displayOrder)
  })
);

export const publicDataVersions = sqliteTable('public_data_versions', {
  key: text('key').primaryKey(),
  version: integer('version').notNull(),
  updatedAt: text('updated_at').notNull()
});

export const admins = sqliteTable(
  'admins',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    email: text('email').notNull().unique(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (table) => ({
    emailIndex: uniqueIndex('admins_email_idx').on(table.email)
  })
);
