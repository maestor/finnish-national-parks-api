CREATE TABLE trip_routes_with_fingerprints (
  trip_id INTEGER NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  route_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (trip_id, fingerprint)
);

INSERT INTO trip_routes_with_fingerprints (trip_id, fingerprint, route_json, updated_at)
SELECT trip_id, fingerprint, route_json, updated_at
FROM trip_routes;

DROP TABLE trip_routes;

ALTER TABLE trip_routes_with_fingerprints RENAME TO trip_routes;
