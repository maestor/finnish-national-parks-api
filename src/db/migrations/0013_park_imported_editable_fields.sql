ALTER TABLE parks ADD COLUMN imported_slug TEXT;
ALTER TABLE parks ADD COLUMN imported_name TEXT;
ALTER TABLE parks ADD COLUMN imported_display_type_name TEXT;
ALTER TABLE parks ADD COLUMN imported_area_km2 REAL;
ALTER TABLE parks ADD COLUMN imported_establishment_year INTEGER;
ALTER TABLE parks ADD COLUMN imported_location_label TEXT;
ALTER TABLE parks ADD COLUMN imported_postal_code TEXT;
ALTER TABLE parks ADD COLUMN imported_postal_office TEXT;
ALTER TABLE parks ADD COLUMN imported_luontoon_url TEXT;

UPDATE parks
SET
  imported_slug = slug,
  imported_name = name,
  imported_display_type_name = display_type_name,
  imported_area_km2 = area_km2,
  imported_establishment_year = establishment_year,
  imported_location_label = location_label,
  imported_postal_code = postal_code,
  imported_postal_office = postal_office,
  imported_luontoon_url = luontoon_url;
