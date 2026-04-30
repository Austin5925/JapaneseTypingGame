import { hasSevereError } from '../japanese/errorClassifier';
import type { EvaluationResult, SkillProgress } from '../types/domain';
import type { ErrorTag, MasteryState, SkillDimension } from '../types/enums';
import { clamp, ewma } from '../util/math';

import { scheduleNext } from './scheduler';

export interface MasteryService {
  updateProgress(
    old: SkillProgress | null,
    evaluation: EvaluationResult,
    options?: UpdateProgressOptions,
  ): SkillProgress;
  getMasteryState(score: number, lapseCount: number): MasteryState;
  createInitial(input: CreateInitialProgressInput): SkillProgress;
}

export interface UpdateProgressOptions {
  /** Inject the clock for tests / replay. Defaults to `new Date()`. */
  now?: Date;
  /** Typically `default-user` until accounts arrive in v2.x. */
  userId?: string;
}

export interface CreateInitialProgressInput {
  userId: string;
  itemId: string;
  skillDimension: SkillDimension;
}

const DEFAULT_USER = 'default-user';

export function createInitialProgress(input: CreateInitialProgressInput): SkillProgress {
  const now = new Date().toISOString();
  return {
    userId: input.userId,
    itemId: input.itemId,
    skillDimension: input.skillDimension,
    state: 'new',
    masteryScore: 0,
    stability: 0,
    difficulty: 0.5,
    exposureCount: 0,
    correctCount: 0,
    wrongCount: 0,
    streak: 0,
    lapseCount: 0,
    lastErrorTags: [],
    updatedAt: now,
  };
}

/**
 * Map a raw mastery score (0-100) and lapse count to a state. The bands are intentionally
 * conservative on the up-step (you only become `fluent` at >= 90) because we'd rather have a
 * user revisit a `stable` word than skip past it as `fluent` and never see it again.
 *
 * Lapse-driven `fragile`: ≥ 3 lapses puts a not-yet-stable item into `fragile` so the
 * scheduler revisits it sooner. We don't downgrade `stable` or `fluent` here; that's the job
 * of `updateProgress` when it observes a fresh wrong answer.
 */
export function getMasteryState(score: number, lapseCount: number): MasteryState {
  if (score === 0) return 'new';
  if (score < 20) return 'seen';
  if (lapseCount >= 3 && score < 70) return 'fragile';
  if (score < 70) return 'learning';
  if (score < 90) return 'stable';
  return 'fluent';
}

/**
 * Apply an evaluation to a progress record. Pure function — does not write to the DB; the
 * Repository layer will persist the returned record.
 *
 * Update logic (devdocs §9.3):
 *   - mastery score: +Δ on correct, -Δ on incorrect; Δ is bigger for early states (so
 *     learning items advance faster) and smaller once stable so the user has to *demonstrate*
 *     mastery before promotion.
 *   - severe-error attempts knock more points off than ordinary mistakes.
 *   - streak resets on a wrong answer; lapse count only increments on wrong + previously
 *     correct.
 */
export function updateProgress(
  old: SkillProgress | null,
  evaluation: EvaluationResult,
  options: UpdateProgressOptions = {},
): SkillProgress {
  const now = options.now ?? new Date();
  const userId = options.userId ?? old?.userId ?? DEFAULT_USER;
  const base =
    old ??
    createInitialProgress({
      userId,
      itemId: evaluation.itemId,
      skillDimension: evaluation.skillDimension,
    });

  const delta = evaluation.isCorrect
    ? computePositiveDelta(evaluation.score, base.difficulty, base.state)
    : computeNegativeDelta(evaluation.errorTags, base.state);

  const newScore = clamp(base.masteryScore + delta, 0, 100);
  const newLapse = !evaluation.isCorrect && base.streak > 0 ? base.lapseCount + 1 : base.lapseCount;
  const state = getMasteryState(newScore, newLapse);

  const updated: SkillProgress = {
    ...base,
    state,
    masteryScore: newScore,
    stability: updateStability(base.stability, evaluation),
    difficulty: updateDifficulty(base.difficulty, evaluation),
    exposureCount: base.exposureCount + 1,
    correctCount: base.correctCount + (evaluation.isCorrect ? 1 : 0),
    wrongCount: base.wrongCount + (evaluation.isCorrect ? 0 : 1),
    streak: evaluation.isCorrect ? base.streak + 1 : 0,
    lapseCount: newLapse,
    averageReactionTimeMs: ewma(base.averageReactionTimeMs, evaluation.reactionTimeMs),
    lastAttemptAt: now.toISOString(),
    nextDueAt: scheduleNext({ ...base, masteryScore: newScore, state }, evaluation, now),
    lastErrorTags: evaluation.errorTags,
    updatedAt: now.toISOString(),
  };
  return updated;
}

function computePositiveDelta(
  evaluationScore: number,
  difficulty: number,
  state: MasteryState,
): number {
  // Larger steps in the early states; smaller once stable.
  const baseStep = state === 'new' || state === 'seen' ? 18 : state === 'learning' ? 12 : 6;
  // Scale by attempt quality so a sloppy correct (60/100) advances less than a clean one.
  const qualityFactor = clamp(evaluationScore / 100, 0.4, 1.2);
  // Difficulty bonus: harder items award a bit more on success.
  const difficultyFactor = 0.85 + difficulty * 0.3;
  return baseStep * qualityFactor * difficultyFactor;
}

function computeNegativeDelta(tags: readonly ErrorTag[], state: MasteryState): number {
  // Severe errors hurt more, especially when the item was supposed to be stable.
  const severeMultiplier = hasSevereError(tags) ? 2.0 : 1.0;
  const baseDrop = state === 'fluent' || state === 'stable' ? 10 : 6;
  return -baseDrop * severeMultiplier;
}

function updateStability(prev: number, evaluation: EvaluationResult): number {
  // Stability grows only on correct answers without severe errors. We deliberately keep this
  // simple in MVP; FSRS-style update may replace it later without changing the call site.
  if (!evaluation.isCorrect || hasSevereError(evaluation.errorTags)) {
    return Math.max(0, prev * 0.5);
  }
  return clamp(prev + 0.15 + 0.05 * evaluation.accuracyScore, 0, 5);
}

function updateDifficulty(prev: number, evaluation: EvaluationResult): number {
  // If the user fails despite the item being marked easy, nudge difficulty up; symmetric on
  // success. clamp keeps it in [0, 1].
  const direction = evaluation.isCorrect ? -0.02 : 0.05;
  return clamp(prev + direction, 0.05, 0.95);
}

export function createMasteryService(): MasteryService {
  return {
    updateProgress,
    getMasteryState,
    createInitial: createInitialProgress,
  };
}
