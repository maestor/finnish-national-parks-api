ALTER TABLE trips ADD COLUMN summary TEXT;
ALTER TABLE trips ADD COLUMN published_at TEXT;
ALTER TABLE trips ADD COLUMN featured_at TEXT;

UPDATE trips
SET published_at = updated_at
WHERE published_at IS NULL;

CREATE INDEX IF NOT EXISTS trips_published_at_idx ON trips (published_at);
CREATE INDEX IF NOT EXISTS trips_featured_at_idx ON trips (featured_at);

CREATE TABLE IF NOT EXISTS trip_cover_images (
  trip_id INTEGER PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
  visit_image_id INTEGER REFERENCES visit_images(id) ON DELETE CASCADE,
  trip_stop_image_id INTEGER REFERENCES trip_stop_images(id) ON DELETE CASCADE,
  updated_at TEXT NOT NULL,
  CHECK (
    (visit_image_id IS NOT NULL AND trip_stop_image_id IS NULL)
    OR
    (visit_image_id IS NULL AND trip_stop_image_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS trip_cover_visit_image_idx
  ON trip_cover_images (visit_image_id);
CREATE INDEX IF NOT EXISTS trip_cover_trip_stop_image_idx
  ON trip_cover_images (trip_stop_image_id);
