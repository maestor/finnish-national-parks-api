ALTER TABLE parks ADD COLUMN area_link_only INTEGER NOT NULL DEFAULT 0 CHECK (area_link_only IN (0, 1));
