ALTER TABLE parks ADD COLUMN managed_by_lipas_import INTEGER NOT NULL DEFAULT 1;
ALTER TABLE parks ADD COLUMN display_type_name TEXT;

CREATE INDEX IF NOT EXISTS parks_managed_by_lipas_import_idx
  ON parks(managed_by_lipas_import);
