ALTER TABLE admins ADD COLUMN google_sub TEXT;

CREATE UNIQUE INDEX admins_google_sub_idx ON admins (google_sub);
