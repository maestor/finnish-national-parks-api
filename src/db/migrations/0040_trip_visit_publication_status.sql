ALTER TABLE trips ADD COLUMN status TEXT NOT NULL DEFAULT 'draft'
  CHECK (status IN ('draft', 'published'));
ALTER TABLE park_visits ADD COLUMN status TEXT NOT NULL DEFAULT 'draft'
  CHECK (status IN ('draft', 'published'));

UPDATE trips SET status = 'published';
UPDATE park_visits SET status = 'published';

CREATE INDEX trips_status_idx ON trips (status);
CREATE INDEX park_visits_status_idx ON park_visits (status);
