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
    let item_count: i64 = conn.query_row(
        "SELECT COUNT(*)
         FROM learning_items i
         JOIN content_packs p ON p.id = i.source_pack_id
         WHERE p.enabled = 1",
        [],
        |row| row.get(0),
    )?;
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
    #[serde(rename = "type")]
    pub item_type: String,
    pub surface: String,
    pub kana: String,
    pub romaji: Vec<String>,
    pub jlpt: Option<String>,
    pub tags: Vec<String>,
    pub skill_tags: Vec<String>,
    pub error_tags: Vec<String>,
    pub accepted_kana: Vec<String>,
    pub meanings_zh: Vec<String>,
    pub confusable_item_ids: Vec<String>,
    pub source_pack_id: String,
    /// Raw JSON for type-specific extras (sentence chunks/acceptedOrders/zhPrompt for v0.8.3
    /// SentenceItems). Word-typed rows leave this as `None`.
    pub extras_json: Option<String>,
}

#[tauri::command]
pub fn list_items(db: State<'_, AppDb>, limit: Option<i64>) -> AppResult<Vec<DevItemRow>> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let limit = limit.unwrap_or(50).clamp(1, 5000);
    let mut stmt = conn.prepare(
        "SELECT i.id, i.type, i.surface, i.kana, i.romaji_json, i.jlpt, i.tags_json, \
                i.skill_tags_json, i.error_tags_json, i.accepted_kana_json, \
                i.meanings_zh_json, i.source_pack_id, i.extras_json \
         FROM learning_items i \
         JOIN content_packs p ON p.id = i.source_pack_id \
         WHERE p.enabled = 1 \
         ORDER BY i.id LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit], |row| {
        let id: String = row.get(0)?;
        let romaji_json: String = row.get(4)?;
        let tags_json: String = row.get(6)?;
        let skill_tags_json: String = row.get(7)?;
        let error_tags_json: Option<String> = row.get(8)?;
        let accepted_kana_json: Option<String> = row.get(9)?;
        let meanings_zh_json: String = row.get(10)?;
        let romaji: Vec<String> = serde_json::from_str(&romaji_json).unwrap_or_default();
        Ok(DevItemRow {
            id: id.clone(),
            item_type: row.get(1)?,
            surface: row.get(2)?,
            kana: row.get(3)?,
            romaji,
            jlpt: row.get(5)?,
            tags: serde_json::from_str(&tags_json).unwrap_or_default(),
            skill_tags: serde_json::from_str(&skill_tags_json).unwrap_or_default(),
            error_tags: error_tags_json
                .as_deref()
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or_default(),
            accepted_kana: accepted_kana_json
                .as_deref()
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or_default(),
            meanings_zh: serde_json::from_str(&meanings_zh_json).unwrap_or_default(),
            // confusables joined separately to keep the row shape stable when zero peers.
            confusable_item_ids: Vec::new(),
            source_pack_id: row.get(11)?,
            extras_json: row.get(12)?,
        })
    })?;
    let mut out = Vec::with_capacity(limit as usize);
    for r in rows {
        out.push(r?);
    }

    // Backfill confusable_item_ids per item — we run a single query and partition into the
    // rows. This avoids N+1 queries while still letting the projection above be a single
    // SELECT.
    if !out.is_empty() {
        let mut conf_stmt = conn.prepare(
            "SELECT c.item_id, c.confusable_item_id FROM item_confusables c \
             JOIN learning_items i ON i.id = c.item_id \
             JOIN content_packs p ON p.id = i.source_pack_id \
             WHERE p.enabled = 1",
        )?;
        let mapped = conf_stmt.query_map([], |row| {
            let item_id: String = row.get(0)?;
            let confusable: String = row.get(1)?;
            Ok((item_id, confusable))
        })?;
        let mut by_item: std::collections::HashMap<String, Vec<String>> =
            std::collections::HashMap::new();
        for r in mapped {
            let (item_id, confusable) = r?;
            by_item.entry(item_id).or_default().push(confusable);
        }
        for row in out.iter_mut() {
            if let Some(list) = by_item.remove(&row.id) {
                row.confusable_item_ids = list;
            }
        }
    }
    Ok(out)
}

// ────────────────────────────────────────────────────────────────────────
// seed_test_pack
// ────────────────────────────────────────────────────────────────────────
//
// Embedded at compile time so a packaged build doesn't need the repo on disk. When we move
// content to a real installer/resource pipeline (Sprint 4+), this will switch to reading from
// `tauri::path::resource_dir`. v0.9.0 bundles the phase1 v1.1.0 corpus: 10 word packs + 1
// sentence pack (1534 word items + 120 sentences total) so every game boots SQLite-driven
// without manual content:import.
const SEED_PACK_N5_CORE: &str =
    include_str!("../../../../content/official/official-phase1-n5-core.json");
const SEED_PACK_HOME: &str =
    include_str!("../../../../content/official/official-phase1-home-household.json");
const SEED_PACK_TRANSPORT: &str =
    include_str!("../../../../content/official/official-phase1-transport-travel.json");
const SEED_PACK_FOOD: &str =
    include_str!("../../../../content/official/official-phase1-food-dining.json");
const SEED_PACK_CULTURE: &str =
    include_str!("../../../../content/official/official-phase1-japan-culture-facilities.json");
const SEED_PACK_SHOPPING: &str =
    include_str!("../../../../content/official/official-phase1-shopping-service.json");
const SEED_PACK_SCHOOL_WORK: &str =
    include_str!("../../../../content/official/official-phase1-school-work-office.json");
const SEED_PACK_HEALTH: &str =
    include_str!("../../../../content/official/official-phase1-health-emergency.json");
