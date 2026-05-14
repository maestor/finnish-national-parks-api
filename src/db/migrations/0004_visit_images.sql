CREATE TABLE visit_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_id INTEGER NOT NULL REFERENCES park_visits(id) ON DELETE CASCADE,
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

CREATE INDEX visit_images_visit_id_idx ON visit_images(visit_id);
CREATE INDEX visit_images_order_idx ON visit_images(visit_id, display_order);
