CREATE TABLE IF NOT EXISTS trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS trips_name_idx ON trips (name);

ALTER TABLE park_visits ADD COLUMN trip_id INTEGER REFERENCES trips(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS park_visits_trip_id_idx ON park_visits (trip_id);
