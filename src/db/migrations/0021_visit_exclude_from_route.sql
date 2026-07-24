ALTER TABLE park_visits
ADD COLUMN exclude_from_route INTEGER NOT NULL DEFAULT 0;
