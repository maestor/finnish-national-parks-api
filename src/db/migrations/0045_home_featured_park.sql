CREATE TABLE home_featured_park (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  park_id INTEGER REFERENCES parks(id) ON DELETE SET NULL
);
