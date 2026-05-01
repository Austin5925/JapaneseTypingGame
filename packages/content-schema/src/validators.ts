import * as wanakana from 'wanakana';

import {
  ContentPackSchema,
  SentencePackSchema,
  type ContentPackInput,
  type LearningItemInput,
  type SentenceItemInput,
  type SentencePackInput,
} from './schemas';

// One issue per problem found, with `path` so a CLI can point at the offending location.
// We keep going past the first failure so a user gets the full picture in one run.
export interface ValidationIssue {
  path: string;
  message: string;
  severity: 'error' | 'warning';
  code: ValidationCode;
}

export type ValidationCode =
  | 'schema'
  | 'duplicate_id'
  | 'kana_invalid_chars'
  | 'romaji_does_not_round_trip'
  | 'example_missing_target'
  | 'confusable_id_unknown'
  | 'audio_path_empty';

export type ValidationResult<T> =
  | { ok: true; value: T; warnings: ValidationIssue[] }
  | { ok: false; errors: ValidationIssue[]; warnings: ValidationIssue[] };

// Allowed kana characters: hiragana block, katakana block, the long-vowel mark `ー`,
// and the two iteration marks `ゝゞヽヾ`. Everything else (kanji, ascii, punctuation) is rejected.
const KANA_CHAR_RE = /^[぀-ゟ゠-ヿーゝゞヽヾ]+$/u;

export function isAllKana(input: string): boolean {
  return KANA_CHAR_RE.test(input);
}

// Round-trip via romaji: convert the user-declared romaji into kana, then back to romaji, and
// compare against the canonical romaji of the kana. This is wanakana's most reliable form of
// equality because:
//   - `toHiragana('ビール')` is `'びいる'` (loses the long-vowel mark) — rules out hiragana cmp.
//   - `toKatakana('biiru')` is `'ビイル'` (expands the long vowel) — rules out katakana cmp.
//   - But `toRomaji('ビール')` is `'biiru'` and `toRomaji(toKatakana('biiru'))` is also `'biiru'`,
//     so romaji-space comparison normalises long vowels symmetrically.
// 拒绝 `biru` vs `ビール` (long-vowel error) and `kite` vs `きって` (sokuon error) — both are
// Sprint-1 test cases that this trip handles correctly.
export function romajiRoundTripsToKana(romaji: string, kana: string): boolean {
  const fromUser = wanakana.toRomaji(wanakana.toKatakana(romaji));
  const expected = wanakana.toRomaji(kana);
  return fromUser === expected;
}

export function validatePack(raw: unknown): ValidationResult<ContentPackInput> {
  const parsed = ContentPackSchema.safeParse(raw);
  if (!parsed.success) {
    const errors: ValidationIssue[] = parsed.error.issues.map((issue) => ({
      path: issue.path.join('.') || '<root>',
      message: issue.message,
      severity: 'error',
      code: 'schema',
    }));
    return { ok: false, errors, warnings: [] };
  }

  const pack = parsed.data;
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // 1. Item ID uniqueness — needed because content packs ship as JSON arrays and a duplicate
  // would silently overwrite progress on import.
  const idCounts = new Map<string, number>();
  for (const item of pack.items) {
    idCounts.set(item.id, (idCounts.get(item.id) ?? 0) + 1);
  }
  for (const [id, count] of idCounts) {
    if (count > 1) {
      errors.push({
        path: `items[id=${id}]`,
        message: `duplicate item id (appears ${String(count)} times)`,
        severity: 'error',
        code: 'duplicate_id',
      });
    }
  }

  const knownIds = new Set(pack.items.map((it) => it.id));

  pack.items.forEach((item, index) => {
    validateItem(item, index, knownIds, errors, warnings);
  });

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }
  return { ok: true, value: pack, warnings };
}

