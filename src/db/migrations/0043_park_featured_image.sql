CREATE TABLE park_featured_images (
  park_id INTEGER PRIMARY KEY REFERENCES parks(id) ON DELETE CASCADE,
  visit_image_id INTEGER NOT NULL REFERENCES visit_images(id) ON DELETE CASCADE
);
CREATE INDEX park_featured_visit_image_idx ON park_featured_images(visit_image_id);
