use chrono::Utc;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::AppDb;
use crate::error::{AppError, AppResult};

// ────────────────────────────────────────────────────────────────────────
// get_db_info
// ────────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbInfo {
    pub path: String,
    pub applied_migrations: Vec<String>,
    pub item_count: i64,
}

#[tauri::command]
pub fn get_db_info(db: State<'_, AppDb>) -> AppResult<DbInfo> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let item_count: i64 =
        conn.query_row("SELECT COUNT(*) FROM learning_items", [], |row| row.get(0))?;
    Ok(DbInfo {
        path: db.path.display().to_string(),
        applied_migrations: db.applied_migrations.clone(),
        item_count,
    })
}

// ────────────────────────────────────────────────────────────────────────
// list_items (dev-only narrow projection)
// ────────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevItemRow {
    pub id: String,
    pub surface: String,
    pub kana: String,
    pub romaji: Vec<String>,
    pub jlpt: Option<String>,
}

#[tauri::command]
pub fn list_items(db: State<'_, AppDb>, limit: Option<i64>) -> AppResult<Vec<DevItemRow>> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let limit = limit.unwrap_or(50).clamp(1, 1000);
    let mut stmt = conn.prepare(
        "SELECT id, surface, kana, romaji_json, jlpt FROM learning_items ORDER BY id LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit], |row| {
        let romaji_json: String = row.get(3)?;
        let romaji: Vec<String> = serde_json::from_str(&romaji_json).unwrap_or_default();
        Ok(DevItemRow {
            id: row.get(0)?,
            surface: row.get(1)?,
            kana: row.get(2)?,
            romaji,
            jlpt: row.get(4)?,
        })
    })?;
    let mut out = Vec::with_capacity(limit as usize);
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

// ────────────────────────────────────────────────────────────────────────
// seed_test_pack
// ────────────────────────────────────────────────────────────────────────
//
// Embedded at compile time so a packaged build doesn't need the repo on disk. When we move
// content to a real installer/resource pipeline (Sprint 4+), this will switch to reading from
// `tauri::path::resource_dir`.
const SEED_PACK_JSON: &str = include_str!("../../../../content/official/n5-basic-mini.json");

#[derive(Debug, Deserialize)]
struct PackInput {
    id: String,
    name: String,
    version: String,
    #[serde(default)]
    author: Option<String>,
    #[serde(default = "default_locale")]
    locale: String,
    #[serde(default)]
    description: Option<String>,
    items: Vec<ItemInput>,
}

fn default_locale() -> String {
    "zh-CN".to_string()
}

