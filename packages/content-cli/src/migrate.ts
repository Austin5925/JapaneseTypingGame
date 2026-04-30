import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

import Database from 'better-sqlite3';

import { listMigrations } from './paths';

// Tracks which migrations have been applied so a re-run is a no-op. Keep this table name in
// sync with the Rust runner if/when we share telemetry.
const SCHEMA_VERSION_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
`;

export interface MigrationRunResult {
  applied: string[];
  skipped: string[];
}

export function openDb(dbPath: string): Database.Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

export function runMigrations(db: Database.Database): MigrationRunResult {
  db.exec(SCHEMA_VERSION_DDL);

  const appliedStmt = db.prepare<[], { name: string }>('SELECT name FROM schema_migrations');
  const insertStmt = db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)');

  const already = new Set(appliedStmt.all().map((row) => row.name));
  const result: MigrationRunResult = { applied: [], skipped: [] };

  for (const { name, path } of listMigrations()) {
    if (already.has(name)) {
      result.skipped.push(name);
      continue;
    }
    const sql = readFileSync(path, 'utf8');
    const tx = db.transaction(() => {
      db.exec(sql);
      insertStmt.run(name, new Date().toISOString());
    });
    tx();
    result.applied.push(name);
  }

  return result;
}
