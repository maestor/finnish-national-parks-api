UPDATE park_types
SET
  name = 'Historia-alue',
  slug = 'cultural-history-area'
WHERE id = 9001;

UPDATE parks
SET
  display_type_name = 'Tehdaskylä',
  imported_display_type_name = 'Tehdaskylä'
WHERE managed_by_lipas_import = 0
  AND type_id = 9001
  AND COALESCE(display_type_name, imported_display_type_name) IS NULL;

UPDATE parks
SET
  type_id = 9001
WHERE managed_by_lipas_import = 0
  AND type_id = 103
  AND (
    display_type_name = 'Historia-alue'
    OR imported_display_type_name = 'Historia-alue'
    OR display_type_name = 'Maailmanperintökohde'
    OR imported_display_type_name = 'Maailmanperintökohde'
  );

UPDATE parks
SET imported_display_type_name = NULL
WHERE managed_by_lipas_import = 0
  AND imported_display_type_name = 'Historia-alue';

UPDATE parks
SET display_type_name = NULL
WHERE managed_by_lipas_import = 0
  AND display_type_name = 'Historia-alue';
