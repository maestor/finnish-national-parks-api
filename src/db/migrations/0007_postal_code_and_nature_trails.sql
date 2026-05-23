ALTER TABLE parks ADD COLUMN postal_code TEXT;

INSERT OR REPLACE INTO park_types (id, code, name, slug) VALUES
  (103, 103, 'Ulkoilu-/virkistysalue', 'outdoor-recreation-area'),
  (4404, 4404, 'Luontopolku', 'nature-trail');
