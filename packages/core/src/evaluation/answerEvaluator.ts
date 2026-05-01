import { compareKana, compareSurface } from '../japanese/japaneseInputService';
import { toKanaCandidates } from '../japanese/romaji';
import type {
  EvaluationResult,
  SentenceChunkAttemptEntry,
  TrainingTask,
  UserAttempt,
} from '../types/domain';
import type { ErrorTag } from '../types/enums';

import { buildCrossGameEffects } from './crossGameEffects';
import { scoreAttempt } from './scoring';

const SEVERE_REPEAT_TAGS: ReadonlySet<ErrorTag> = new Set<ErrorTag>([
  'long_vowel_error',
  'sokuon_error',
  'dakuten_error',
  'particle_error',
  'meaning_confusion',
  'ime_conversion_error',
]);

export interface EvaluateOptions {
  /** Expected reaction time in ms; falls back to 5000ms if the task didn't set one. */
  defaultExpectedReactionMs?: number;
}

/**
 * The single judgement entry point all games use.
 *
 * Why one function instead of a class: each AnswerMode case is a small pure function over
 * task + attempt; a switch is more readable than a strategy pattern at this size. We export
 * each per-mode evaluator below so tests can target them individually.
 */
export function evaluate(
  task: TrainingTask,
  attempt: UserAttempt,
  options: EvaluateOptions = {},
): EvaluationResult {
  const evaluator = EVALUATORS[task.answerMode];
  const partial = evaluator(task, attempt);
  return finaliseResult(task, attempt, partial, options);
}

interface PartialResult {
  isCorrect: boolean;
  errorTags: ErrorTag[];
  expectedDisplay: string;
  actualDisplay: string;
  explanation?: string;
}

type ModeEvaluator = (task: TrainingTask, attempt: UserAttempt) => PartialResult;

// ─────────────────────────────────────────────────────────────────────
// Per-AnswerMode evaluators
// ─────────────────────────────────────────────────────────────────────

export const evaluateRomajiToKana: ModeEvaluator = (task, attempt) => {
  const expectedKana = task.expected.kana ?? '';
  const raw = attempt.rawInput ?? attempt.committedInput ?? '';
  const candidates = toKanaCandidates(raw, 'mixed');
  if (candidates.length === 0) {
    return mismatchResult(expectedKana, raw, ['unknown']);
  }
  // The user has typed romaji; we accept the candidate that's closest to the expected kana
  // under the strictness policy.
  let best: { candidate: string; tags: ErrorTag[] } | null = null;
  for (const c of candidates) {
    const cmp = compareKana(expectedKana, c, task.strictness);
    if (cmp.isAcceptable) {
      return {
        isCorrect: true,
        errorTags: cmp.errorTags,
        expectedDisplay: expectedKana,
        actualDisplay: c,
      };
    }
    // For diagnosis we prefer a candidate whose error tags say *something* over a candidate
    // that bottomed out at `unknown`. `mixed` mode returns hiragana before katakana, and
    // the katakana candidate often carries shape-confusion / long-vowel tags that the
    // hiragana version loses to script normalisation.
    const informative = cmp.errorTags.filter((t) => t !== 'unknown').length;
    const incumbentInformative = best ? best.tags.filter((t) => t !== 'unknown').length : -1;
    if (best === null || informative > incumbentInformative) {
      best = { candidate: c, tags: cmp.errorTags };
    }
  }
  return {
    isCorrect: false,
    errorTags: best!.tags.length > 0 ? best!.tags : ['unknown'],
    expectedDisplay: expectedKana,
    actualDisplay: best!.candidate,
  };
};

export const evaluateKanaInput: ModeEvaluator = (task, attempt) => {
  const expectedKana = task.expected.kana ?? '';
  const actual = attempt.committedInput ?? attempt.rawInput ?? '';
  const cmp = compareKana(expectedKana, actual, task.strictness);
  return {
    isCorrect: cmp.isAcceptable,
    errorTags: cmp.errorTags,
    expectedDisplay: expectedKana,
    actualDisplay: actual,
  };
};

export const evaluateKanjiToReading: ModeEvaluator = (task, attempt) => {
  // Identical mechanically to evaluateKanaInput — the prompt shows kanji, but the answer is
  // the kana reading. The semantic distinction matters for scheduler routing (kanji_reading
  // skill dimension) but not here.
  return evaluateKanaInput(task, attempt);
};

