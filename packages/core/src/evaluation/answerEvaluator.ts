import { compareKana, compareSurface } from '../japanese/japaneseInputService';
import { toKanaCandidates } from '../japanese/romaji';
import type { EvaluationResult, TrainingTask, UserAttempt } from '../types/domain';
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
 * Stub evaluator for sentence_chunk_order. The real one ships with the river-jump game in
 * V1 and validates `acceptedOrders[]`. We return a not-implemented EvaluationResult instead
 * of throwing so the generic `BaseTrainingScene` flow (Sprint 3+) doesn't hard-crash if a
 * chunk-order task accidentally reaches it before V1 lands. Callers that rely on judgment
 * should look at the explanation string and route the user to a stub message.
 */
export const evaluateSentenceChunkOrder: ModeEvaluator = (task, attempt) => {
  const expectedDisplay = (task.expected.chunkOrder ?? []).join(' / ');
  const actualDisplay = (attempt.chunkOrder ?? []).join(' / ');
  return {
    isCorrect: false,
    errorTags: ['unknown'],
    expectedDisplay,
    actualDisplay,
    explanation:
      'sentence_chunk_order evaluator is not yet implemented (V1 scope); attempt logged but not graded',
  };
};

const EVALUATORS: Record<TrainingTask['answerMode'], ModeEvaluator> = {
  romaji_to_kana: evaluateRomajiToKana,
  kana_input: evaluateKanaInput,
  kanji_to_reading: evaluateKanjiToReading,
  meaning_to_surface: evaluateMeaningToSurface,
  ime_surface: evaluateImeSurface,
  audio_to_surface: evaluateAudioToSurface,
  sentence_chunk_order: evaluateSentenceChunkOrder,
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
