import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import {
  validatePack,
  validateSentencePack,
  type ContentPackInput,
  type LearningItemInput,
  type SentencePackInput,
} from '@kana-typing/content-schema';
import type Database from 'better-sqlite3';

import { openDb, runMigrations } from './migrate';
import { defaultDevDbPath } from './paths';

// See validatePack.ts for the rationale on INIT_CWD.
function resolveUserPath(p: string): string {
  if (isAbsolute(p)) return p;
  const base = process.env.INIT_CWD ?? process.cwd();
  return resolve(base, p);
}

export interface ImportPackOptions {
  packPath: string;
  dbPath?: string;
  quality?: 'official' | 'verified' | 'user_imported' | 'needs_review';
}

export interface ImportPackOutcome {
  ok: boolean;
  packPath: string;
  dbPath: string;
  packId?: string;
  itemsUpserted?: number;
  examplesUpserted?: number;
  audioRefsUpserted?: number;
  confusableEdgesUpserted?: number;
  errors?: string[];
}

// Pack import is idempotent: re-running with the same pack updates rows in place rather than
// duplicating. Item ids are stable (`word-yakusoku`), so progress survives pack version bumps.
//
// v0.8.10: Sentence packs (`{ id, name, sentences: [...] }` instead of `items: [...]`) are
// now accepted. Each SentenceItem is translated into a sentence-typed `learning_items` row
// with merged kana/romaji and the chunks/acceptedOrders/zhPrompt JSON-encoded into
// `extras_json`. RiverJump's `rowToSentenceItem` reverses the encoding at runtime, so
// importing a sentence pack via the CLI lights up the same path as the Rust seed.
export function importPackFile(opts: ImportPackOptions): ImportPackOutcome {
  const absolutePack = resolveUserPath(opts.packPath);
  const dbPath = opts.dbPath ? resolveUserPath(opts.dbPath) : defaultDevDbPath();
  const raw = JSON.parse(readFileSync(absolutePack, 'utf8')) as unknown;

  if (looksLikeSentencePack(raw)) {
    const validated = validateSentencePack(raw);
    if (!validated.ok) {
      return {
        ok: false,
        packPath: absolutePack,
        dbPath,
        errors: validated.errors.map((e) => `${e.path}: ${e.message}`),
      };
    }
    const pack = sentencePackToContentPack(validated.value);
    const quality = opts.quality ?? inferDefaultQuality(pack);
    const db = openDb(dbPath);
    try {
      runMigrations(db);
      const counts = upsertPack(db, pack, quality);
      return { ok: true, packPath: absolutePack, dbPath, packId: pack.id, ...counts };
    } finally {
      db.close();
    }
  }

  const validated = validatePack(raw);
  if (!validated.ok) {
    return {
      ok: false,
      packPath: absolutePack,
      dbPath,
      errors: validated.errors.map(
        (e: { path: string; message: string }) => `${e.path}: ${e.message}`,
      ),
    };
  }
  const pack = validated.value;
  const quality = opts.quality ?? inferDefaultQuality(pack);

  const db = openDb(dbPath);
  try {
    runMigrations(db);
    const counts = upsertPack(db, pack, quality);
    return { ok: true, packPath: absolutePack, dbPath, packId: pack.id, ...counts };
  } finally {
    db.close();
  }
}

/**
 * Cheap shape detection — sentence packs have `sentences[]` instead of `items[]`. We don't
 * Zod-parse here because we want a clean error message from the right validator below.
 */
function looksLikeSentencePack(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const v = raw as { sentences?: unknown; items?: unknown };
  return Array.isArray(v.sentences) && !Array.isArray(v.items);
}

/**
 * Translate a SentencePack into the LearningItem-shaped ContentPack the upsert path already
 * understands. Mirrors the Rust `sentence_pack_to_word_pack` translation in
 * `commands.rs::seed_test_pack` so RiverJump sees identical rows whether the pack came
 * through `seed_test_pack` or `pnpm content:import`.
 */
