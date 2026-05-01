use chrono::Utc;
use rusqlite::{params, OptionalExtension};
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
    pub tags: Vec<String>,
    pub skill_tags: Vec<String>,
    pub accepted_kana: Vec<String>,
}

#[tauri::command]
pub fn list_items(db: State<'_, AppDb>, limit: Option<i64>) -> AppResult<Vec<DevItemRow>> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let limit = limit.unwrap_or(50).clamp(1, 1000);
    let mut stmt = conn.prepare(
        "SELECT id, surface, kana, romaji_json, jlpt, tags_json, skill_tags_json, accepted_kana_json
         FROM learning_items ORDER BY id LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit], |row| {
        let romaji_json: String = row.get(3)?;
        let tags_json: String = row.get(5)?;
        let skill_tags_json: String = row.get(6)?;
        let accepted_kana_json: Option<String> = row.get(7)?;
        let romaji: Vec<String> = serde_json::from_str(&romaji_json).unwrap_or_default();
        Ok(DevItemRow {
            id: row.get(0)?,
            surface: row.get(1)?,
            kana: row.get(2)?,
            romaji,
            jlpt: row.get(4)?,
            tags: serde_json::from_str(&tags_json).unwrap_or_default(),
            skill_tags: serde_json::from_str(&skill_tags_json).unwrap_or_default(),
            accepted_kana: accepted_kana_json
                .as_deref()
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or_default(),
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

// ────────────────────────────────────────────────────────────────────────
// Session / attempt / progress (Sprint 2)
// ────────────────────────────────────────────────────────────────────────
//
// Frontend generates IDs (crypto.randomUUID). The Rust side just persists what it's given,
// so we don't pull in a uuid crate yet.

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionInput {
    pub id: String,
    pub user_id: String,
    pub game_type: String,
    #[serde(default)]
    pub plan_id: Option<String>,
    #[serde(default)]
    pub target_duration_ms: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecord {
    pub id: String,
    pub user_id: String,
    pub game_type: String,
    pub plan_id: Option<String>,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub status: String,
    pub target_duration_ms: Option<i64>,
}

#[tauri::command]
pub fn create_session(db: State<'_, AppDb>, input: CreateSessionInput) -> AppResult<SessionRecord> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let started_at = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO game_sessions (id, user_id, game_type, plan_id, started_at, status, target_duration_ms)\n         VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6)",
        params![
            input.id,
            input.user_id,
            input.game_type,
            input.plan_id,
            started_at,
            input.target_duration_ms,
        ],
    )?;
    Ok(SessionRecord {
        id: input.id,
        user_id: input.user_id,
        game_type: input.game_type,
        plan_id: input.plan_id,
        started_at,
        ended_at: None,
        status: "active".to_string(),
        target_duration_ms: input.target_duration_ms,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinishSessionInput {
    pub session_id: String,
    pub status: String, // finished / aborted / timeout
    #[serde(default)]
    pub final_score: Option<f64>,
    /// Free-form summary serialised by the caller; we don't introspect the shape here.
    #[serde(default)]
    pub summary_json: Option<String>,
}

#[tauri::command]
pub fn finish_session(db: State<'_, AppDb>, input: FinishSessionInput) -> AppResult<()> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let ended_at = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE game_sessions SET ended_at = ?1, status = ?2, final_score = ?3, summary_json = ?4 WHERE id = ?5",
        params![
            ended_at,
            input.status,
            input.final_score,
            input.summary_json,
            input.session_id,
        ],
    )?;
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttemptEventInput {
    pub id: String,
    pub session_id: String,
    pub user_id: String,
    pub task_id: String,
    pub item_id: String,
    pub game_type: String,
    pub skill_dimension: String,
    pub answer_mode: String,
    #[serde(default)]
    pub raw_input: Option<String>,
    #[serde(default)]
    pub committed_input: Option<String>,
    #[serde(default)]
    pub selected_option_id: Option<String>,
    #[serde(default)]
    pub chunk_order: Option<Vec<String>>,
    pub is_correct: bool,
    pub score: f64,
    pub reaction_time_ms: i64,
    pub used_hint: bool,
    pub error_tags: Vec<String>,
    #[serde(default)]
    pub explanation: Option<String>,
}

#[tauri::command]
pub fn insert_attempt_event(db: State<'_, AppDb>, input: AttemptEventInput) -> AppResult<()> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let now = Utc::now().to_rfc3339();
    let chunk_order_json = input
        .chunk_order
        .as_ref()
        .map(serde_json::to_string)
        .transpose()?;
    conn.execute(
        "INSERT INTO attempt_events (\n             id, session_id, user_id, task_id, item_id, game_type, skill_dimension,\n             answer_mode, raw_input, committed_input, selected_option_id, chunk_order_json,\n             is_correct, score, reaction_time_ms, used_hint, error_tags_json, explanation, created_at\n         ) VALUES (\n             ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19\n         )",
        params![
            input.id,
            input.session_id,
            input.user_id,
            input.task_id,
            input.item_id,
            input.game_type,
            input.skill_dimension,
            input.answer_mode,
            input.raw_input,
            input.committed_input,
            input.selected_option_id,
            chunk_order_json,
            input.is_correct as i64,
            input.score,
            input.reaction_time_ms,
            input.used_hint as i64,
            serde_json::to_string(&input.error_tags)?,
            input.explanation,
            now,
        ],
    )?;
    Ok(())
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressRecord {
    pub user_id: String,
    pub item_id: String,
    pub skill_dimension: String,
    pub state: String,
    pub mastery_score: f64,
    pub stability: f64,
    pub difficulty: f64,
    pub exposure_count: i64,
    pub correct_count: i64,
    pub wrong_count: i64,
    pub streak: i64,
    pub lapse_count: i64,
    pub average_reaction_time_ms: Option<f64>,
    pub last_attempt_at: Option<String>,
    pub next_due_at: Option<String>,
    pub last_error_tags: Vec<String>,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetProgressInput {
    pub user_id: String,
    pub item_id: String,
    pub skill_dimension: String,
}

#[tauri::command]
pub fn get_progress(
    db: State<'_, AppDb>,
    input: GetProgressInput,
) -> AppResult<Option<ProgressRecord>> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let row = conn
        .query_row(
            "SELECT user_id, item_id, skill_dimension, state, mastery_score, stability, difficulty,\n                    exposure_count, correct_count, wrong_count, streak, lapse_count,\n                    average_reaction_time_ms, last_attempt_at, next_due_at, last_error_tags_json, updated_at\n             FROM item_skill_progress\n             WHERE user_id = ?1 AND item_id = ?2 AND skill_dimension = ?3",
            params![input.user_id, input.item_id, input.skill_dimension],
            progress_row_to_record,
        )
        .optional()?;
    Ok(row)
}

#[tauri::command]
pub fn upsert_progress(db: State<'_, AppDb>, input: ProgressRecord) -> AppResult<()> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let last_error_tags_json = serde_json::to_string(&input.last_error_tags)?;
    conn.execute(
        "INSERT INTO item_skill_progress (\n             user_id, item_id, skill_dimension, state, mastery_score, stability, difficulty,\n             exposure_count, correct_count, wrong_count, streak, lapse_count,\n             average_reaction_time_ms, last_attempt_at, next_due_at, last_error_tags_json, updated_at\n         ) VALUES (\n             ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17\n         )\n         ON CONFLICT(user_id, item_id, skill_dimension) DO UPDATE SET\n             state = excluded.state,\n             mastery_score = excluded.mastery_score,\n             stability = excluded.stability,\n             difficulty = excluded.difficulty,\n             exposure_count = excluded.exposure_count,\n             correct_count = excluded.correct_count,\n             wrong_count = excluded.wrong_count,\n             streak = excluded.streak,\n             lapse_count = excluded.lapse_count,\n             average_reaction_time_ms = excluded.average_reaction_time_ms,\n             last_attempt_at = excluded.last_attempt_at,\n             next_due_at = excluded.next_due_at,\n             last_error_tags_json = excluded.last_error_tags_json,\n             updated_at = excluded.updated_at",
        params![
            input.user_id,
            input.item_id,
            input.skill_dimension,
            input.state,
            input.mastery_score,
            input.stability,
            input.difficulty,
            input.exposure_count,
            input.correct_count,
            input.wrong_count,
            input.streak,
            input.lapse_count,
            input.average_reaction_time_ms,
            input.last_attempt_at,
            input.next_due_at,
            last_error_tags_json,
            input.updated_at,
        ],
    )?;
    Ok(())
}

fn progress_row_to_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProgressRecord> {
    let last_error_tags_json: String = row.get(15)?;
    let last_error_tags: Vec<String> =
        serde_json::from_str(&last_error_tags_json).unwrap_or_default();
    Ok(ProgressRecord {
        user_id: row.get(0)?,
        item_id: row.get(1)?,
        skill_dimension: row.get(2)?,
        state: row.get(3)?,
        mastery_score: row.get(4)?,
        stability: row.get(5)?,
        difficulty: row.get(6)?,
        exposure_count: row.get(7)?,
        correct_count: row.get(8)?,
        wrong_count: row.get(9)?,
        streak: row.get(10)?,
        lapse_count: row.get(11)?,
        average_reaction_time_ms: row.get(12)?,
        last_attempt_at: row.get(13)?,
        next_due_at: row.get(14)?,
        last_error_tags,
        updated_at: row.get(16)?,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttemptListInput {
    pub user_id: String,
    pub item_id: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttemptEventRow {
    pub id: String,
    pub session_id: String,
    pub item_id: String,
    pub answer_mode: String,
    pub is_correct: bool,
    pub score: f64,
    pub reaction_time_ms: i64,
    pub error_tags: Vec<String>,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordAttemptResultInput {
    pub attempt: AttemptEventInput,
    pub progress: ProgressRecord,
}

/// Single-transaction write of an attempt event + the corresponding progress upsert.
/// GameSessionService uses this so a partial failure doesn't leave attempt_events with no
/// matching progress row (or vice versa); the immutable event log can still be replayed to
/// rebuild progress, but we'd rather not create the inconsistency in the first place.
#[tauri::command]
pub fn record_attempt_result(
    db: State<'_, AppDb>,
    input: RecordAttemptResultInput,
) -> AppResult<()> {
    let mut conn = db
        .conn
        .lock()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let tx = conn.transaction()?;
    let now = Utc::now().to_rfc3339();
    let chunk_order_json = input
        .attempt
        .chunk_order
        .as_ref()
        .map(serde_json::to_string)
        .transpose()?;
    tx.execute(
        "INSERT INTO attempt_events (\n             id, session_id, user_id, task_id, item_id, game_type, skill_dimension,\n             answer_mode, raw_input, committed_input, selected_option_id, chunk_order_json,\n             is_correct, score, reaction_time_ms, used_hint, error_tags_json, explanation, created_at\n         ) VALUES (\n             ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19\n         )",
        params![
            input.attempt.id,
            input.attempt.session_id,
            input.attempt.user_id,
            input.attempt.task_id,
            input.attempt.item_id,
            input.attempt.game_type,
            input.attempt.skill_dimension,
            input.attempt.answer_mode,
            input.attempt.raw_input,
            input.attempt.committed_input,
            input.attempt.selected_option_id,
            chunk_order_json,
            input.attempt.is_correct as i64,
            input.attempt.score,
            input.attempt.reaction_time_ms,
            input.attempt.used_hint as i64,
            serde_json::to_string(&input.attempt.error_tags)?,
            input.attempt.explanation,
            now,
        ],
    )?;
    let last_error_tags_json = serde_json::to_string(&input.progress.last_error_tags)?;
    tx.execute(
        "INSERT INTO item_skill_progress (\n             user_id, item_id, skill_dimension, state, mastery_score, stability, difficulty,\n             exposure_count, correct_count, wrong_count, streak, lapse_count,\n             average_reaction_time_ms, last_attempt_at, next_due_at, last_error_tags_json, updated_at\n         ) VALUES (\n             ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17\n         )\n         ON CONFLICT(user_id, item_id, skill_dimension) DO UPDATE SET\n             state = excluded.state,\n             mastery_score = excluded.mastery_score,\n             stability = excluded.stability,\n             difficulty = excluded.difficulty,\n             exposure_count = excluded.exposure_count,\n             correct_count = excluded.correct_count,\n             wrong_count = excluded.wrong_count,\n             streak = excluded.streak,\n             lapse_count = excluded.lapse_count,\n             average_reaction_time_ms = excluded.average_reaction_time_ms,\n             last_attempt_at = excluded.last_attempt_at,\n             next_due_at = excluded.next_due_at,\n             last_error_tags_json = excluded.last_error_tags_json,\n             updated_at = excluded.updated_at",
        params![
            input.progress.user_id,
            input.progress.item_id,
            input.progress.skill_dimension,
            input.progress.state,
            input.progress.mastery_score,
            input.progress.stability,
            input.progress.difficulty,
            input.progress.exposure_count,
            input.progress.correct_count,
            input.progress.wrong_count,
            input.progress.streak,
            input.progress.lapse_count,
            input.progress.average_reaction_time_ms,
            input.progress.last_attempt_at,
            input.progress.next_due_at,
            last_error_tags_json,
            input.progress.updated_at,
        ],
    )?;
    tx.commit()?;
    Ok(())
}

#[tauri::command]
pub fn list_recent_attempts(
    db: State<'_, AppDb>,
    input: AttemptListInput,
) -> AppResult<Vec<AttemptEventRow>> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let limit = input.limit.unwrap_or(50).clamp(1, 1000);
    let rows: Vec<AttemptEventRow> = if let Some(item_id) = input.item_id.as_ref() {
        let mut stmt = conn.prepare(
            "SELECT id, session_id, item_id, answer_mode, is_correct, score, reaction_time_ms, error_tags_json, created_at\n             FROM attempt_events WHERE user_id = ?1 AND item_id = ?2 ORDER BY created_at DESC LIMIT ?3",
        )?;
        let mapped = stmt.query_map(params![input.user_id, item_id, limit], attempt_row_from)?;
        mapped.collect::<Result<_, _>>()?
    } else {
        let mut stmt = conn.prepare(
            "SELECT id, session_id, item_id, answer_mode, is_correct, score, reaction_time_ms, error_tags_json, created_at\n             FROM attempt_events WHERE user_id = ?1 ORDER BY created_at DESC LIMIT ?2",
        )?;
        let mapped = stmt.query_map(params![input.user_id, limit], attempt_row_from)?;
        mapped.collect::<Result<_, _>>()?
    };
    Ok(rows)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListProgressInput {
    pub user_id: String,
    #[serde(default)]
    pub skill_dimension: Option<String>,
    #[serde(default)]
    pub limit: Option<i64>,
}

#[tauri::command]
pub fn list_progress(
    db: State<'_, AppDb>,
    input: ListProgressInput,
) -> AppResult<Vec<ProgressRecord>> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let limit = input.limit.unwrap_or(500).clamp(1, 5000);
    let mut rows: Vec<ProgressRecord> = Vec::new();
    if let Some(skill) = input.skill_dimension.as_ref() {
        let mut stmt = conn.prepare(
            "SELECT user_id, item_id, skill_dimension, state, mastery_score, stability, difficulty,\n                    exposure_count, correct_count, wrong_count, streak, lapse_count,\n                    average_reaction_time_ms, last_attempt_at, next_due_at, last_error_tags_json, updated_at\n             FROM item_skill_progress WHERE user_id = ?1 AND skill_dimension = ?2\n             ORDER BY mastery_score ASC LIMIT ?3",
        )?;
        let mapped =
            stmt.query_map(params![input.user_id, skill, limit], progress_row_to_record)?;
        for r in mapped {
            rows.push(r?);
        }
    } else {
        let mut stmt = conn.prepare(
            "SELECT user_id, item_id, skill_dimension, state, mastery_score, stability, difficulty,\n                    exposure_count, correct_count, wrong_count, streak, lapse_count,\n                    average_reaction_time_ms, last_attempt_at, next_due_at, last_error_tags_json, updated_at\n             FROM item_skill_progress WHERE user_id = ?1\n             ORDER BY mastery_score ASC LIMIT ?2",
        )?;
        let mapped = stmt.query_map(params![input.user_id, limit], progress_row_to_record)?;
        for r in mapped {
            rows.push(r?);
        }
    }
    Ok(rows)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AggregateErrorTagsInput {
    pub user_id: String,
    /// Look-back window in days. 0 = all-time.
    #[serde(default = "default_days")]
    pub days: i64,
    #[serde(default)]
    pub limit: Option<i64>,
}

fn default_days() -> i64 {
    7
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorTagAggregate {
    pub tag: String,
    pub count: i64,
}

/// Aggregate error tags from `attempt_events.error_tags_json` over the last N days.
/// Sprint 5 surfaces this on the home page (top error tags) and the mistakes page.
#[tauri::command]
pub fn aggregate_recent_error_tags(
    db: State<'_, AppDb>,
    input: AggregateErrorTagsInput,
) -> AppResult<Vec<ErrorTagAggregate>> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let cutoff = if input.days > 0 {
        Utc::now()
            .checked_sub_signed(chrono::Duration::days(input.days))
            .map(|d| d.to_rfc3339())
            .unwrap_or_default()
    } else {
        "0000-01-01T00:00:00Z".to_string()
    };
    let mut stmt = conn.prepare(
        "SELECT error_tags_json FROM attempt_events WHERE user_id = ?1 AND created_at >= ?2",
    )?;
    let rows = stmt.query_map(params![input.user_id, cutoff], |row| {
        let s: String = row.get(0)?;
        Ok(s)
    })?;
    let mut counts = std::collections::HashMap::<String, i64>::new();
    for r in rows {
        let s = r?;
        let tags: Vec<String> = serde_json::from_str(&s).unwrap_or_default();
        for tag in tags {
            *counts.entry(tag).or_insert(0) += 1;
        }
    }
    let mut out: Vec<ErrorTagAggregate> = counts
        .into_iter()
        .map(|(tag, count)| ErrorTagAggregate { tag, count })
        .collect();
    out.sort_by_key(|e| std::cmp::Reverse(e.count));
    let limit = input.limit.unwrap_or(50).clamp(1, 500) as usize;
    out.truncate(limit);
    Ok(out)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttemptsBySessionInput {
    pub session_id: String,
}

#[tauri::command]
pub fn list_attempts_by_session(
    db: State<'_, AppDb>,
    input: AttemptsBySessionInput,
) -> AppResult<Vec<AttemptEventRow>> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let mut stmt = conn.prepare(
        "SELECT id, session_id, item_id, answer_mode, is_correct, score, reaction_time_ms, error_tags_json, created_at\n         FROM attempt_events WHERE session_id = ?1 ORDER BY created_at ASC",
    )?;
    let rows = stmt.query_map(params![input.session_id], attempt_row_from)?;
    let out: Vec<AttemptEventRow> = rows.collect::<Result<_, _>>()?;
    Ok(out)
}

fn attempt_row_from(row: &rusqlite::Row<'_>) -> rusqlite::Result<AttemptEventRow> {
    let error_tags_json: String = row.get(7)?;
    let error_tags: Vec<String> = serde_json::from_str(&error_tags_json).unwrap_or_default();
    let is_correct_int: i64 = row.get(4)?;
    Ok(AttemptEventRow {
        id: row.get(0)?,
        session_id: row.get(1)?,
        item_id: row.get(2)?,
        answer_mode: row.get(3)?,
        is_correct: is_correct_int != 0,
        score: row.get(5)?,
        reaction_time_ms: row.get(6)?,
        error_tags,
        created_at: row.get(8)?,
    })
}
