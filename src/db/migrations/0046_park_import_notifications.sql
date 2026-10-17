CREATE TABLE park_import_notifications (
  import_run_id INTEGER PRIMARY KEY NOT NULL REFERENCES import_runs(id),
  parks_json TEXT NOT NULL
);
