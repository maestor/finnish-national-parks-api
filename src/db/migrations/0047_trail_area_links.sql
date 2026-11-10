ALTER TABLE parks ADD COLUMN trail_publication_role TEXT NOT NULL DEFAULT 'independent'
  CHECK (trail_publication_role IN ('independent', 'area_member'));

CREATE TABLE trail_area_links (
  trail_id INTEGER NOT NULL REFERENCES parks(id),
  area_id INTEGER NOT NULL REFERENCES parks(id),
  automatic_match INTEGER NOT NULL DEFAULT 0 CHECK (automatic_match IN (0, 1)),
  override TEXT CHECK (override IN ('include', 'exclude')),
  overlap_metres REAL CHECK (overlap_metres IS NULL OR overlap_metres >= 0),
  route_metres REAL CHECK (route_metres IS NULL OR route_metres > 0),
  overlap_ratio REAL CHECK (overlap_ratio IS NULL OR overlap_ratio BETWEEN 0 AND 1),
  calculation_method TEXT,
  geometry_fingerprint TEXT,
  geometry_quality TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (trail_id, area_id),
  CHECK (trail_id <> area_id)
);
CREATE INDEX trail_area_links_area_idx ON trail_area_links (area_id, trail_id);
