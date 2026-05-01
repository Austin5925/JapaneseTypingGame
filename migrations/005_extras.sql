-- Migration 005: extras_json on learning_items.
-- v0.8.3 lets sentence-typed items piggy-back on the learning_items table by serialising
-- their chunks / acceptedOrders / zhPrompt into a single TEXT column. This avoids a sibling
-- sentence_items table and keeps the existing FK to attempt_events / item_skill_progress.
--
-- SQLite ALTER TABLE ADD COLUMN is idempotent only when the column is absent; we guard via
-- the schema_migrations bookkeeping in db.rs (the migration runner won't re-execute applied
-- migrations) and add the column unconditionally here. If a fresh DB runs 001 + 005 in one
-- pass, 001 already has the column? No — 001 doesn't know about extras_json. So 005 must run
-- standalone and ADD COLUMN can fail on re-run. We rely on the runner's "applied once" guard.
--
-- For dev databases that may have run pre-005 schema and then need to re-run, the
-- schema_migrations row prevents replay.

ALTER TABLE learning_items ADD COLUMN extras_json TEXT;
