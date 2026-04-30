mod commands;
mod db;
mod error;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Resolve the OS-appropriate user-data directory and initialise SQLite there.
            // On macOS this is `~/Library/Application Support/<bundle-id>/`, on Windows it's
            // `%AppData%/<bundle-id>/`. Tauri creates the directory if missing.
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("failed to resolve app data dir: {e}"))?;
            let db = db::init(&app_data_dir).map_err(|e| format!("db init failed: {e}"))?;
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
