DROP TABLE IF EXISTS park_notes;

ALTER TABLE park_visits ADD COLUMN route TEXT;
ALTER TABLE park_visits ADD COLUMN author TEXT;
