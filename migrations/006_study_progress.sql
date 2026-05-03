-- Migration 006: study_progress (v0.9.0 学习模式).
--
-- 学习模式是非游戏的卡片浏览界面。一条 study_progress 行 = 「该用户曾经看过这条学习项」,
-- 与 item_skill_progress(per skill_dimension 的掌握度)正交,故独立成表。
--
-- 字段语义:
--   view_count       — 卡片被展示并停留 ≥2s 的累计次数(自动判"已看过")
--   marked           — 用户主动点 ✓ 已学(0/1);允许撤销,故是 boolean 而非 timestamp
--   first_viewed_at  — 第一次自动 view 或手动 mark 的时间(用于复习排序)
--   last_viewed_at   — 最近一次 view / mark 的时间(用于"最久未复习的优先"排序)
--
-- "已学过" 的判定:view_count >= 1 OR marked = 1。复习模式用这个 predicate filter。

CREATE TABLE IF NOT EXISTS study_progress (
  user_id          TEXT NOT NULL,
  item_id          TEXT NOT NULL,
  view_count       INTEGER NOT NULL DEFAULT 0,
  marked           INTEGER NOT NULL DEFAULT 0,
  first_viewed_at  TEXT,
  last_viewed_at   TEXT,
  PRIMARY KEY (user_id, item_id),
  FOREIGN KEY (item_id) REFERENCES learning_items (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_study_progress_user ON study_progress (user_id, last_viewed_at);