const SEED_PACK_DIGITAL: &str =
    include_str!("../../../../content/official/official-phase1-digital-communication.json");
const SEED_PACK_ERROR_LAB: &str =
    include_str!("../../../../content/official/official-phase1-error-lab.json");
const SEED_PACK_SENTENCES: &str =
    include_str!("../../../../content/official/official-phase1-sentences.json");

/// Word-shaped packs (regular `PackInput`). Order is the seed order; the first id is reported
/// back as `primary_pack_id` for the dev-page UI.
const SEED_WORD_PACK_BLOBS: [(&str, &str); 10] = [
    ("n5-core", SEED_PACK_N5_CORE),
    ("home-household", SEED_PACK_HOME),
    ("transport-travel", SEED_PACK_TRANSPORT),
    ("food-dining", SEED_PACK_FOOD),
    ("japan-culture-facilities", SEED_PACK_CULTURE),
    ("shopping-service", SEED_PACK_SHOPPING),
    ("school-work-office", SEED_PACK_SCHOOL_WORK),
    ("health-emergency", SEED_PACK_HEALTH),
    ("digital-communication", SEED_PACK_DIGITAL),
    ("error-lab", SEED_PACK_ERROR_LAB),
];

const FOUNDATION_PACK_IDS: [&str; 11] = [
    "official-phase1-n5-core",
    "official-phase1-home-household",
    "official-phase1-transport-travel",
    "official-phase1-food-dining",
    "official-phase1-japan-culture-facilities",
    "official-phase1-shopping-service",
    "official-phase1-school-work-office",
    "official-phase1-health-emergency",
    "official-phase1-digital-communication",
    "official-phase1-error-lab",
    "official-phase1-sentences",
];

/// v0.8 foundations packs that the v0.9 phase1 corpus replaces. ensure_seed_for_db retires these
/// packs by disabling them, but does not delete their learning_items. Attempt events are immutable,
/// and old attempts may still reference legacy-only item ids.
const LEGACY_PACK_IDS: [&str; 5] = [
    "official-n5-basic-mini",
    "official-daily-life-foundations-500",
    "confusables-foundations",
    "audio-discrim-foundations",
    "sentences-foundations",
];

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
    /// Pre-serialised JSON blob for type-specific extras. Word packs always leave this
    /// `None`; sentence translation populates it with `{chunks, acceptedOrders, zhPrompt}`.
    #[serde(default, skip_deserializing)]
    extras_json: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SentencePackInput {
    id: String,
    name: String,
    version: String,
    #[serde(default)]
    author: Option<String>,
    #[serde(default = "default_locale")]
    locale: String,
    #[serde(default)]
    description: Option<String>,
    sentences: Vec<SentenceItemInput>,
}

#[derive(Debug, Deserialize, Serialize)]
struct SentenceItemInput {
    id: String,
    #[serde(rename = "type")]
    item_type: String,
    surface: String,
    chunks: Vec<SentenceChunkInput>,
    #[serde(rename = "zhPrompt")]
    zh_prompt: String,
    #[serde(default, rename = "acceptedOrders")]
    accepted_orders: Vec<Vec<String>>,
    #[serde(default)]
    jlpt: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default, rename = "skillTags")]
    skill_tags: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
struct SentenceChunkInput {
    id: String,
    text: String,
    kana: String,
    romaji: Vec<String>,
    pos: String,
    #[serde(default, rename = "acceptedSurfaces")]
    accepted_surfaces: Option<Vec<String>>,
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
    /// First pack id seeded (currently `official-phase1-n5-core`); kept for the dev-page UI
    /// which still shows a single representative pack id.
    pub pack_id: String,
    pub items_upserted: u32,
    pub packs_upserted: u32,
}

#[tauri::command]
pub fn seed_test_pack(db: State<'_, AppDb>) -> AppResult<SeedTestPackResult> {
    seed_foundation_packs(db.inner())
}

#[tauri::command]
pub fn ensure_seed(db: State<'_, AppDb>) -> AppResult<SeedTestPackResult> {
    ensure_seed_for_db(db.inner())
}

pub fn ensure_seed_for_db(db: &AppDb) -> AppResult<SeedTestPackResult> {
    retire_legacy_packs(db)?;
    let existing_pack_count = {
        let conn = db
            .conn
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let placeholders: String = (1..=FOUNDATION_PACK_IDS.len())
            .map(|i| format!("?{i}"))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "SELECT COUNT(DISTINCT source_pack_id)
             FROM learning_items
             WHERE source_pack_id IN ({placeholders})"
        );
        conn.query_row(
            &sql,
            rusqlite::params_from_iter(FOUNDATION_PACK_IDS.iter()),
            |row| row.get::<_, i64>(0),
        )?
    };
    if existing_pack_count == FOUNDATION_PACK_IDS.len() as i64 {
        return Ok(SeedTestPackResult {
            pack_id: FOUNDATION_PACK_IDS[0].to_string(),
            items_upserted: 0,
            packs_upserted: 0,
        });
    }
    seed_foundation_packs(db)
}

/// Hide legacy packs from runtime selectors while preserving the immutable attempt log. New v0.9
/// packs can still upsert any reused stable item ids in place; legacy-only item ids remain as
/// referential anchors for old attempt_events.
fn retire_legacy_packs(db: &AppDb) -> AppResult<u32> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let placeholders: String = (1..=LEGACY_PACK_IDS.len())
        .map(|i| format!("?{i}"))
        .collect::<Vec<_>>()
        .join(", ");

    let retired = conn.execute(
        &format!(
            "UPDATE content_packs SET enabled = 0 WHERE id IN ({placeholders}) AND enabled != 0"
        ),
        rusqlite::params_from_iter(LEGACY_PACK_IDS.iter()),
    )?;

    if retired > 0 {
        eprintln!("kana-typing: retired {} legacy foundation packs", retired);
    }
    Ok(retired as u32)
}

