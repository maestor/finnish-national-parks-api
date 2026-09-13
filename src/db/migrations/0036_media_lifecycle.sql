CREATE TABLE media_uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  parent_type TEXT NOT NULL,
  parent_id INTEGER NOT NULL,
  upload_key TEXT NOT NULL,
  full_key TEXT NOT NULL,
  thumb_key TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  settled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX media_uploads_upload_key_idx ON media_uploads (upload_key);
CREATE INDEX media_uploads_parent_idx ON media_uploads (parent_type, parent_id);
CREATE INDEX media_uploads_expiry_idx ON media_uploads (settled_at, expires_at);

CREATE TABLE media_cleanup_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  key TEXT NOT NULL,
  eligible_at TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX media_cleanup_tasks_key_idx ON media_cleanup_tasks (key);
CREATE INDEX media_cleanup_tasks_eligible_at_idx ON media_cleanup_tasks (eligible_at);
