CREATE TABLE osm_trail_sources (
  trail_id INTEGER PRIMARY KEY REFERENCES parks(id),
  relation_id INTEGER NOT NULL UNIQUE,
  source_timestamp TEXT NOT NULL
);
