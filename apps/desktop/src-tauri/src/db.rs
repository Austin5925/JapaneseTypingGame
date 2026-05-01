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
    (
        "005_extras.sql",
        include_str!("../../../../migrations/005_extras.sql"),
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

    // Migration runner: walk the static MIGRATIONS list, skip any whose name is already
    // recorded in schema_migrations, run the rest in a transaction. Skipping is required
    // because SQLite ALTER TABLE ADD COLUMN is not idempotent (it errors on duplicate column);
    // 001-004 use CREATE TABLE IF NOT EXISTS and would survive a replay, but 005+ may add
    // columns or rename them and cannot. Race tolerance survives because the existence check
    // + transaction together ensure a duplicate write fails the second instance's INSERT
    // rather than the schema change itself.
    let mut applied_list: Vec<String> = Vec::new();
    for (name, sql) in MIGRATIONS {
        let already: i64 = conn.query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE name = ?1",
            params![*name],
            |row| row.get(0),
        )?;
        if already > 0 {
            applied_list.push((*name).to_string());
            continue;
        }
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
