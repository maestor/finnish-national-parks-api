CREATE TABLE trip_route_waypoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  trip_stop_order INTEGER NOT NULL,
  label TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX trip_route_waypoints_trip_id_idx ON trip_route_waypoints (trip_id);
CREATE INDEX trip_route_waypoints_trip_stop_order_idx
ON trip_route_waypoints (trip_id, trip_stop_order);
