CREATE TABLE year_review_shares (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  year INTEGER NOT NULL,
  share_id TEXT NOT NULL,
  story_json TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  published_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX year_review_shares_share_id_idx ON year_review_shares (share_id);
CREATE UNIQUE INDEX year_review_shares_year_idx ON year_review_shares (year);