export function sentencePackToContentPack(p: SentencePackInput): ContentPackInputWithExtras {
  const items: LearningItemWithExtras[] = p.sentences.map((s) => {
    const mergedKana = s.chunks.map((c) => c.kana).join('');
    const mergedRomaji = s.chunks.map((c) => c.romaji[0] ?? '').join('');
    const extras = {
      chunks: s.chunks,
      acceptedOrders: s.acceptedOrders,
      zhPrompt: s.zhPrompt,
    };
    const item: LearningItemWithExtras = {
      id: s.id,
      type: 'sentence',
      surface: s.surface,
      kana: mergedKana,
      romaji: [mergedRomaji],
      meaningsZh: [s.zhPrompt],
      tags: [...s.tags],
      skillTags: [...s.skillTags],
      examples: [],
      audioRefs: [],
      confusableItemIds: [],
      extrasJson: JSON.stringify(extras),
    };
    if (s.jlpt !== undefined) item.jlpt = s.jlpt;
    return item;
  });
  const out: ContentPackInputWithExtras = {
    id: p.id,
    name: p.name,
    version: p.version,
    locale: p.locale,
    items,
  };
  if (p.author !== undefined) out.author = p.author;
  if (p.description !== undefined) out.description = p.description;
  return out;
}

/** LearningItemInput + the optional `extrasJson` payload sentence translation needs. */
type LearningItemWithExtras = LearningItemInput & { extrasJson?: string | null };
type ContentPackInputWithExtras = Omit<ContentPackInput, 'items'> & {
  items: LearningItemWithExtras[];
};

function inferDefaultQuality(pack: ContentPackInput): NonNullable<ImportPackOptions['quality']> {
  const packText = `${pack.version} ${pack.description ?? ''}`.toLowerCase();
  const draftTaggedItems = pack.items.filter((item) => item.tags.includes('draft')).length;
  if (
    packText.includes('draft') ||
    (draftTaggedItems > 0 && draftTaggedItems / pack.items.length >= 0.5)
  ) {
    return 'needs_review';
  }
  return 'user_imported';
}

interface UpsertCounts {
  itemsUpserted: number;
  examplesUpserted: number;
  audioRefsUpserted: number;
  confusableEdgesUpserted: number;
}

