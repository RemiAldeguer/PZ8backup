CREATE TABLE IF NOT EXISTS demo_workspaces (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL CHECK (json_valid(data)),
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