export const evaluateMeaningToSurface: ModeEvaluator = (task, attempt) => {
  // Prompt is a Chinese meaning; the user types surface (kanji or hiragana). We accept the
  // surface match OR the kana reading (same item, different rendering).
  const actual = (attempt.committedInput ?? attempt.rawInput ?? '').trim();
  const surfaceCmp = compareSurface(task.expected, actual);
  if (surfaceCmp.isAcceptable) {
    return {
      isCorrect: true,
      errorTags: [],
      expectedDisplay: task.expected.surface ?? task.expected.kana ?? '',
      actualDisplay: actual,
    };
  }
  // Fall back to kana comparison (user may have typed reading instead of surface).
  if (task.expected.kana) {
    const kanaCmp = compareKana(task.expected.kana, actual, task.strictness);
    if (kanaCmp.isAcceptable) {
      return {
        isCorrect: true,
        errorTags: kanaCmp.errorTags,
        expectedDisplay: task.expected.kana,
        actualDisplay: actual,
      };
    }
  }
  return {
    isCorrect: false,
    errorTags: surfaceCmp.expected ? ['kanji_reading_error'] : ['unknown'],
    expectedDisplay: task.expected.surface ?? task.expected.kana ?? '',
    actualDisplay: actual,
  };
};

export const evaluateImeSurface: ModeEvaluator = (task, attempt) => {
  const actual = (attempt.committedInput ?? attempt.rawInput ?? '').trim();
  const cmp = compareSurface(task.expected, actual);
  if (cmp.isAcceptable) {
    return {
      isCorrect: true,
      errorTags: [],
      expectedDisplay: cmp.expected,
      actualDisplay: actual,
    };
  }
  // The user typed something that's not a recognised surface variant — likely picked the
  // wrong kanji from the IME candidate list.
  return {
    isCorrect: false,
    errorTags: ['ime_conversion_error'],
    expectedDisplay: cmp.expected,
    actualDisplay: actual,
  };
};

export const evaluateAudioToSurface: ModeEvaluator = (task, attempt) => {
  // Prompt is an audio cue; expected is a kana or surface answer. Handled the same as
  // kana-input for now; audio playback / strict-mode listening will be wired in Sprint 4.
  return evaluateKanaInput(task, attempt);
};

/**
 * Option-select evaluator (space-battle scene, v0.8.1).
 *
 * The user picked one of `task.options[]`; the attempt carries the chosen option id in
 * `attempt.selectedOptionId`. Correctness is exact-id match against `task.expected.optionId`.
 * On a wrong pick we surface the chosen option's `errorTagIfChosen` so the scheduler / cross-
 * game effects know whether it was a same-sound / near-shape / meaning confusion (the option
 * authoring is what classifies the mistake, not the evaluator).
 *
 * Edge cases:
 *   - selectedOptionId absent (timeout / abort) → ['timeout']
 *   - selectedOptionId not present in task.options[] → ['misclick'] (data integrity)
 */
export const evaluateOptionSelect: ModeEvaluator = (task, attempt) => {
  const expectedId = task.expected.optionId ?? '';
  const expectedOption = task.options?.find((o) => o.id === expectedId);
  const expectedDisplay = expectedOption?.label ?? expectedId;

  const selectedId = attempt.selectedOptionId;
  if (!selectedId) {
    return {
      isCorrect: false,
      errorTags: ['timeout'],
      expectedDisplay,
      actualDisplay: '∅',
    };
  }
  const selectedOption = task.options?.find((o) => o.id === selectedId);
  if (!selectedOption) {
    return {
      isCorrect: false,
      errorTags: ['misclick'],
      expectedDisplay,
      actualDisplay: selectedId,
    };
  }
  if (selectedId === expectedId) {
    return {
      isCorrect: true,
      errorTags: [],
      expectedDisplay,
      actualDisplay: selectedOption.label,
    };
  }
  const tag: ErrorTag = selectedOption.errorTagIfChosen ?? 'meaning_confusion';
  return {
    isCorrect: false,
    errorTags: [tag],
    expectedDisplay,
    actualDisplay: selectedOption.label,
  };
};

