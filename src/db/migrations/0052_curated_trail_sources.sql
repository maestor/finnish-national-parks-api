CREATE TABLE curated_trail_sources (
  selection_key TEXT PRIMARY KEY NOT NULL,
  trail_id INTEGER NOT NULL UNIQUE REFERENCES parks(id),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('osm-relation', 'osm-way-selection')),
  manifest_hash TEXT NOT NULL,
  geometry_hash TEXT NOT NULL,
  source_timestamp TEXT NOT NULL,
  source_urls_json TEXT NOT NULL,
  provenance_json TEXT NOT NULL
);
