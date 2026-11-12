CREATE TABLE visit_trails (
  visit_id INTEGER NOT NULL REFERENCES park_visits(id) ON DELETE CASCADE,
  trail_id INTEGER NOT NULL REFERENCES parks(id),
  PRIMARY KEY (visit_id, trail_id)
);
CREATE INDEX visit_trails_trail_idx ON visit_trails(trail_id, visit_id);

CREATE TRIGGER visit_trails_require_membership BEFORE INSERT ON visit_trails
WHEN NOT EXISTS (
  SELECT 1 FROM trail_area_links l JOIN park_visits v ON v.park_id = l.area_id
  WHERE v.id = NEW.visit_id AND l.trail_id = NEW.trail_id
    AND (l.override = 'include' OR (l.automatic_match = 1 AND l.override IS NULL))
)
BEGIN SELECT RAISE(ABORT, 'Visit trail must belong to the visit park.'); END;

CREATE TRIGGER visit_trails_immutable_identity BEFORE UPDATE ON visit_trails
BEGIN SELECT RAISE(ABORT, 'Replace visit trail assignments using delete and insert.'); END;

CREATE TRIGGER trail_area_links_protect_visited_delete BEFORE DELETE ON trail_area_links
WHEN EXISTS (
  SELECT 1 FROM visit_trails t JOIN park_visits v ON v.id = t.visit_id
  WHERE t.trail_id = OLD.trail_id AND v.park_id = OLD.area_id
)
BEGIN SELECT RAISE(ABORT, 'Trail is linked to visits; review visits before unlinking.'); END;

CREATE TRIGGER trail_area_links_protect_visited_update BEFORE UPDATE ON trail_area_links
WHEN (NEW.trail_id != OLD.trail_id OR NEW.area_id != OLD.area_id OR
  NOT (NEW.override IS 'include' OR (NEW.automatic_match = 1 AND NEW.override IS NULL)))
AND EXISTS (
  SELECT 1 FROM visit_trails t JOIN park_visits v ON v.id = t.visit_id
  WHERE t.trail_id = OLD.trail_id AND v.park_id = OLD.area_id
)
BEGIN SELECT RAISE(ABORT, 'Trail is linked to visits; review visits before unlinking.'); END;

CREATE TRIGGER park_visits_protect_trail_membership BEFORE UPDATE OF park_id ON park_visits
WHEN NEW.park_id != OLD.park_id AND EXISTS (
  SELECT 1 FROM visit_trails t WHERE t.visit_id = OLD.id AND NOT EXISTS (
    SELECT 1 FROM trail_area_links l WHERE l.area_id = NEW.park_id AND l.trail_id = t.trail_id
    AND (l.override = 'include' OR (l.automatic_match = 1 AND l.override IS NULL))
  )
)
BEGIN SELECT RAISE(ABORT, 'Remove visit trail assignments before moving to an unrelated park.'); END;