function upsertPack(
  db: Database.Database,
  pack: ContentPackInputWithExtras,
  quality: NonNullable<ImportPackOptions['quality']>,
): UpsertCounts {
  const now = new Date().toISOString();

  const upsertPackStmt = db.prepare(`
    INSERT INTO content_packs (id, name, version, author, locale, quality, description, imported_at, enabled)
    VALUES (@id, @name, @version, @author, @locale, @quality, @description, @imported_at, 1)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      version = excluded.version,
      author = excluded.author,
      locale = excluded.locale,
      quality = excluded.quality,
      description = excluded.description,
      imported_at = excluded.imported_at
  `);

  const upsertItemStmt = db.prepare(`
    INSERT INTO learning_items (
      id, type, surface, kana, romaji_json, meanings_zh_json, meanings_en_json,
      pos, jlpt, tags_json, skill_tags_json, error_tags_json,
      accepted_surfaces_json, accepted_kana_json,
      source_pack_id, quality, created_at, updated_at, extras_json
    ) VALUES (
      @id, @type, @surface, @kana, @romaji_json, @meanings_zh_json, @meanings_en_json,
      @pos, @jlpt, @tags_json, @skill_tags_json, @error_tags_json,
      @accepted_surfaces_json, @accepted_kana_json,
      @source_pack_id, @quality, @created_at, @updated_at, @extras_json
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
      extras_json = excluded.extras_json
  `);

  const deleteExamplesStmt = db.prepare('DELETE FROM item_examples WHERE item_id = ?');
  const insertExampleStmt = db.prepare(`
    INSERT INTO item_examples (id, item_id, ja, kana, zh, target_surface, target_kana, audio_ref, tags_json, created_at)
    VALUES (@id, @item_id, @ja, @kana, @zh, @target_surface, @target_kana, @audio_ref, @tags_json, @created_at)
  `);

  const deleteAudioStmt = db.prepare('DELETE FROM audio_assets WHERE content_pack_id = ?');
  const insertAudioStmt = db.prepare(`
    INSERT INTO audio_assets (id, content_pack_id, kind, path, duration_ms, speaker, speed, checksum, created_at)
    VALUES (@id, @content_pack_id, @kind, @path, @duration_ms, @speaker, @speed, @checksum, @created_at)
  `);

  const deleteConfusablesStmt = db.prepare('DELETE FROM item_confusables WHERE item_id = ?');
  const insertConfusableStmt = db.prepare(`
    INSERT INTO item_confusables (item_id, confusable_item_id, reason_tag, weight)
    VALUES (?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    upsertPackStmt.run({
      id: pack.id,
      name: pack.name,
      version: pack.version,
      author: pack.author ?? null,
      locale: pack.locale,
      quality,
      description: pack.description ?? null,
      imported_at: now,
    });

    let itemsUpserted = 0;
    let examplesUpserted = 0;
    let audioRefsUpserted = 0;
    let confusableEdgesUpserted = 0;

    deleteAudioStmt.run(pack.id);

    for (const item of pack.items) {
      upsertItemStmt.run({
        id: item.id,
        type: item.type,
        surface: item.surface,
        kana: item.kana,
        romaji_json: JSON.stringify(item.romaji),
        meanings_zh_json: JSON.stringify(item.meaningsZh),
        meanings_en_json: item.meaningsEn ? JSON.stringify(item.meaningsEn) : null,
        pos: item.pos ?? null,
        jlpt: item.jlpt ?? null,
        tags_json: JSON.stringify(item.tags),
        skill_tags_json: JSON.stringify(item.skillTags),
        error_tags_json: item.errorTags ? JSON.stringify(item.errorTags) : null,
        accepted_surfaces_json: item.acceptedSurfaces
          ? JSON.stringify(item.acceptedSurfaces)
          : null,
        accepted_kana_json: item.acceptedKana ? JSON.stringify(item.acceptedKana) : null,
        source_pack_id: pack.id,
        quality,
        created_at: now,
        updated_at: now,
        extras_json: item.extrasJson ?? null,
      });
      itemsUpserted++;

      deleteExamplesStmt.run(item.id);
      for (const ex of item.examples) {
        insertExampleStmt.run({
          id: ex.id,
          item_id: item.id,
          ja: ex.ja,
          kana: ex.kana ?? null,
          zh: ex.zh,
          target_surface: ex.targetSurface ?? null,
          target_kana: ex.targetKana ?? null,
          audio_ref: ex.audioRef ?? null,
          tags_json: ex.tags ? JSON.stringify(ex.tags) : null,
          created_at: now,
        });
        examplesUpserted++;
      }

      for (const a of item.audioRefs) {
        insertAudioStmt.run({
          id: a.id,
          content_pack_id: pack.id,
          kind: a.kind,
          path: a.path,
          duration_ms: a.durationMs ?? null,
          speaker: a.speaker ?? null,
          speed: a.speed ?? 'normal',
          checksum: null,
          created_at: now,
        });
        audioRefsUpserted++;
      }

      deleteConfusablesStmt.run(item.id);
      for (const cid of item.confusableItemIds) {
        if (cid === item.id) continue;
        insertConfusableStmt.run(item.id, cid, 'unknown', 1.0);
        confusableEdgesUpserted++;
      }
    }

    return { itemsUpserted, examplesUpserted, audioRefsUpserted, confusableEdgesUpserted };
  });

  return tx();
}
