mod commands;
mod db;
mod error;

use std::path::{Path, PathBuf};

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Resolve the OS-appropriate user-data directory and initialise SQLite there.
            // On macOS this is `~/Library/Application Support/<bundle-id>/`, on Windows it's
            // `%AppData%/<bundle-id>/`. Tauri creates the directory if missing.
            //
            // In a debug build, prefer the in-tree `{repo}/local-data/` directory if we can
            // locate it. This keeps `pnpm content:import` (which writes to that path) and
            // `pnpm tauri:dev` (which reads from this DB) in sync without the developer
            // having to pass `--db <ugly-app-data-path>` every time. Release builds always
            // use app_data_dir.
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("failed to resolve app data dir: {e}"))?;
            let db_dir = resolve_db_dir(app_data_dir);
            eprintln!("kana-typing: SQLite directory = {}", db_dir.display());
            let db = db::init(&db_dir).map_err(|e| format!("db init failed: {e}"))?;
            app.manage(db);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::seed_test_pack,
            commands::list_items,
            commands::get_db_info,
            commands::create_session,
            commands::finish_session,
            commands::insert_attempt_event,
            commands::get_progress,
            commands::upsert_progress,
            commands::record_attempt_result,
            commands::list_recent_attempts,
            commands::list_attempts_by_session,
            commands::list_progress,
            commands::aggregate_recent_error_tags,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Pick the SQLite directory at runtime. Debug builds prefer
/// `{repo}/local-data/` so the dev SQLite stays in sync with the CLI
/// importer; release builds always go to the OS app-data path.
fn resolve_db_dir(app_data_dir: PathBuf) -> PathBuf {
    if cfg!(debug_assertions) {
        if let Some(dev_dir) = dev_local_data_dir() {
            return dev_dir;
        }
    }
    app_data_dir
}

/// Walk upward from CARGO_MANIFEST_DIR (resolved at compile time) until we
/// find the repo root marker (`pnpm-workspace.yaml`). Returns
/// `{repo}/local-data/` if found, `None` otherwise.
///
/// Used only in debug builds; the path is captured at compile time, so a
/// debug binary copied off-machine still works (it just falls through to
/// the OS app-data dir).
fn dev_local_data_dir() -> Option<PathBuf> {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut cur: Option<&Path> = Some(manifest);
    for _ in 0..6 {
        let dir = cur?;
        if dir.join("pnpm-workspace.yaml").exists() {
            return Some(dir.join("local-data"));
        }
        cur = dir.parent();
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dev_local_data_dir_locates_repo_root_in_debug_build() {
        // Sanity: when run via `cargo test` from inside the workspace, the
        // walk-up should find pnpm-workspace.yaml.
        let dir = dev_local_data_dir().expect("walk-up should find repo root in cargo test");
        assert!(dir.ends_with("local-data"), "got {}", dir.display());
    }

    #[test]
    fn resolve_db_dir_prefers_dev_path_in_debug() {
        // In a debug build, the resolved path should not be the fallback.
        let fallback = PathBuf::from("/tmp/some/fallback");
        let resolved = resolve_db_dir(fallback.clone());
        if cfg!(debug_assertions) {
            assert_ne!(resolved, fallback, "debug build should pick dev path");
            assert!(resolved.ends_with("local-data"));
        } else {
            assert_eq!(resolved, fallback);
        }
    }
}
