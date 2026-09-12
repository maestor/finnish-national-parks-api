ALTER TABLE visit_images ADD COLUMN upload_key TEXT;
UPDATE visit_images SET upload_key = full_key WHERE upload_key IS NULL;
CREATE UNIQUE INDEX visit_images_visit_upload_key_idx
ON visit_images (visit_id, upload_key);

ALTER TABLE trip_stop_images ADD COLUMN upload_key TEXT;
UPDATE trip_stop_images SET upload_key = full_key WHERE upload_key IS NULL;
CREATE UNIQUE INDEX trip_stop_images_trip_stop_upload_key_idx
ON trip_stop_images (trip_stop_id, upload_key);