fn seed_foundation_packs(db: &AppDb) -> AppResult<SeedTestPackResult> {
    let mut word_packs: Vec<PackInput> = Vec::with_capacity(SEED_WORD_PACK_BLOBS.len());
    for (label, blob) in SEED_WORD_PACK_BLOBS.iter() {
        let pack: PackInput = serde_json::from_str(blob)
            .map_err(|e| AppError::InvalidPack(format!("{label} pack malformed: {e}")))?;
        word_packs.push(pack);
    }
    let sentence_pack_raw: SentencePackInput = serde_json::from_str(SEED_PACK_SENTENCES)
        .map_err(|e| AppError::InvalidPack(format!("sentences pack malformed: {e}")))?;
    let sentence_pack = sentence_pack_to_word_pack(sentence_pack_raw)?;

    let mut conn = db
        .conn
        .lock()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let mut total_items: u32 = 0;
    let primary_pack_id = word_packs[0].id.clone();
    for pack in &word_packs {
        total_items += upsert_pack(&tx, pack, &now)?;
    }
    total_items += upsert_pack(&tx, &sentence_pack, &now)?;

    tx.commit()?;

    Ok(SeedTestPackResult {
        pack_id: primary_pack_id,
        items_upserted: total_items,
        packs_upserted: (word_packs.len() + 1) as u32,
    })
}

/// Map a SentencePack into the regular PackInput shape so a single upsert path handles every
/// foundations pack. Each sentence becomes a learning_items row with type='sentence', the
/// chunks merged into kana/romaji, and chunks/acceptedOrders/zhPrompt serialised into
/// extras_json. The extras blob is what RiverJump reverses on the TS side to recover the
/// original SentenceItem shape.
fn sentence_pack_to_word_pack(p: SentencePackInput) -> AppResult<PackInput> {
    let mut items: Vec<ItemInput> = Vec::with_capacity(p.sentences.len());
    for s in p.sentences {
        let merged_kana: String = s.chunks.iter().map(|c| c.kana.as_str()).collect();
        let merged_romaji: String = s
            .chunks
            .iter()
            .map(|c| c.romaji.first().map(String::as_str).unwrap_or(""))
            .collect::<Vec<_>>()
            .join("");
        let extras = serde_json::json!({
            "chunks": &s.chunks,
            "acceptedOrders": &s.accepted_orders,
            "zhPrompt": &s.zh_prompt,
        });
        let extras_json = serde_json::to_string(&extras)?;
        items.push(ItemInput {
            id: s.id,
            item_type: s.item_type,
            surface: s.surface,
            kana: merged_kana,
            romaji: vec![merged_romaji],
            meanings_zh: vec![s.zh_prompt.clone()],
            meanings_en: None,
            pos: None,
            jlpt: s.jlpt,
            tags: s.tags,
            skill_tags: s.skill_tags,
            error_tags: None,
            accepted_surfaces: None,
            accepted_kana: None,
            examples: Vec::new(),
            audio_refs: Vec::new(),
            confusable_item_ids: Vec::new(),
            extras_json: Some(extras_json),
        });
    }
    Ok(PackInput {
        id: p.id,
        name: p.name,
        version: p.version,
        author: p.author,
        locale: p.locale,
        description: p.description,
        items,
    })
}

