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
  if (!evaluator) {
    throw new Error(
      `evaluator for answerMode "${task.answerMode}" is not registered (Sprint 2 scope)`,
    );
  }
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
  // under the strictness policy. Pick the first exact match; fall back to the first candidate
  // for error classification.
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
  }
  // None acceptable — use the first candidate as the "actual" for diagnosis.
  const cmp = compareKana(expectedKana, candidates[0]!, task.strictness);
  return {
    isCorrect: false,
    errorTags: cmp.errorTags.length > 0 ? cmp.errorTags : ['unknown'],
    expectedDisplay: expectedKana,
    actualDisplay: candidates[0]!,
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

const EVALUATORS: Partial<Record<TrainingTask['answerMode'], ModeEvaluator>> = {
  romaji_to_kana: evaluateRomajiToKana,
  kana_input: evaluateKanaInput,
  kanji_to_reading: evaluateKanjiToReading,
  meaning_to_surface: evaluateMeaningToSurface,
  ime_surface: evaluateImeSurface,
  audio_to_surface: evaluateAudioToSurface,
  // sentence_chunk_order ships in V1 with the river-jump game; the evaluator is intentionally
  // missing here so a Sprint-2 caller that tries it gets a loud error rather than a silent
  // false-positive.
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
