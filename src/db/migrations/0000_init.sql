CREATE TABLE IF NOT EXISTS import_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_url TEXT NOT NULL,
  active_count INTEGER NOT NULL,
  imported_at TEXT NOT NULL,
  response_shape_version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS parks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lipas_id INTEGER NOT NULL,
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
  FOREIGN KEY (last_import_run_id) REFERENCES import_runs(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS parks_lipas_id_idx ON parks (lipas_id);
CREATE UNIQUE INDEX IF NOT EXISTS parks_slug_idx ON parks (slug);
CREATE INDEX IF NOT EXISTS parks_catalog_status_idx ON parks (catalog_status);

CREATE TABLE IF NOT EXISTS park_notes (
  park_id INTEGER PRIMARY KEY,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (park_id) REFERENCES parks(id)
);

CREATE TABLE IF NOT EXISTS park_visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  park_id INTEGER NOT NULL,
  visited_on TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (park_id) REFERENCES parks(id)
);

CREATE INDEX IF NOT EXISTS park_visits_park_id_idx ON park_visits (park_id);
CREATE INDEX IF NOT EXISTS park_visits_visited_on_idx ON park_visits (visited_on);
