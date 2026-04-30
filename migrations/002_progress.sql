-- Migration 002: per (user, item, skill_dimension) progress aggregate.

CREATE TABLE IF NOT EXISTS item_skill_progress (
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  skill_dimension TEXT NOT NULL,
  state TEXT NOT NULL,
  mastery_score REAL NOT NULL DEFAULT 0,
  stability REAL NOT NULL DEFAULT 0,
  difficulty REAL NOT NULL DEFAULT 0.5,
  exposure_count INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  wrong_count INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  lapse_count INTEGER NOT NULL DEFAULT 0,
  average_reaction_time_ms REAL,
  last_attempt_at TEXT,
  next_due_at TEXT,
  last_error_tags_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, item_id, skill_dimension),
  FOREIGN KEY (item_id) REFERENCES learning_items (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_progress_due ON item_skill_progress (user_id, next_due_at);
CREATE INDEX IF NOT EXISTS idx_progress_state ON item_skill_progress (user_id, state);
CREATE INDEX IF NOT EXISTS idx_progress_skill ON item_skill_progress (user_id, skill_dimension);
CREATE INDEX IF NOT EXISTS idx_progress_user_item ON item_skill_progress (user_id, item_id);