/**
 * Sentence-order evaluator (river-jump scene, v0.8.0).
 *
 * Inputs:
 *   - `task.expected.chunkOrder`  — canonical chunk-id order
 *   - `task.expected.acceptedChunkOrders` — additional accepted permutations
 *   - `task.expected.chunks`      — per-chunk reading metadata (kana / romaji / acceptedSurfaces)
 *   - `attempt.chunkOrder`        — user-selected order
 *   - `attempt.rawInput`          — JSON-encoded SentenceChunkAttemptEntry[] (per-chunk inputs)
 *
 * Two parallel checks:
 *   1. Order: chunkOrder must equal chunkOrder OR appear in acceptedChunkOrders.
 *      Mismatch → `word_order_error`.
 *   2. Per-chunk reading: parse rawInput, replay compareKana for each chunk.
 *      Any failure → that chunk's error tags merge into the result.
 *
 * `isCorrect` requires BOTH order and every chunk reading correct. Severe per-chunk tags
 * (long_vowel / sokuon / dakuten / particle) bubble up so `shouldRepeatImmediately` and
 * scheduler bonuses fire correctly.
 */
export const evaluateSentenceChunkOrder: ModeEvaluator = (task, attempt) => {
  const expectedOrder = task.expected.chunkOrder ?? [];
  const acceptedOrders: string[][] = [
    ...(expectedOrder.length > 0 ? [expectedOrder] : []),
    ...(task.expected.acceptedChunkOrders ?? []),
  ];
  const actualOrder = attempt.chunkOrder ?? [];
  const expectedDisplay = expectedOrder.join(' / ');
  const actualDisplay = actualOrder.join(' / ');

  const orderCorrect =
    actualOrder.length === expectedOrder.length &&
    acceptedOrders.some((candidate) => arraysEqual(candidate, actualOrder));

  const errorTags: ErrorTag[] = [];
  if (!orderCorrect && expectedOrder.length > 0) {
    errorTags.push('word_order_error');
  }

  // Per-chunk reading replay. We tolerate missing rawInput (scene may have logged only the
  // chunk order on a partial run) — in that case order-only judgement applies.
  const chunkEntries = parseChunkEntries(attempt.rawInput);
  const chunkMeta = task.expected.chunks ?? [];
  const chunkMetaById = new Map(chunkMeta.map((c) => [c.id, c]));
  let allReadingsCorrect = chunkEntries.length === 0 ? orderCorrect : true;
  for (const entry of chunkEntries) {
    const meta = chunkMetaById.get(entry.chunkId);
    if (!meta) {
      // Unknown chunk id — surface as unknown rather than silently skipping.
      errorTags.push('unknown');
      allReadingsCorrect = false;
      continue;
    }
    const cmp = compareReadingForChunk(meta.kana, meta.romaji, entry.input, task.strictness);
    if (!cmp.isAcceptable) {
      allReadingsCorrect = false;
      for (const tag of cmp.errorTags) {
        if (!errorTags.includes(tag)) errorTags.push(tag);
      }
    }
  }
  // If no chunk metadata or no entries were supplied at all, fall back to order-only judgement.
  if (chunkMeta.length === 0 || chunkEntries.length === 0) {
    allReadingsCorrect = orderCorrect;
  }

  const isCorrect = orderCorrect && allReadingsCorrect;
  if (!isCorrect && errorTags.length === 0) {
    errorTags.push('unknown');
  }

  return {
    isCorrect,
    errorTags,
    expectedDisplay,
    actualDisplay,
  };
};

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function parseChunkEntries(raw: string | undefined): SentenceChunkAttemptEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const entries: SentenceChunkAttemptEntry[] = [];
    for (const item of parsed) {
      if (
        item &&
        typeof item === 'object' &&
        'chunkId' in item &&
        'input' in item &&
        typeof (item as { chunkId: unknown }).chunkId === 'string' &&
        typeof (item as { input: unknown }).input === 'string'
      ) {
        entries.push({
          chunkId: (item as { chunkId: string }).chunkId,
          input: (item as { input: string }).input,
        });
      }
    }
    return entries;
  } catch {
    return [];
  }
}

