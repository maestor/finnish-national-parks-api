ALTER TABLE parks ADD COLUMN imported_marker_lon REAL;
ALTER TABLE parks ADD COLUMN imported_marker_lat REAL;

UPDATE parks
SET
  imported_marker_lon = marker_lon,
  imported_marker_lat = marker_lat
WHERE imported_marker_lon IS NULL OR imported_marker_lat IS NULL;
