CREATE TABLE trail_merge_groups (
  trail_id INTEGER PRIMARY KEY REFERENCES parks(id),
  measured_length_km REAL NOT NULL CHECK (measured_length_km > 0),
  created_at TEXT NOT NULL
);
CREATE TABLE trail_merge_members (
  trail_id INTEGER PRIMARY KEY REFERENCES parks(id),
  canonical_trail_id INTEGER NOT NULL REFERENCES trail_merge_groups(trail_id),
  source_geometry TEXT NOT NULL,
  source_length_km REAL,
  source_timestamp TEXT NOT NULL
);
CREATE INDEX trail_merge_members_canonical_idx ON trail_merge_members(canonical_trail_id);
CREATE TABLE trail_merge_events (
  from_trail_id INTEGER PRIMARY KEY REFERENCES parks(id),
  to_trail_id INTEGER NOT NULL REFERENCES trail_merge_groups(trail_id),
  from_slug TEXT NOT NULL,
  to_slug TEXT NOT NULL,
  requested_name TEXT,
  created_at TEXT NOT NULL
);

-- Absorbed catalog rows remain available as source provenance, never as choices.
CREATE TRIGGER trail_merge_members_protect_source BEFORE UPDATE ON parks
WHEN EXISTS (SELECT 1 FROM trail_merge_members m
  WHERE m.trail_id = OLD.id AND m.canonical_trail_id <> OLD.id)
AND (NEW.catalog_status <> 'inactive' OR NEW.removed <> 1)
BEGIN SELECT RAISE(ABORT, 'Merged source trails must remain inactive and hidden.'); END;
