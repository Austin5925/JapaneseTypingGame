-- Migration 004: daily training plans and the per-block task list.

CREATE TABLE IF NOT EXISTS daily_plans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  target_duration_ms INTEGER NOT NULL,
  generated_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL,
  weakness_vector_json TEXT NOT NULL,
  summary_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_daily_plans_user_date ON daily_plans (user_id, date);

CREATE TABLE IF NOT EXISTS daily_plan_tasks (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  game_type TEXT NOT NULL,
  skill_dimension TEXT NOT NULL,
  target_item_ids_json TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  priority INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  FOREIGN KEY (plan_id) REFERENCES daily_plans (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_daily_plan_tasks_plan ON daily_plan_tasks (plan_id);
