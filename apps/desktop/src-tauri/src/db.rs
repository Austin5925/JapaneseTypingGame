use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::Utc;
use rusqlite::{params, Connection};

use crate::error::AppResult;

// Migrations are embedded at compile time (`include_str!`) so a built binary doesn't depend on
// the source tree being present at runtime. Order matters: applied lexicographically by name.
// To add a migration: drop a new `NNN_<topic>.sql` under repo `migrations/` and append here.
const MIGRATIONS: &[(&str, &str)] = &[
    (
        "001_content.sql",
        include_str!("../../../../migrations/001_content.sql"),
    ),
    (
        "002_progress.sql",
        include_str!("../../../../migrations/002_progress.sql"),
    ),
    (
        "003_sessions.sql",
        include_str!("../../../../migrations/003_sessions.sql"),
    ),
    (
        "004_plans.sql",
        include_str!("../../../../migrations/004_plans.sql"),
    ),
];

pub struct AppDb {
    pub path: PathBuf,
    pub conn: Mutex<Connection>,
    pub applied_migrations: Vec<String>,
}

pub fn init(app_data_dir: &Path) -> AppResult<AppDb> {
    std::fs::create_dir_all(app_data_dir)?;
    let path = app_data_dir.join("kana_typing.sqlite");
    let conn = Connection::open(&path)?;
    // WAL improves concurrent reads while we batch writes from a single Tauri thread; foreign
    // keys are off by default in SQLite and we rely on cascade-delete in the schema.
    conn.execute_batch("PRAGMA journal_mode = WAL;\n         PRAGMA foreign_keys = ON;")?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations (\n             name TEXT PRIMARY KEY,\n             applied_at TEXT NOT NULL\n         )",
        [],
    )?;

    // Race tolerance on first launch: two app instances opening the same DB simultaneously
    // would each see schema_migrations empty, both run the (idempotent) DDL, and one would lose
    // a UNIQUE-constraint race when inserting the marker row. `INSERT OR IGNORE` lets the
    // loser's marker write be a no-op while still ensuring the migration is recorded exactly
    // once. We then re-read the table to populate `applied_list` from ground truth rather than
    // from the local intent.
    let mut applied_list: Vec<String> = Vec::new();
    for (name, sql) in MIGRATIONS {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(sql)?;
        tx.execute(
            "INSERT OR IGNORE INTO schema_migrations (name, applied_at) VALUES (?1, ?2)",
            params![*name, Utc::now().to_rfc3339()],
        )?;
        tx.commit()?;
        applied_list.push((*name).to_string());
    }

    Ok(AppDb {
        path,
        conn: Mutex::new(conn),
        applied_migrations: applied_list,
    })
}
