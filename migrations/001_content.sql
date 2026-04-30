-- Migration 001: content packs, learning items, examples, confusables, audio assets.
-- Idempotent guards (`IF NOT EXISTS`) so the same migration runner can be invoked from
-- both the Tauri Rust backend and the content-cli (Node) without bookkeeping divergence.

CREATE TABLE IF NOT EXISTS content_packs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  author TEXT,
  locale TEXT NOT NULL DEFAULT 'zh-CN',
  quality TEXT NOT NULL DEFAULT 'official',
  description TEXT,
  imported_at TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS learning_items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  surface TEXT NOT NULL,
  kana TEXT NOT NULL,
  romaji_json TEXT NOT NULL,
  meanings_zh_json TEXT NOT NULL,
  meanings_en_json TEXT,
  pos TEXT,
  jlpt TEXT,
  tags_json TEXT NOT NULL,
  skill_tags_json TEXT NOT NULL,
  error_tags_json TEXT,
  accepted_surfaces_json TEXT,
  accepted_kana_json TEXT,
  source_pack_id TEXT NOT NULL,
  quality TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (source_pack_id) REFERENCES content_packs (id)
);

CREATE INDEX IF NOT EXISTS idx_learning_items_surface ON learning_items (surface);
CREATE INDEX IF NOT EXISTS idx_learning_items_kana ON learning_items (kana);
CREATE INDEX IF NOT EXISTS idx_learning_items_pack ON learning_items (source_pack_id);

CREATE TABLE IF NOT EXISTS item_examples (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  ja TEXT NOT NULL,
  kana TEXT,
  zh TEXT NOT NULL,
  target_surface TEXT,
  target_kana TEXT,
  audio_ref TEXT,
  tags_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (item_id) REFERENCES learning_items (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_item_examples_item ON item_examples (item_id);

CREATE TABLE IF NOT EXISTS item_confusables (
  item_id TEXT NOT NULL,
  confusable_item_id TEXT NOT NULL,
  reason_tag TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY (item_id, confusable_item_id, reason_tag)
);

CREATE TABLE IF NOT EXISTS audio_assets (
  id TEXT PRIMARY KEY,
  content_pack_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  duration_ms INTEGER,
  speaker TEXT,
  speed TEXT NOT NULL DEFAULT 'normal',
  checksum TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (content_pack_id) REFERENCES content_packs (id) ON DELETE CASCADE
);
