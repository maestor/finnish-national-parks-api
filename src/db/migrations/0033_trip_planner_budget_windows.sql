CREATE TABLE trip_planner_budget_windows (
  key TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  request_count INTEGER NOT NULL
);

CREATE INDEX trip_planner_budget_windows_expiry_idx
  ON trip_planner_budget_windows (window_started_at);
