PRAGMA foreign_keys = OFF;

CREATE TABLE trips__new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  starting_point_label TEXT,
  starting_point_lat REAL,
  starting_point_lon REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

WITH trip_slug_bases AS (
  SELECT
    id,
    name,
    description,
    created_at,
    updated_at,
    trim(
      replace(
        replace(
          replace(
            replace(
              replace(
                replace(
                  replace(
                    replace(
                      replace(
                        replace(
                          replace(
                            replace(
                              replace(
                                replace(
                                  replace(
                                    replace(
                                      replace(
                                        replace(
                                          replace(
                                            lower(
                                              replace(
                                                replace(
                                                  replace(
                                                    replace(
                                                      replace(
                                                        replace(trim(name), 'Ä', 'A'),
                                                        'Ö',
                                                        'O'
                                                      ),
                                                      'Å',
                                                      'A'
                                                    ),
                                                    'ä',
                                                    'a'
                                                  ),
                                                  'ö',
                                                  'o'
                                                ),
                                                'å',
                                                'a'
                                              )
                                            ),
                                            'é',
                                            'e'
                                          ),
                                          '&',
                                          '-'
                                        ),
                                        '/',
                                        '-'
                                      ),
                                      '_',
                                      '-'
                                    ),
                                    ' ',
                                    '-'
                                  ),
                                  '.',
                                  '-'
                                ),
                                ',',
                                '-'
                              ),
                              ':',
                              '-'
                            ),
                            ';',
                            '-'
                          ),
                          '+',
                          '-'
                        ),
                        '!',
                        ''
                      ),
                      '?',
                      ''
                    ),
                    '(',
                    ''
                  ),
                  ')',
                  ''
                ),
                '[',
                ''
              ),
              ']',
              ''
            ),
            '''',
            ''
          ),
          '--',
          '-'
        ),
        '--',
        '-'
      ),
      '-'
    ) AS raw_slug
  FROM trips
),
ranked_trips AS (
  SELECT
    id,
    name,
    description,
    created_at,
    updated_at,
    CASE
      WHEN raw_slug = '' THEN 'trip'
      ELSE raw_slug
    END AS base_slug,
    ROW_NUMBER() OVER (
      PARTITION BY
        CASE
          WHEN raw_slug = '' THEN 'trip'
          ELSE raw_slug
        END
      ORDER BY id
    ) AS slug_rank
  FROM trip_slug_bases
)
INSERT INTO trips__new (
  id,
  name,
  slug,
  description,
  starting_point_label,
  starting_point_lat,
  starting_point_lon,
  created_at,
  updated_at
)
SELECT
  id,
  name,
  CASE
    WHEN slug_rank = 1 THEN base_slug
    ELSE base_slug || '-' || slug_rank
  END,
  description,
  NULL,
  NULL,
  NULL,
  created_at,
  updated_at
FROM ranked_trips
ORDER BY id;

DROP TABLE trips;

ALTER TABLE trips__new RENAME TO trips;

CREATE INDEX trips_name_idx ON trips (name);
CREATE UNIQUE INDEX trips_slug_idx ON trips (slug);

PRAGMA foreign_keys = ON;
