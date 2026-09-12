CREATE UNIQUE INDEX IF NOT EXISTS visit_images_visit_full_key_idx
ON visit_images (visit_id, full_key);

CREATE UNIQUE INDEX IF NOT EXISTS trip_stop_images_trip_stop_full_key_idx
ON trip_stop_images (trip_stop_id, full_key);
