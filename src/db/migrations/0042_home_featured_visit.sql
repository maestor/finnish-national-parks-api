CREATE TABLE home_featured_visit (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  visit_id INTEGER REFERENCES park_visits(id) ON DELETE SET NULL
);
