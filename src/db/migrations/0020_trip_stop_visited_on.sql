ALTER TABLE trip_stops ADD COLUMN visited_on TEXT;

UPDATE trip_stops
SET visited_on = COALESCE(
  (
    SELECT park_visits.visited_on
    FROM park_visits
    WHERE park_visits.trip_id = trip_stops.trip_id
      AND park_visits.trip_stop_order <= trip_stops.trip_stop_order
    ORDER BY park_visits.trip_stop_order DESC, park_visits.id DESC
    LIMIT 1
  ),
  (
    SELECT park_visits.visited_on
    FROM park_visits
    WHERE park_visits.trip_id = trip_stops.trip_id
      AND park_visits.trip_stop_order > trip_stops.trip_stop_order
    ORDER BY park_visits.trip_stop_order ASC, park_visits.id ASC
    LIMIT 1
  ),
  substr(created_at, 1, 10)
);

CREATE TABLE trip_stops__new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  trip_stop_order INTEGER NOT NULL,
  visited_on TEXT NOT NULL,
  label TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO trip_stops__new (
  id,
  trip_id,
  trip_stop_order,
  visited_on,
  label,
  lat,
  lon,
  note,
  created_at,
  updated_at
)
SELECT
  id,
  trip_id,
  trip_stop_order,
  visited_on,
  label,
  lat,
  lon,
  note,
  created_at,
  updated_at
FROM trip_stops;

DROP TABLE trip_stops;
ALTER TABLE trip_stops__new RENAME TO trip_stops;

CREATE INDEX IF NOT EXISTS trip_stops_trip_id_idx ON trip_stops (trip_id);
CREATE INDEX IF NOT EXISTS trip_stops_trip_stop_order_idx
ON trip_stops (trip_id, trip_stop_order);
