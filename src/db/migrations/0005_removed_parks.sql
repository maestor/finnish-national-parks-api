ALTER TABLE parks ADD COLUMN removed INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS parks_removed_idx ON parks(removed);