fn upsert_pack(tx: &rusqlite::Transaction<'_>, pack: &PackInput, now: &str) -> AppResult<u32> {
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
        let skill_tags_json =
            serde_json::to_string(&normalize_learning_vocab_tags(&item.skill_tags))?;
        let error_tags_json = item
            .error_tags
            .as_ref()
            .map(|tags| serde_json::to_string(&normalize_learning_vocab_tags(tags)))
            .transpose()?;
        tx.execute(
            "INSERT INTO learning_items (
                id, type, surface, kana, romaji_json, meanings_zh_json, meanings_en_json,
                pos, jlpt, tags_json, skill_tags_json, error_tags_json,
                accepted_surfaces_json, accepted_kana_json,
                source_pack_id, quality, created_at, updated_at, extras_json
             ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, 'official', ?16, ?17, ?18
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
                updated_at = excluded.updated_at,
                extras_json = excluded.extras_json",
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
                skill_tags_json,
                error_tags_json,
                item.accepted_surfaces.as_ref().map(serde_json::to_string).transpose()?,
                item.accepted_kana.as_ref().map(serde_json::to_string).transpose()?,
                pack.id,
                now,
                now,
                item.extras_json,
            ],
        )?;
        items_upserted += 1;

        tx.execute(
            "DELETE FROM item_examples WHERE item_id = ?1",
            params![item.id],
        )?;
        for ex in &item.examples {
            // v0.9.0: ON CONFLICT(id) DO UPDATE because re-seeding into a DB that already
            // contains the legacy v0.8 packs can collide on example.id values that the new
            // phase1 corpus reuses (e.g. `ex-machi-1`). The legacy row's owning item is gone
            // from `learning_items` once its source_pack drops out of the seed list, but the
            // example row sticks around because nothing CASCADEs from learning_items → examples.
            tx.execute(
                "INSERT INTO item_examples (id, item_id, ja, kana, zh, target_surface, target_kana, audio_ref, tags_json, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                 ON CONFLICT(id) DO UPDATE SET
                     item_id = excluded.item_id,
                     ja = excluded.ja,
                     kana = excluded.kana,
                     zh = excluded.zh,
                     target_surface = excluded.target_surface,
                     target_kana = excluded.target_kana,
                     audio_ref = excluded.audio_ref,
                     tags_json = excluded.tags_json",
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

    Ok(items_upserted)
}

fn normalize_learning_vocab_tags(tags: &[String]) -> Vec<String> {
    tags.iter()
        .map(|tag| normalize_learning_vocab_tag(tag))
        .collect()
}

fn normalize_learning_vocab_tag(tag: &str) -> String {
    let normalized = tag.replace('-', "_");
    match normalized.as_str() {
        "particle_misuse" => "particle_error".to_string(),
        _ => normalized,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_db(scope: &str) -> AppDb {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock should be after epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("kana-typing-{scope}-{unique}"));
        crate::db::init(&dir).expect("test db should initialize")
    }

    fn fresh_seeded_db(scope: &str) -> AppDb {
        let db = fresh_db(scope);
        ensure_seed_for_db(&db).expect("seed should succeed");
        db
    }

    fn pick_real_item_id(db: &AppDb, pack_id: &str) -> String {
        let conn = db.conn.lock().expect("lock");
        conn.query_row(
            "SELECT id FROM learning_items WHERE source_pack_id = ?1 LIMIT 1",
            params![pack_id],
            |row| row.get::<_, String>(0),
        )
        .expect("pack should have at least one item")
    }

    #[test]
    fn ensure_seed_is_idempotent() {
        let db = fresh_seeded_db("ensure-seed");

        let second = ensure_seed_for_db(&db).expect("second ensure_seed should no-op");
        assert_eq!(second.packs_upserted, 0);
        assert_eq!(second.items_upserted, 0);
    }

    #[test]
    fn ensure_seed_retires_legacy_pack_without_deleting_attempt_events() {
        let db = fresh_db("legacy-retire");
        let now = Utc::now().to_rfc3339();
        {
            let conn = db.conn.lock().expect("lock");
            conn.execute(
                "INSERT INTO content_packs (id, name, version, locale, quality, imported_at, enabled) \
                 VALUES (?1, 'legacy', '0.8.0', 'zh-CN', 'official', ?2, 1)",
                params!["official-n5-basic-mini", now],
            )
            .expect("legacy pack");
            conn.execute(
                "INSERT INTO learning_items (
                    id, type, surface, kana, romaji_json, meanings_zh_json, tags_json,
                    skill_tags_json, source_pack_id, quality, created_at, updated_at
                 ) VALUES (
                    'legacy-only-item', 'word', '旧', 'きゅう', '[\"kyuu\"]', '[\"旧\"]', '[]',
                    '[\"kana_typing\"]', 'official-n5-basic-mini', 'official', ?1, ?1
                 )",
                params![now],
            )
            .expect("legacy item");
            conn.execute(
                "INSERT INTO game_sessions (id, user_id, game_type, started_at, status) \
                 VALUES ('legacy-session', 'u1', 'mole_story', ?1, 'finished')",
                params![now],
            )
            .expect("session");
            conn.execute(
                "INSERT INTO attempt_events (
                    id, session_id, user_id, task_id, item_id, game_type, skill_dimension,
                    answer_mode, is_correct, score, reaction_time_ms, used_hint, error_tags_json,
                    created_at
                 ) VALUES (
                    'legacy-attempt', 'legacy-session', 'u1', 'task-1', 'legacy-only-item',
                    'mole_story', 'kana_typing', 'romaji_to_kana', 0, 0.2, 1500, 0,
                    '[\"long_vowel_error\"]', ?1
                 )",
                params![now],
            )
            .expect("attempt");
        }

        ensure_seed_for_db(&db).expect("seed should preserve legacy references");

        let conn = db.conn.lock().expect("lock");
        let attempt_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM attempt_events WHERE id = 'legacy-attempt'",
                [],
                |row| row.get(0),
            )
            .expect("attempt count");
        let legacy_enabled: i64 = conn
            .query_row(
                "SELECT enabled FROM content_packs WHERE id = 'official-n5-basic-mini'",
                [],
                |row| row.get(0),
            )
            .expect("legacy pack enabled");
        assert_eq!(attempt_count, 1);
        assert_eq!(legacy_enabled, 0);
    }

    #[test]
    fn seeded_core_tags_are_canonical_snake_case() {
        let db = fresh_seeded_db("canonical-tags");
        let conn = db.conn.lock().expect("lock");
        let bad_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM learning_items \
                 WHERE skill_tags_json LIKE '%-%' \
                    OR IFNULL(error_tags_json, '') LIKE '%-%' \
                    OR skill_tags_json LIKE '%particle_misuse%' \
                    OR IFNULL(error_tags_json, '') LIKE '%particle_misuse%'",
                [],
                |row| row.get(0),
            )
            .expect("bad tag count");
        let particle_error_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM learning_items WHERE IFNULL(error_tags_json, '') LIKE '%particle_error%'",
                [],
                |row| row.get(0),
            )
            .expect("particle error count");
        assert_eq!(bad_count, 0);
        assert!(particle_error_count > 0);
    }

    #[test]
    fn record_study_view_increments_count_and_sets_timestamps() {
        let db = fresh_seeded_db("study-view");
        let item_id = pick_real_item_id(&db, "official-phase1-n5-core");

        for _ in 0..3 {
            record_study_view_inner(&db, "u1", &item_id).expect("view should succeed");
        }

        let conn = db.conn.lock().expect("lock");
        let (view_count, marked, first_at, last_at): (i64, i64, Option<String>, Option<String>) =
            conn.query_row(
                "SELECT view_count, marked, first_viewed_at, last_viewed_at \
                 FROM study_progress WHERE user_id = ?1 AND item_id = ?2",
                params!["u1", item_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("row exists");
        assert_eq!(view_count, 3);
        assert_eq!(marked, 0);
        assert!(first_at.is_some());
        assert!(last_at.is_some());
    }

    #[test]
    fn toggle_study_marked_round_trips() {
        let db = fresh_seeded_db("study-mark");
        let item_id = pick_real_item_id(&db, "official-phase1-n5-core");

        toggle_study_marked_inner(&db, "u1", &item_id, true).expect("mark");
        assert_eq!(read_marked(&db, "u1", &item_id), Some(1));
        toggle_study_marked_inner(&db, "u1", &item_id, false).expect("unmark");
        assert_eq!(read_marked(&db, "u1", &item_id), Some(0));
    }

    #[test]
    fn list_study_items_filter_separates_new_and_reviewed() {
        let db = fresh_seeded_db("study-filter");
        let pack_id = "official-phase1-n5-core";
        let item_id = pick_real_item_id(&db, pack_id);

        // view one item — moves it from `new` to `reviewed`.
        record_study_view_inner(&db, "u1", &item_id).expect("view");

        let new_only = list_study_items_inner(&db, pack_id, "u1", "new").expect("list new");
        let reviewed_only =
            list_study_items_inner(&db, pack_id, "u1", "reviewed").expect("list reviewed");

        assert!(
            !new_only.iter().any(|r| r.id == item_id),
            "viewed item should not be in 'new' bucket"
        );
        assert!(
            reviewed_only.iter().any(|r| r.id == item_id),
            "viewed item should appear in 'reviewed' bucket"
        );
    }

    #[test]
    fn list_study_packs_reports_studied_count() {
        let db = fresh_seeded_db("study-packs");
        let pack_id = "official-phase1-n5-core";
        let item_id = pick_real_item_id(&db, pack_id);
        record_study_view_inner(&db, "u1", &item_id).expect("view");

        let packs = list_study_packs_inner(&db, "u1").expect("list packs");
        let target = packs
            .iter()
            .find(|p| p.pack_id == pack_id)
            .expect("n5-core pack should be listed");
        assert!(target.total_count > 0);
        assert_eq!(target.studied_count, 1);
        assert!(
            !target.jlpt_breakdown.is_empty(),
            "n5-core should have JLPT distribution"
        );
        // First entry should be the lowest JLPT band present (N5 in this pack).
        assert_eq!(target.jlpt_breakdown[0].0, "N5");
    }

    // Helpers that mirror the #[tauri::command] entry points but skip the State<'_, AppDb>
    // wrapper, so unit tests can exercise the SQL paths without a full Tauri context.

    fn record_study_view_inner(db: &AppDb, user_id: &str, item_id: &str) -> AppResult<()> {
        let conn = db
            .conn
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO study_progress (user_id, item_id, view_count, marked, first_viewed_at, last_viewed_at) \
             VALUES (?1, ?2, 1, 0, ?3, ?3) \
             ON CONFLICT(user_id, item_id) DO UPDATE SET \
                 view_count = study_progress.view_count + 1, \
                 first_viewed_at = COALESCE(study_progress.first_viewed_at, excluded.first_viewed_at), \
                 last_viewed_at = excluded.last_viewed_at",
            params![user_id, item_id, now],
        )?;
        Ok(())
    }

    fn toggle_study_marked_inner(
        db: &AppDb,
        user_id: &str,
        item_id: &str,
        marked: bool,
    ) -> AppResult<()> {
        let conn = db
            .conn
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let now = Utc::now().to_rfc3339();
        let m = if marked { 1 } else { 0 };
        conn.execute(
            "INSERT INTO study_progress (user_id, item_id, view_count, marked, first_viewed_at, last_viewed_at) \
             VALUES (?1, ?2, 0, ?3, ?4, ?4) \
             ON CONFLICT(user_id, item_id) DO UPDATE SET \
                 marked = excluded.marked, \
                 first_viewed_at = COALESCE(study_progress.first_viewed_at, excluded.first_viewed_at), \
                 last_viewed_at = excluded.last_viewed_at",
            params![user_id, item_id, m, now],
        )?;
        Ok(())
    }

    fn read_marked(db: &AppDb, user_id: &str, item_id: &str) -> Option<i64> {
        let conn = db.conn.lock().expect("lock");
        conn.query_row(
            "SELECT marked FROM study_progress WHERE user_id = ?1 AND item_id = ?2",
            params![user_id, item_id],
            |row| row.get::<_, i64>(0),
        )
        .ok()
    }

    fn list_study_items_inner(
        db: &AppDb,
        pack_id: &str,
        user_id: &str,
        filter: &str,
    ) -> AppResult<Vec<StudyItemRow>> {
        // Exercise the same SQL the command builds. Duplicating a few lines is cleaner than
        // refactoring the command to take a State stand-in.
        let conn = db
            .conn
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let where_extra = match filter {
            "new" => "AND COALESCE(sp.view_count, 0) = 0 AND COALESCE(sp.marked, 0) = 0",
            "reviewed" => "AND (COALESCE(sp.view_count, 0) >= 1 OR COALESCE(sp.marked, 0) = 1)",
            _ => "",
        };
        let order_clause = if filter == "reviewed" {
            "ORDER BY sp.last_viewed_at ASC NULLS FIRST, i.id ASC"
        } else {
            "ORDER BY CASE i.jlpt \
                 WHEN 'N5' THEN 1 WHEN 'N4' THEN 2 WHEN 'N3' THEN 3 \
                 WHEN 'N2' THEN 4 WHEN 'N1' THEN 5 ELSE 6 END, \
             i.id ASC"
        };
        let sql = format!(
            "SELECT i.id, i.type, i.surface, i.kana, i.romaji_json, i.pos, i.jlpt, \
                    i.tags_json, i.meanings_zh_json, \
                    COALESCE(sp.view_count, 0), COALESCE(sp.marked, 0), sp.last_viewed_at \
             FROM learning_items i \
             JOIN content_packs p ON p.id = i.source_pack_id \
             LEFT JOIN study_progress sp ON sp.item_id = i.id AND sp.user_id = ?2 \
             WHERE i.source_pack_id = ?1 AND p.enabled = 1 {where_extra} {order_clause}"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![pack_id, user_id], |row| {
            let romaji_json: String = row.get(4)?;
            let tags_json: String = row.get(7)?;
            let meanings_zh_json: String = row.get(8)?;
            let marked_int: i64 = row.get(10)?;
            Ok(StudyItemRow {
                id: row.get(0)?,
                item_type: row.get(1)?,
                surface: row.get(2)?,
                kana: row.get(3)?,
                romaji: serde_json::from_str(&romaji_json).unwrap_or_default(),
                pos: row.get(5)?,
                jlpt: row.get(6)?,
                tags: serde_json::from_str(&tags_json).unwrap_or_default(),
                meanings_zh: serde_json::from_str(&meanings_zh_json).unwrap_or_default(),
                examples: Vec::new(),
                view_count: row.get(9)?,
                marked: marked_int != 0,
                last_viewed_at: row.get(11)?,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    fn list_study_packs_inner(db: &AppDb, user_id: &str) -> AppResult<Vec<StudyPackSummary>> {
        let conn = db
            .conn
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(
            "SELECT p.id, p.name, p.description, COUNT(i.id) AS total, \
                    COALESCE(SUM(CASE WHEN sp.view_count >= 1 OR sp.marked = 1 THEN 1 ELSE 0 END), 0) AS studied \
             FROM content_packs p \
             LEFT JOIN learning_items i ON i.source_pack_id = p.id \
             LEFT JOIN study_progress sp ON sp.item_id = i.id AND sp.user_id = ?1 \
             WHERE p.enabled = 1 \
             GROUP BY p.id",
        )?;
        let rows = stmt.query_map(params![user_id], |row| {
            Ok(StudyPackSummary {
                pack_id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                total_count: row.get(3)?,
                studied_count: row.get(4)?,
                jlpt_breakdown: Vec::new(),
            })
        })?;
        let mut summaries: Vec<StudyPackSummary> = rows.collect::<Result<_, _>>()?;

        let mut jlpt_stmt = conn.prepare(
            "SELECT source_pack_id, IFNULL(jlpt, '?'), COUNT(*) FROM learning_items GROUP BY source_pack_id, jlpt",
        )?;
        let jlpt_rows = jlpt_stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })?;
        let mut by_pack: std::collections::HashMap<String, Vec<(String, i64)>> =
            std::collections::HashMap::new();
        for r in jlpt_rows {
            let (pack_id, jlpt, count) = r?;
            by_pack.entry(pack_id).or_default().push((jlpt, count));
        }
        let order = |s: &str| match s {
            "N5" => 1,
            "N4" => 2,
            "N3" => 3,
            "N2" => 4,
            "N1" => 5,
            _ => 6,
        };
        for s in summaries.iter_mut() {
            if let Some(mut pairs) = by_pack.remove(&s.pack_id) {
                pairs.sort_by_key(|(j, _)| order(j));
                s.jlpt_breakdown = pairs;
            }
        }
        Ok(summaries)
    }
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
    pub game_type: String,
    pub skill_dimension: String,
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
            "SELECT id, session_id, item_id, game_type, skill_dimension, answer_mode, is_correct, score, reaction_time_ms, error_tags_json, created_at\n             FROM attempt_events WHERE user_id = ?1 AND item_id = ?2 ORDER BY created_at DESC LIMIT ?3",
        )?;
        let mapped = stmt.query_map(params![input.user_id, item_id, limit], attempt_row_from)?;
        mapped.collect::<Result<_, _>>()?
    } else {
        let mut stmt = conn.prepare(
            "SELECT id, session_id, item_id, game_type, skill_dimension, answer_mode, is_correct, score, reaction_time_ms, error_tags_json, created_at\n             FROM attempt_events WHERE user_id = ?1 ORDER BY created_at DESC LIMIT ?2",
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
        "SELECT id, session_id, item_id, game_type, skill_dimension, answer_mode, is_correct, score, reaction_time_ms, error_tags_json, created_at\n         FROM attempt_events WHERE session_id = ?1 ORDER BY created_at ASC",
    )?;
    let rows = stmt.query_map(params![input.session_id], attempt_row_from)?;
    let out: Vec<AttemptEventRow> = rows.collect::<Result<_, _>>()?;
    Ok(out)
}

fn attempt_row_from(row: &rusqlite::Row<'_>) -> rusqlite::Result<AttemptEventRow> {
    let error_tags_json: String = row.get(9)?;
    let error_tags: Vec<String> = serde_json::from_str(&error_tags_json).unwrap_or_default();
    let is_correct_int: i64 = row.get(6)?;
    Ok(AttemptEventRow {
        id: row.get(0)?,
        session_id: row.get(1)?,
        item_id: row.get(2)?,
        game_type: row.get(3)?,
        skill_dimension: row.get(4)?,
        answer_mode: row.get(5)?,
        is_correct: is_correct_int != 0,
        score: row.get(7)?,
        reaction_time_ms: row.get(8)?,
        error_tags,
        created_at: row.get(10)?,
    })
}

// ────────────────────────────────────────────────────────────────────────
// list_content_packs / set_pack_enabled
// (P0-4 ContentPacksPage backing)
// ────────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentPackRow {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: Option<String>,
    pub locale: String,
    pub quality: String,
    pub description: Option<String>,
    pub imported_at: String,
    pub enabled: bool,
    pub item_count: i64,
}

#[tauri::command]
pub fn list_content_packs(db: State<'_, AppDb>) -> AppResult<Vec<ContentPackRow>> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    // LEFT JOIN aggregate so packs without items still surface (e.g. an
    // import that hit a constraint partway through). The item_count comes
    // from the live items table, not a denormalised counter, so it tracks
    // post-import deletions correctly.
    let mut stmt = conn.prepare(
        "SELECT p.id, p.name, p.version, p.author, p.locale, p.quality, p.description, \
                p.imported_at, p.enabled, COUNT(i.id) AS item_count \
         FROM content_packs p \
         LEFT JOIN learning_items i ON i.source_pack_id = p.id \
         GROUP BY p.id \
         ORDER BY p.imported_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        let enabled_int: i64 = row.get(8)?;
        Ok(ContentPackRow {
            id: row.get(0)?,
            name: row.get(1)?,
            version: row.get(2)?,
            author: row.get(3)?,
            locale: row.get(4)?,
            quality: row.get(5)?,
            description: row.get(6)?,
            imported_at: row.get(7)?,
            enabled: enabled_int != 0,
            item_count: row.get(9)?,
        })
    })?;
    let out: Vec<ContentPackRow> = rows.collect::<Result<_, _>>()?;
    Ok(out)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetPackEnabledInput {
    pub pack_id: String,
    pub enabled: bool,
}

#[tauri::command]
pub fn set_pack_enabled(db: State<'_, AppDb>, input: SetPackEnabledInput) -> AppResult<()> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let updated: usize = conn.execute(
        "UPDATE content_packs SET enabled = ?1 WHERE id = ?2",
        params![if input.enabled { 1 } else { 0 }, input.pack_id],
    )?;
    if updated == 0 {
        return Err(AppError::Internal(format!(
            "no content_pack with id {}",
            input.pack_id
        )));
    }
    Ok(())
}

