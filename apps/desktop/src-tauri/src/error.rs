use serde::{Serialize, Serializer};
use thiserror::Error;

// Tauri serialises command return values via serde, so any error type must implement Serialize.
// We flatten everything to a single string with a kind tag — the frontend doesn't need to
// branch on variants in this scaffold; it logs whatever it gets.
#[derive(Debug, Error)]
pub enum AppError {
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("tauri error: {0}")]
    Tauri(#[from] tauri::Error),

    #[error("invalid pack content: {0}")]
    InvalidPack(String),

    #[error("internal: {0}")]
    Internal(String),
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
