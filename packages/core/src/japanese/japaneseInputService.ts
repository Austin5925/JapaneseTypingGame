import type { EvaluationStrictness, ExpectedAnswer } from '../types/domain';
import type { ErrorTag } from '../types/enums';

import { classifyKanaError, removeLongVowel as removeLongVowelHelper } from './errorClassifier';
import { isLikelyImeComposing, type ImeProbeEvent } from './ime';
import { normalizeKana, normalizeRawInput, type KanaNormalizeOptions } from './normalizeKana';
import { rewriteParticlesAsPronunciation } from './particles';
import {
  buildAcceptedKanaSet,
  toKanaCandidates,
  toRomajiCandidates,
  type KanaMode,
} from './romaji';

export interface KanaCompareResult {
  /** Strings are byte-equal after format normalisation only (no language-rule equivalences). */
  isExact: boolean;
  /** Strings are equal under the active strictness policy (e.g. `warn` long-vowel passes). */
  isAcceptable: boolean;
  normalizedExpected: string;
  normalizedActual: string;
  errorTags: ErrorTag[];
}

export interface SurfaceCompareResult {
  isExact: boolean;
  isAcceptable: boolean;
  expected: string;
  actual: string;
  matchedAcceptedSurface: string | null;
}

/**
 * The single entry point all games go through for Japanese input handling. Implemented as a
 * value-object so consumers can keep a stable reference (`const svc = createJapaneseInputService()`)
 * and tests can swap a fake without DI plumbing.
 */
export interface JapaneseInputService {
  normalizeRawInput(input: string): string;
  normalizeKana(input: string, options?: KanaNormalizeOptions): string;
  toKanaCandidates(rawRomaji: string, mode: KanaMode): string[];
  toRomajiCandidates(kana: string): string[];
  buildAcceptedKanaSet(expected: Pick<ExpectedAnswer, 'kana' | 'acceptedKana'>): Set<string>;
  compareKana(expected: string, actual: string, policy: EvaluationStrictness): KanaCompareResult;
  compareSurface(
    expected: Pick<ExpectedAnswer, 'surface' | 'acceptedSurfaces'>,
    actualSurface: string,
  ): SurfaceCompareResult;
  isLikelyImeComposing(event: ImeProbeEvent): boolean;
}

export function createJapaneseInputService(): JapaneseInputService {
  return {
    normalizeRawInput,
    normalizeKana,
    toKanaCandidates,
    toRomajiCandidates,
    buildAcceptedKanaSet,
    compareKana,
    compareSurface,
    isLikelyImeComposing,
  };
}

// ─────────────────────────────────────────────────────────────────────
// compareKana
// ─────────────────────────────────────────────────────────────────────

/**
 * Compare two kana strings under a strictness policy. Format-only differences (script, half/
 * full width, punctuation, particle pronunciation when so configured) are normalised away;
 * language-meaningful differences (long vowel, sokuon, dakuten, handakuten, youon) are surfaced
 * as ErrorTag values. The policy controls whether each surfaced tag is acceptable.
 */
