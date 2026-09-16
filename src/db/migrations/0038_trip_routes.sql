CREATE TABLE trip_routes (
  trip_id INTEGER PRIMARY KEY NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  route_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
