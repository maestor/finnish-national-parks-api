CREATE TABLE IF NOT EXISTS public_data_versions (
  key TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
