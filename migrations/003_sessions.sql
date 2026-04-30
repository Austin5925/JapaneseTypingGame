-- Migration 003: game sessions and the immutable attempt-event log.
-- attempt_events is the long-term learning log; never delete rows here. progress aggregates
-- can always be rebuilt from this table.

CREATE TABLE IF NOT EXISTS game_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  game_type TEXT NOT NULL,
  plan_id TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT NOT NULL,
  target_duration_ms INTEGER,
  final_score REAL,
  summary_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_started ON game_sessions (user_id, started_at);

CREATE TABLE IF NOT EXISTS attempt_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  game_type TEXT NOT NULL,
  skill_dimension TEXT NOT NULL,
  answer_mode TEXT NOT NULL,
  raw_input TEXT,
  committed_input TEXT,
  selected_option_id TEXT,
  chunk_order_json TEXT,
  is_correct INTEGER NOT NULL,
  score REAL NOT NULL,
  reaction_time_ms INTEGER NOT NULL,
  used_hint INTEGER NOT NULL DEFAULT 0,
  error_tags_json TEXT NOT NULL,
  explanation TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES game_sessions (id),
  FOREIGN KEY (item_id) REFERENCES learning_items (id)
);

CREATE INDEX IF NOT EXISTS idx_attempts_user_item ON attempt_events (user_id, item_id);
CREATE INDEX IF NOT EXISTS idx_attempts_user_game_time ON attempt_events (user_id, game_type, created_at);
CREATE INDEX IF NOT EXISTS idx_attempts_session ON attempt_events (session_id);