// ────────────────────────────────────────────────────────────────────────
// Study mode (v0.9.0) — non-game card-based learning surface.
// ────────────────────────────────────────────────────────────────────────
//
// Distinct from the game-side `item_skill_progress` table: study_progress only tracks
// "this user has been shown this card" — orthogonal to the per-skill mastery state.
// See migrations/006_study_progress.sql for the table.

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyPackSummary {
    pub pack_id: String,
    pub name: String,
    pub description: Option<String>,
    pub total_count: i64,
    /// view_count >= 1 OR marked = 1 — see migration 006 for the predicate.
    pub studied_count: i64,
    /// (jlpt, count) pairs in N5→N1 order, with `null`-jlpt items bucketed last as "?".
    pub jlpt_breakdown: Vec<(String, i64)>,
}

#[tauri::command]
pub fn list_study_packs(db: State<'_, AppDb>, user_id: String) -> AppResult<Vec<StudyPackSummary>> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| AppError::Internal(e.to_string()))?;

    // Two queries: (1) per-pack totals + studied_count, (2) per-pack JLPT distribution.
    // Simpler to merge in Rust than to do everything in one nested SELECT.
    let mut stmt = conn.prepare(
        "SELECT p.id, p.name, p.description, COUNT(i.id) AS total, \
                COALESCE(SUM(CASE WHEN sp.view_count >= 1 OR sp.marked = 1 THEN 1 ELSE 0 END), 0) AS studied \
         FROM content_packs p \
         LEFT JOIN learning_items i ON i.source_pack_id = p.id \
         LEFT JOIN study_progress sp ON sp.item_id = i.id AND sp.user_id = ?1 \
         WHERE p.enabled = 1 \
         GROUP BY p.id \
         ORDER BY total DESC",
    )?;
    let rows = stmt.query_map(params![user_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, i64>(4)?,
        ))
    })?;
    let mut summaries: Vec<StudyPackSummary> = Vec::new();
    for r in rows {
        let (pack_id, name, description, total, studied) = r?;
        summaries.push(StudyPackSummary {
            pack_id,
            name,
            description,
            total_count: total,
            studied_count: studied,
            jlpt_breakdown: Vec::new(),
        });
    }

    // JLPT distribution: aggregate once across all packs, then attach to each summary.
    let mut jlpt_stmt = conn.prepare(
        "SELECT source_pack_id, IFNULL(jlpt, '?'), COUNT(*) \
         FROM learning_items \
         GROUP BY source_pack_id, jlpt",
    )?;
    let jlpt_rows = jlpt_stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i64>(2)?,
        ))
    })?;
    let mut by_pack: std::collections::HashMap<String, Vec<(String, i64)>> =
        std::collections::HashMap::new();
    for r in jlpt_rows {
        let (pack_id, jlpt, count) = r?;
        by_pack.entry(pack_id).or_default().push((jlpt, count));
    }
    let jlpt_order = |s: &str| -> i32 {
        match s {
            "N5" => 1,
            "N4" => 2,
            "N3" => 3,
            "N2" => 4,
            "N1" => 5,
            _ => 6,
        }
    };
    for s in summaries.iter_mut() {
        if let Some(mut pairs) = by_pack.remove(&s.pack_id) {
            pairs.sort_by_key(|(j, _)| jlpt_order(j));
            s.jlpt_breakdown = pairs;
        }
    }

    Ok(summaries)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyExample {
    pub id: String,
    pub ja: String,
    pub kana: Option<String>,
    pub zh: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyItemRow {
    pub id: String,
    #[serde(rename = "type")]
    pub item_type: String,
    pub surface: String,
    pub kana: String,
    pub romaji: Vec<String>,
    pub pos: Option<String>,
    pub jlpt: Option<String>,
    pub tags: Vec<String>,
    pub meanings_zh: Vec<String>,
    pub examples: Vec<StudyExample>,
    pub view_count: i64,
    pub marked: bool,
    pub last_viewed_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListStudyItemsInput {
    pub pack_id: String,
    pub user_id: String,
    /// `"all"` | `"new"` | `"reviewed"`. Defaults to `"all"` if missing.
    #[serde(default)]
    pub filter: Option<String>,
}

#[tauri::command]
pub fn list_study_items(
    db: State<'_, AppDb>,
    input: ListStudyItemsInput,
) -> AppResult<Vec<StudyItemRow>> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let filter = input.filter.as_deref().unwrap_or("all");
    let where_extra = match filter {
        "new" => "AND COALESCE(sp.view_count, 0) = 0 AND COALESCE(sp.marked, 0) = 0",
        "reviewed" => "AND (COALESCE(sp.view_count, 0) >= 1 OR COALESCE(sp.marked, 0) = 1)",
        _ => "",
    };
    // Default order: JLPT ascending (N5 first), then item.id. Review mode prioritises the
    // longest-unseen so spaced revisits feel natural.
    let order_clause = if filter == "reviewed" {
        "ORDER BY sp.last_viewed_at ASC NULLS FIRST, i.id ASC"
    } else {
        "ORDER BY CASE i.jlpt \
             WHEN 'N5' THEN 1 WHEN 'N4' THEN 2 WHEN 'N3' THEN 3 \
             WHEN 'N2' THEN 4 WHEN 'N1' THEN 5 ELSE 6 END, \
         i.id ASC"
    };

    let sql = format!(
        "SELECT i.id, i.type, i.surface, i.kana, i.romaji_json, i.pos, i.jlpt, \
                i.tags_json, i.meanings_zh_json, \
                COALESCE(sp.view_count, 0), COALESCE(sp.marked, 0), sp.last_viewed_at \
         FROM learning_items i \
         JOIN content_packs p ON p.id = i.source_pack_id \
         LEFT JOIN study_progress sp ON sp.item_id = i.id AND sp.user_id = ?2 \
         WHERE i.source_pack_id = ?1 AND p.enabled = 1 {where_extra} \
         {order_clause}"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![input.pack_id, input.user_id], |row| {
        let romaji_json: String = row.get(4)?;
        let tags_json: String = row.get(7)?;
        let meanings_zh_json: String = row.get(8)?;
        let marked_int: i64 = row.get(10)?;
        Ok(StudyItemRow {
            id: row.get(0)?,
            item_type: row.get(1)?,
            surface: row.get(2)?,
            kana: row.get(3)?,
            romaji: serde_json::from_str(&romaji_json).unwrap_or_default(),
            pos: row.get(5)?,
            jlpt: row.get(6)?,
            tags: serde_json::from_str(&tags_json).unwrap_or_default(),
            meanings_zh: serde_json::from_str(&meanings_zh_json).unwrap_or_default(),
            examples: Vec::new(),
            view_count: row.get(9)?,
            marked: marked_int != 0,
            last_viewed_at: row.get(11)?,
        })
    })?;
    let mut out: Vec<StudyItemRow> = rows.collect::<Result<_, _>>()?;
    if out.is_empty() {
        return Ok(out);
    }

    // Examples backfill — single SELECT keyed by item_id, partition into rows. Same pattern as
    // list_items's confusables backfill.
    let mut ex_stmt = conn.prepare(
        "SELECT e.item_id, e.id, e.ja, e.kana, e.zh \
         FROM item_examples e \
         JOIN learning_items i ON i.id = e.item_id \
         WHERE i.source_pack_id = ?1",
    )?;
    let ex_rows = ex_stmt.query_map(params![input.pack_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            StudyExample {
                id: row.get(1)?,
                ja: row.get(2)?,
                kana: row.get(3)?,
                zh: row.get(4)?,
            },
        ))
    })?;
    let mut by_item: std::collections::HashMap<String, Vec<StudyExample>> =
        std::collections::HashMap::new();
    for r in ex_rows {
        let (item_id, ex) = r?;
        by_item.entry(item_id).or_default().push(ex);
    }
    for row in out.iter_mut() {
        if let Some(list) = by_item.remove(&row.id) {
            row.examples = list;
        }
    }

    Ok(out)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyMutationInput {
    pub user_id: String,
    pub item_id: String,
}

