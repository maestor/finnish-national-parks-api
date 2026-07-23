CREATE TABLE IF NOT EXISTS trip_stops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  trip_stop_order INTEGER NOT NULL,
  label TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS trip_stops_trip_id_idx ON trip_stops (trip_id);
CREATE INDEX IF NOT EXISTS trip_stops_trip_stop_order_idx
ON trip_stops (trip_id, trip_stop_order);
