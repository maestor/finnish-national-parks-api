CREATE TABLE IF NOT EXISTS trip_stop_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_stop_id INTEGER NOT NULL REFERENCES trip_stops(id) ON DELETE CASCADE,
  full_key TEXT NOT NULL,
  thumb_key TEXT NOT NULL,
  original_name TEXT,
  mime_type TEXT NOT NULL,
  full_width INTEGER,
  full_height INTEGER,
  thumb_width INTEGER,
  thumb_height INTEGER,
  file_size_bytes INTEGER,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS trip_stop_images_trip_stop_id_idx
ON trip_stop_images (trip_stop_id);

CREATE INDEX IF NOT EXISTS trip_stop_images_order_idx
ON trip_stop_images (trip_stop_id, display_order);
