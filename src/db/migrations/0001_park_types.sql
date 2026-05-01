PRAGMA foreign_keys=OFF;

CREATE TABLE IF NOT EXISTS park_types (
  id INTEGER PRIMARY KEY,
  code INTEGER NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS park_types_code_idx ON park_types (code);
CREATE UNIQUE INDEX IF NOT EXISTS park_types_slug_idx ON park_types (slug);

INSERT OR REPLACE INTO park_types (id, code, name, slug) VALUES
  (109, 109, 'Valtion retkeilyalue', 'state-hiking-area'),
  (110, 110, 'Erämaa-alue', 'wilderness-area'),
  (111, 111, 'Kansallispuisto', 'national-park'),
  (112, 112, 'Muu luonnonsuojelualue', 'other-nature-reserve');

CREATE TABLE IF NOT EXISTS parks_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lipas_id INTEGER NOT NULL,
  type_id INTEGER NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  area_km2 REAL,
  establishment_year INTEGER,
  location_label TEXT NOT NULL,
  postal_office TEXT,
  municipality_code INTEGER,
  luontoon_url TEXT,
  source_event_date TEXT,
  boundary_geojson TEXT NOT NULL,
  bbox_min_lon REAL NOT NULL,
  bbox_min_lat REAL NOT NULL,
  bbox_max_lon REAL NOT NULL,
  bbox_max_lat REAL NOT NULL,
  marker_lon REAL NOT NULL,
  marker_lat REAL NOT NULL,
  catalog_status TEXT NOT NULL,
  last_import_run_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (type_id) REFERENCES park_types(id),
  FOREIGN KEY (last_import_run_id) REFERENCES import_runs(id)
);

INSERT INTO parks_new (
  id,
  lipas_id,
  type_id,
  slug,
  name,
  area_km2,
  establishment_year,
  location_label,
  postal_office,
  municipality_code,
  luontoon_url,
  source_event_date,
  boundary_geojson,
  bbox_min_lon,
  bbox_min_lat,
  bbox_max_lon,
  bbox_max_lat,
  marker_lon,
  marker_lat,
  catalog_status,
  last_import_run_id,
  created_at,
  updated_at
)
SELECT
  id,
  lipas_id,
  111,
  slug,
  name,
  area_km2,
  establishment_year,
  location_label,
  postal_office,
  municipality_code,
  luontoon_url,
  source_event_date,
  boundary_geojson,
  bbox_min_lon,
  bbox_min_lat,
  bbox_max_lon,
  bbox_max_lat,
  marker_lon,
  marker_lat,
  catalog_status,
  last_import_run_id,
  created_at,
  updated_at
FROM parks;

DROP TABLE parks;
ALTER TABLE parks_new RENAME TO parks;

CREATE UNIQUE INDEX IF NOT EXISTS parks_lipas_id_idx ON parks (lipas_id);
CREATE UNIQUE INDEX IF NOT EXISTS parks_slug_idx ON parks (slug);
CREATE INDEX IF NOT EXISTS parks_type_id_idx ON parks (type_id);
CREATE INDEX IF NOT EXISTS parks_catalog_status_idx ON parks (catalog_status);

PRAGMA foreign_keys=ON;
