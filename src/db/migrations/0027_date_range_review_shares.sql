CREATE TABLE date_range_review_shares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  overview_slug TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  share_id TEXT NOT NULL,
  story_json TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  published_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX date_range_review_shares_share_id_idx
  ON date_range_review_shares (share_id);

CREATE UNIQUE INDEX date_range_review_shares_overview_slug_idx
  ON date_range_review_shares (overview_slug);
