ALTER TABLE park_visits ADD COLUMN trip_stop_order INTEGER;

WITH ranked_trip_visits AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY trip_id
      ORDER BY visited_on ASC, created_at ASC, id ASC
    ) AS trip_stop_order
  FROM park_visits
  WHERE trip_id IS NOT NULL
)
UPDATE park_visits
SET trip_stop_order = (
  SELECT ranked_trip_visits.trip_stop_order
  FROM ranked_trip_visits
  WHERE ranked_trip_visits.id = park_visits.id
)
WHERE id IN (SELECT id FROM ranked_trip_visits);

CREATE INDEX IF NOT EXISTS park_visits_trip_stop_order_idx
ON park_visits (trip_id, trip_stop_order);
