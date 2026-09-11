CREATE TABLE trip_featured_images (
  trip_id INTEGER PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
  visit_image_id INTEGER REFERENCES visit_images(id) ON DELETE CASCADE,
  trip_stop_image_id INTEGER REFERENCES trip_stop_images(id) ON DELETE CASCADE,
  updated_at TEXT NOT NULL,
  CHECK (
    (visit_image_id IS NOT NULL AND trip_stop_image_id IS NULL)
    OR (visit_image_id IS NULL AND trip_stop_image_id IS NOT NULL)
  )
);
CREATE INDEX trip_featured_visit_image_idx ON trip_featured_images (visit_image_id);
CREATE INDEX trip_featured_trip_stop_image_idx ON trip_featured_images (trip_stop_image_id);
