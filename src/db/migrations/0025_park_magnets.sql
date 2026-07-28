ALTER TABLE parks ADD COLUMN has_magnet INTEGER NOT NULL DEFAULT 0;
ALTER TABLE parks ADD COLUMN imported_has_magnet INTEGER NOT NULL DEFAULT 0;

UPDATE parks
SET
  has_magnet = CASE
    WHEN type_id = 111 THEN 1
    ELSE 0
  END,
  imported_has_magnet = CASE
    WHEN type_id = 111 THEN 1
    ELSE 0
  END
WHERE has_magnet = 0 AND imported_has_magnet = 0;