function compareReadingForChunk(
  expectedKana: string,
  acceptedRomaji: readonly string[],
  rawInput: string,
  strictness: TrainingTask['strictness'],
): { isAcceptable: boolean; errorTags: ErrorTag[] } {
  const trimmed = rawInput.trim();
  if (trimmed.length === 0) {
    return { isAcceptable: false, errorTags: ['unknown'] };
  }
  // Try as-kana first (user typed kana directly via IME or paste).
  const directCmp = compareKana(expectedKana, trimmed, strictness);
  if (directCmp.isAcceptable) {
    return { isAcceptable: true, errorTags: directCmp.errorTags };
  }
  // Fall back to romaji-to-kana candidates. We prefer the candidate that matches; if none do,
  // surface the most informative error tags (mirrors evaluateRomajiToKana's logic).
  const candidates = toKanaCandidates(trimmed, 'mixed');
  let best: { tags: ErrorTag[] } | null = null;
  for (const candidate of candidates) {
    const cmp = compareKana(expectedKana, candidate, strictness);
    if (cmp.isAcceptable) {
      return { isAcceptable: true, errorTags: cmp.errorTags };
    }
    const informative = cmp.errorTags.filter((t) => t !== 'unknown').length;
    const incumbent = best ? best.tags.filter((t) => t !== 'unknown').length : -1;
    if (best === null || informative > incumbent) {
      best = { tags: cmp.errorTags };
    }
  }
  // Recognise an exact-romaji match against the declared `acceptedRomaji` list as a final
  // fallback; this keeps the scene's hint-display ("type 'ikimasu'") consistent with what
  // round-tripped at validation time.
  if (acceptedRomaji.includes(trimmed.toLowerCase())) {
    return { isAcceptable: true, errorTags: [] };
  }
  // No candidate matched — return the best-tagged failure or the direct-cmp tags as fallback.
  const tags = best?.tags.length ? best.tags : directCmp.errorTags;
  return { isAcceptable: false, errorTags: tags.length > 0 ? tags : ['unknown'] };
}

const EVALUATORS: Record<TrainingTask['answerMode'], ModeEvaluator> = {
  romaji_to_kana: evaluateRomajiToKana,
  kana_input: evaluateKanaInput,
  kanji_to_reading: evaluateKanjiToReading,
  meaning_to_surface: evaluateMeaningToSurface,
  ime_surface: evaluateImeSurface,
  audio_to_surface: evaluateAudioToSurface,
  sentence_chunk_order: evaluateSentenceChunkOrder,
  option_select: evaluateOptionSelect,
};

// ─────────────────────────────────────────────────────────────────────
// Result assembly
// ─────────────────────────────────────────────────────────────────────

const DEFAULT_EXPECTED_REACTION_MS = 5000;

function finaliseResult(
  task: TrainingTask,
  attempt: UserAttempt,
  partial: PartialResult,
  options: EvaluateOptions,
): EvaluationResult {
  const expectedReactionMs =
    task.timeLimitMs ?? options.defaultExpectedReactionMs ?? DEFAULT_EXPECTED_REACTION_MS;
  const score = scoreAttempt({
    isCorrect: partial.isCorrect,
    reactionTimeMs: attempt.reactionTimeMs,
    expectedReactionTimeMs: expectedReactionMs,
    usedHint: attempt.usedHint,
    errorTags: partial.errorTags,
    difficulty: task.difficulty,
  });
  const result: EvaluationResult = {
    attemptId: attempt.id,
    taskId: task.id,
    itemId: task.itemId,
    skillDimension: task.skillDimension,
    isCorrect: partial.isCorrect,
    score: score.raw,
    accuracyScore: score.accuracy,
    speedScore: score.speed,
    confidenceScore: 1 - score.penalty,
    errorTags: partial.errorTags,
    expectedDisplay: partial.expectedDisplay,
    actualDisplay: partial.actualDisplay,
    reactionTimeMs: attempt.reactionTimeMs,
    shouldRepeatImmediately:
      !partial.isCorrect && partial.errorTags.some((t) => SEVERE_REPEAT_TAGS.has(t)),
    crossGameEffects: [],
  };
  if (partial.explanation !== undefined) {
    result.explanation = partial.explanation;
  }
  result.crossGameEffects = buildCrossGameEffects(result);
  return result;
}

function mismatchResult(
  expectedDisplay: string,
  actualDisplay: string,
  errorTags: ErrorTag[],
): PartialResult {
  return { isCorrect: false, errorTags, expectedDisplay, actualDisplay };
}