#[derive(Debug, Deserialize)]
struct ItemInput {
    id: String,
    #[serde(rename = "type")]
    item_type: String,
    surface: String,
    kana: String,
    romaji: Vec<String>,
    #[serde(rename = "meaningsZh")]
    meanings_zh: Vec<String>,
    #[serde(default, rename = "meaningsEn")]
    meanings_en: Option<Vec<String>>,
    #[serde(default)]
    pos: Option<String>,
    #[serde(default)]
    jlpt: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default, rename = "skillTags")]
    skill_tags: Vec<String>,
    #[serde(default, rename = "errorTags")]
    error_tags: Option<Vec<String>>,
    #[serde(default, rename = "acceptedSurfaces")]
    accepted_surfaces: Option<Vec<String>>,
    #[serde(default, rename = "acceptedKana")]
    accepted_kana: Option<Vec<String>>,
    #[serde(default)]
    examples: Vec<ExampleInput>,
    #[serde(default, rename = "audioRefs")]
    audio_refs: Vec<AudioRefInput>,
    #[serde(default, rename = "confusableItemIds")]
    confusable_item_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct ExampleInput {
    id: String,
    ja: String,
    #[serde(default)]
    kana: Option<String>,
    zh: String,
    #[serde(default, rename = "targetSurface")]
    target_surface: Option<String>,
    #[serde(default, rename = "targetKana")]
    target_kana: Option<String>,
    #[serde(default, rename = "audioRef")]
    audio_ref: Option<String>,
    #[serde(default)]
    tags: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct AudioRefInput {
    id: String,
    kind: String,
    path: String,
    #[serde(default, rename = "durationMs")]
    duration_ms: Option<i64>,
    #[serde(default)]
    speaker: Option<String>,
    #[serde(default)]
    speed: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeedTestPackResult {
    pub pack_id: String,
    pub items_upserted: u32,
}

#[tauri::command]
pub fn seed_test_pack(db: State<'_, AppDb>) -> AppResult<SeedTestPackResult> {
    let pack: PackInput = serde_json::from_str(SEED_PACK_JSON)
        .map_err(|e| AppError::InvalidPack(format!("seed pack JSON malformed: {}", e)))?;

    let mut conn = db
        .conn
        .lock()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    tx.execute(
        "INSERT INTO content_packs (id, name, version, author, locale, quality, description, imported_at, enabled)
         VALUES (?1, ?2, ?3, ?4, ?5, 'official', ?6, ?7, 1)
         ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             version = excluded.version,
             author = excluded.author,
             locale = excluded.locale,
             description = excluded.description,
             imported_at = excluded.imported_at",
        params![
            pack.id,
            pack.name,
            pack.version,
            pack.author,
            pack.locale,
            pack.description,
            now,
        ],
    )?;

    let mut items_upserted: u32 = 0;
    for item in &pack.items {
        tx.execute(
            "INSERT INTO learning_items (
                id, type, surface, kana, romaji_json, meanings_zh_json, meanings_en_json,
                pos, jlpt, tags_json, skill_tags_json, error_tags_json,
                accepted_surfaces_json, accepted_kana_json,
                source_pack_id, quality, created_at, updated_at
             ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, 'official', ?16, ?17
             )
             ON CONFLICT(id) DO UPDATE SET
                type = excluded.type,
                surface = excluded.surface,
                kana = excluded.kana,
                romaji_json = excluded.romaji_json,
                meanings_zh_json = excluded.meanings_zh_json,
                meanings_en_json = excluded.meanings_en_json,
                pos = excluded.pos,
                jlpt = excluded.jlpt,
                tags_json = excluded.tags_json,
                skill_tags_json = excluded.skill_tags_json,
                error_tags_json = excluded.error_tags_json,
                accepted_surfaces_json = excluded.accepted_surfaces_json,
                accepted_kana_json = excluded.accepted_kana_json,
                source_pack_id = excluded.source_pack_id,
                quality = excluded.quality,
                updated_at = excluded.updated_at",
            params![
                item.id,
                item.item_type,
                item.surface,
                item.kana,
                serde_json::to_string(&item.romaji)?,
                serde_json::to_string(&item.meanings_zh)?,
                item.meanings_en.as_ref().map(serde_json::to_string).transpose()?,
                item.pos,
                item.jlpt,
                serde_json::to_string(&item.tags)?,
                serde_json::to_string(&item.skill_tags)?,
                item.error_tags.as_ref().map(serde_json::to_string).transpose()?,
                item.accepted_surfaces.as_ref().map(serde_json::to_string).transpose()?,
                item.accepted_kana.as_ref().map(serde_json::to_string).transpose()?,
                pack.id,
                now,
                now,
            ],
        )?;
        items_upserted += 1;

        tx.execute(
            "DELETE FROM item_examples WHERE item_id = ?1",
            params![item.id],
        )?;
        for ex in &item.examples {
            tx.execute(
                "INSERT INTO item_examples (id, item_id, ja, kana, zh, target_surface, target_kana, audio_ref, tags_json, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    ex.id,
                    item.id,
                    ex.ja,
                    ex.kana,
                    ex.zh,
                    ex.target_surface,
                    ex.target_kana,
                    ex.audio_ref,
                    ex.tags.as_ref().map(serde_json::to_string).transpose()?,
                    now,
                ],
            )?;
        }

        tx.execute(
            "DELETE FROM item_confusables WHERE item_id = ?1",
            params![item.id],
        )?;
        for cid in &item.confusable_item_ids {
            if cid == &item.id {
                continue;
            }
            tx.execute(
                "INSERT INTO item_confusables (item_id, confusable_item_id, reason_tag, weight)
                 VALUES (?1, ?2, 'unknown', 1.0)",
                params![item.id, cid],
            )?;
        }
    }

    tx.execute(
        "DELETE FROM audio_assets WHERE content_pack_id = ?1",
        params![pack.id],
    )?;
    for item in &pack.items {
        for a in &item.audio_refs {
            tx.execute(
                "INSERT INTO audio_assets (id, content_pack_id, kind, path, duration_ms, speaker, speed, checksum, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8)",
                params![
                    a.id,
                    pack.id,
                    a.kind,
                    a.path,
                    a.duration_ms,
                    a.speaker,
                    a.speed.clone().unwrap_or_else(|| "normal".to_string()),
                    now,
                ],
            )?;
        }
    }

    tx.commit()?;

    Ok(SeedTestPackResult {
        pack_id: pack.id,
        items_upserted,
    })
}