function validateItem(
  item: LearningItemInput,
  index: number,
  knownIds: ReadonlySet<string>,
  errors: ValidationIssue[],
  warnings: ValidationIssue[],
): void {
  const base = `items[${String(index)}](${item.id})`;

  // 2. kana must be all kana / long-vowel marks. We don't enforce this on `surface` because
  // surface is allowed to be kanji, mixed, or even all kana.
  if (!isAllKana(item.kana)) {
    errors.push({
      path: `${base}.kana`,
      message: `kana "${item.kana}" contains non-kana characters`,
      severity: 'error',
      code: 'kana_invalid_chars',
    });
  }

  // Same rule for any acceptedKana the pack declared.
  for (let i = 0; i < (item.acceptedKana?.length ?? 0); i++) {
    const k = item.acceptedKana![i]!;
    if (!isAllKana(k)) {
      errors.push({
        path: `${base}.acceptedKana[${String(i)}]`,
        message: `acceptedKana "${k}" contains non-kana characters`,
        severity: 'error',
        code: 'kana_invalid_chars',
      });
    }
  }

  // 3. Each declared romaji must round-trip to the canonical kana.
  for (let i = 0; i < item.romaji.length; i++) {
    const romaji = item.romaji[i]!;
    if (!romajiRoundTripsToKana(romaji, item.kana)) {
      errors.push({
        path: `${base}.romaji[${String(i)}]`,
        message: `romaji "${romaji}" does not round-trip to kana "${item.kana}"`,
        severity: 'error',
        code: 'romaji_does_not_round_trip',
      });
    }
  }

  // 4. Examples that name a targetSurface/targetKana must contain it. This is what catches
  // copy-paste mistakes between zh translation and ja sentence.
  for (let i = 0; i < item.examples.length; i++) {
    const ex = item.examples[i]!;
    if (ex.targetSurface && !ex.ja.includes(ex.targetSurface)) {
      errors.push({
        path: `${base}.examples[${String(i)}].targetSurface`,
        message: `example does not contain targetSurface "${ex.targetSurface}" in "${ex.ja}"`,
        severity: 'error',
        code: 'example_missing_target',
      });
    }
    if (ex.targetKana && ex.kana && !ex.kana.includes(ex.targetKana)) {
      errors.push({
        path: `${base}.examples[${String(i)}].targetKana`,
        message: `example kana does not contain targetKana "${ex.targetKana}" in "${ex.kana}"`,
        severity: 'error',
        code: 'example_missing_target',
      });
    }
  }

  // 5. confusableItemIds must reference items declared in the same pack. Cross-pack references
  // are deferred until we have a global item index (Sprint 4+).
  for (let i = 0; i < item.confusableItemIds.length; i++) {
    const id = item.confusableItemIds[i]!;
    if (id === item.id) {
      warnings.push({
        path: `${base}.confusableItemIds[${String(i)}]`,
        message: `confusableItemIds includes self`,
        severity: 'warning',
        code: 'confusable_id_unknown',
      });
      continue;
    }
    if (!knownIds.has(id)) {
      errors.push({
        path: `${base}.confusableItemIds[${String(i)}]`,
        message: `confusableItemIds references unknown id "${id}"`,
        severity: 'error',
        code: 'confusable_id_unknown',
      });
    }
  }

  // 6. audio path emptiness (file existence is checked at import time, not pack-validation
  // time — a CLI may not have access to the asset bundle).
  for (let i = 0; i < item.audioRefs.length; i++) {
    const a = item.audioRefs[i]!;
    if (a.path.trim() === '') {
      errors.push({
        path: `${base}.audioRefs[${String(i)}].path`,
        message: `audio path is empty`,
        severity: 'error',
        code: 'audio_path_empty',
      });
    }
  }
}

export function formatIssues(issues: ValidationIssue[]): string {
  return issues.map((i) => `[${i.severity}] ${i.path}: ${i.message} (${i.code})`).join('\n');
}

/**
 * Sentence-pack validation. Mirrors the word-pack flow but only checks the kana / romaji
 * round-trip on each chunk (and, where the sentence concatenates `surface` from `chunks`,
 * sanity-checks that the surface contains every chunk text). content-cli does not yet import
 * sentence packs; this lets the schema lock in the format before persistence ships.
 */
export function validateSentencePack(raw: unknown): ValidationResult<SentencePackInput> {
  const parsed = SentencePackSchema.safeParse(raw);
  if (!parsed.success) {
    const errors: ValidationIssue[] = parsed.error.issues.map((issue) => ({
      path: issue.path.join('.') || '<root>',
      message: issue.message,
      severity: 'error',
      code: 'schema',
    }));
    return { ok: false, errors, warnings: [] };
  }

  const pack = parsed.data;
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const idCounts = new Map<string, number>();
  for (const s of pack.sentences) {
    idCounts.set(s.id, (idCounts.get(s.id) ?? 0) + 1);
  }
  for (const [id, count] of idCounts) {
    if (count > 1) {
      errors.push({
        path: `sentences[id=${id}]`,
        message: `duplicate sentence id (appears ${String(count)} times)`,
        severity: 'error',
        code: 'duplicate_id',
      });
    }
  }

  pack.sentences.forEach((sentence, index) => {
    validateSentenceItem(sentence, index, errors, warnings);
  });

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }
  return { ok: true, value: pack, warnings };
}

function validateSentenceItem(
  item: SentenceItemInput,
  index: number,
  errors: ValidationIssue[],
  _warnings: ValidationIssue[],
): void {
  const base = `sentences[${String(index)}](${item.id})`;

  for (let i = 0; i < item.chunks.length; i++) {
    const chunk = item.chunks[i]!;
    const chunkBase = `${base}.chunks[${String(i)}](${chunk.id})`;
    if (!isAllKana(chunk.kana)) {
      errors.push({
        path: `${chunkBase}.kana`,
        message: `chunk kana "${chunk.kana}" contains non-kana characters`,
        severity: 'error',
        code: 'kana_invalid_chars',
      });
    }
    for (let j = 0; j < chunk.romaji.length; j++) {
      const romaji = chunk.romaji[j]!;
      if (!romajiRoundTripsToKana(romaji, chunk.kana)) {
        errors.push({
          path: `${chunkBase}.romaji[${String(j)}]`,
          message: `chunk romaji "${romaji}" does not round-trip to kana "${chunk.kana}"`,
          severity: 'error',
          code: 'romaji_does_not_round_trip',
        });
      }
    }
  }
}