export function compareKana(
  expectedRaw: string,
  actualRaw: string,
  policy: EvaluationStrictness,
): KanaCompareResult {
  const baseOptions: KanaNormalizeOptions = {
    katakanaToHiragana: true,
    expandLongVowel: false,
    normalizeHalfWidth: true,
    stripSpaces: true,
    normalizePunctuation: true,
  };

  let normalizedExpected = normalizeKana(expectedRaw, baseOptions);
  let normalizedActual = normalizeKana(actualRaw, baseOptions);

  if (policy.particleReading === 'pronunciation') {
    // Reading-mode: accept は/へ/を typed as わ/え/お. We canonicalise both sides to the
    // pronunciation form so equality is symmetric.
    normalizedExpected = rewriteParticlesAsPronunciation(normalizedExpected);
    normalizedActual = rewriteParticlesAsPronunciation(normalizedActual);
  }
  // 'both' is documented as "either form acceptable", but distinguishing a *particle* は from
  // a non-particle は (はじめまして, 葉) requires morphological analysis we don't have at this
  // layer. Implementing it via blanket rewriting would silently equate わじめまして to
  // はじめまして (a real typo, not a particle-reading variant). For Sprint 1 we therefore make
  // 'both' equivalent to 'surface'; tasks that need to accept both surface and pronunciation
  // particle forms should declare both in `acceptedKana`. The enum value is preserved so
  // content packs can stay version-stable; semantics may sharpen once Sprint 4+ has a real
  // tokenizer.

  const isExact = normalizedExpected === normalizedActual;
  if (isExact) {
    return {
      isExact: true,
      isAcceptable: true,
      normalizedExpected,
      normalizedActual,
      errorTags: [],
    };
  }

  // Long-vowel-tolerant retry: if the policy says ignore/warn for long vowels, ask the
  // classifier helper directly. We delegate so the leniency check uses exactly the same
  // long-vowel rules as the error classification.
  if (policy.longVowel !== 'strict') {
    const ee = removeLongVowelHelper(normalizedExpected);
    const aa = removeLongVowelHelper(normalizedActual);
    if (ee === aa) {
      const tags: ErrorTag[] = policy.longVowel === 'warn' ? ['long_vowel_error'] : [];
      return {
        isExact: false,
        isAcceptable: true,
        normalizedExpected,
        normalizedActual,
        errorTags: tags,
      };
    }
  }

  // Pass the *raw* inputs so classifyKanaError can detect katakana_shape_confusion (which
  // requires the original katakana script — once we've normalised to hiragana, シ/ツ pairs
  // are gone). classifyKanaError re-normalises internally for vowel/sokuon checks.
  const errorTags = classifyKanaError(expectedRaw, actualRaw);
  const isAcceptable = isAcceptableUnderPolicy(errorTags, policy);

  return {
    isExact: false,
    isAcceptable,
    normalizedExpected,
    normalizedActual,
    errorTags,
  };
}

function isAcceptableUnderPolicy(tags: readonly ErrorTag[], policy: EvaluationStrictness): boolean {
  if (tags.length === 0) return true;
  for (const tag of tags) {
    switch (tag) {
      case 'long_vowel_error':
        if (policy.longVowel === 'strict') return false;
        break;
      case 'sokuon_error':
        if (policy.sokuon === 'strict') return false;
        break;
      case 'dakuten_error':
        if (policy.dakuten === 'strict') return false;
        break;
      case 'handakuten_error':
        if (policy.handakuten === 'strict') return false;
        break;
      case 'youon_error':
        if (policy.youon === 'strict') return false;
        break;
      // Shape confusion and n_error are informational/scheduler tags; they always reject. The
      // remaining tags (particle_error, kanji_reading_error, meaning_confusion, etc.) come
      // from higher-level evaluators and we don't tolerate any of them at the kana layer.
      default:
        return false;
    }
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────
// compareSurface
// ─────────────────────────────────────────────────────────────────────

export function compareSurface(
  expected: Pick<ExpectedAnswer, 'surface' | 'acceptedSurfaces'>,
  actualSurface: string,
): SurfaceCompareResult {
  const actual = actualSurface.trim();
  const candidates: string[] = [];
  if (expected.surface) candidates.push(expected.surface.trim());
  for (const s of expected.acceptedSurfaces ?? []) candidates.push(s.trim());

  const exactMatch = candidates[0] !== undefined && candidates[0] === actual;
  if (exactMatch) {
    return {
      isExact: true,
      isAcceptable: true,
      expected: candidates[0]!,
      actual,
      matchedAcceptedSurface: null,
    };
  }
  const acceptedMatch = candidates.find((c) => c === actual);
  const primary = candidates[0];
  if (acceptedMatch !== undefined && primary !== undefined && acceptedMatch !== primary) {
    return {
      isExact: false,
      isAcceptable: true,
      expected: primary,
      actual,
      matchedAcceptedSurface: acceptedMatch,
    };
  }
  return {
    isExact: false,
    isAcceptable: false,
    expected: primary ?? '',
    actual,
    matchedAcceptedSurface: null,
  };
}