#[tauri::command]
pub fn record_study_view(db: State<'_, AppDb>, input: StudyMutationInput) -> AppResult<()> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO study_progress (user_id, item_id, view_count, marked, first_viewed_at, last_viewed_at) \
         VALUES (?1, ?2, 1, 0, ?3, ?3) \
         ON CONFLICT(user_id, item_id) DO UPDATE SET \
             view_count = study_progress.view_count + 1, \
             first_viewed_at = COALESCE(study_progress.first_viewed_at, excluded.first_viewed_at), \
             last_viewed_at = excluded.last_viewed_at",
        params![input.user_id, input.item_id, now],
    )?;
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToggleStudyMarkedInput {
    pub user_id: String,
    pub item_id: String,
    pub marked: bool,
}

#[tauri::command]
pub fn toggle_study_marked(db: State<'_, AppDb>, input: ToggleStudyMarkedInput) -> AppResult<()> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let now = Utc::now().to_rfc3339();
    let marked_int = if input.marked { 1 } else { 0 };
    conn.execute(
        "INSERT INTO study_progress (user_id, item_id, view_count, marked, first_viewed_at, last_viewed_at) \
         VALUES (?1, ?2, 0, ?3, ?4, ?4) \
         ON CONFLICT(user_id, item_id) DO UPDATE SET \
             marked = excluded.marked, \
             first_viewed_at = COALESCE(study_progress.first_viewed_at, excluded.first_viewed_at), \
             last_viewed_at = excluded.last_viewed_at",
        params![input.user_id, input.item_id, marked_int, now],
    )?;
    Ok(())
}
