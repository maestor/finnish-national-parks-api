CREATE TABLE admin_invitations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_by_admin_id INTEGER NOT NULL REFERENCES admins (id),
  created_at TEXT NOT NULL,
  used_at TEXT,
  revoked_at TEXT
);

CREATE INDEX admin_invitations_email_idx ON admin_invitations (email);
CREATE INDEX admin_invitations_expiry_idx ON admin_invitations (expires_at);
CREATE INDEX admin_invitations_active_token_idx
  ON admin_invitations (token_hash, used_at, revoked_at);
