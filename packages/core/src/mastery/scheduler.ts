import { hasSevereError } from '../japanese/errorClassifier';
import type { EvaluationResult, SkillProgress } from '../types/domain';
import { addDays, addMinutes } from '../util/math';

export interface SchedulerService {
  scheduleNext(progress: SkillProgress, evaluation: EvaluationResult, now?: Date): string;
  shouldRepeatImmediately(evaluation: EvaluationResult): boolean;
  getDuePriority(progress: SkillProgress, now?: Date): number;
}

/**
 * MVP scheduler. Maps the user's current state + the latest evaluation to a next-due
 * timestamp.
 *
 * Strategy from devdocs §9.4 — keep the table tight so behaviour is auditable and the
 * scheduler can be swapped for FSRS/SM2 later without changing the call site:
 *
 *   severe error (long-vowel, sokuon, etc.)  → 10 minutes (immediate repeat queue)
 *   non-severe error                          → 1 day
 *   correct, state=new/seen                   → 1 day
 *   correct, state=learning                   → 2 days
 *   correct, state=fragile                    → 3 days
 *   correct, state=stable                     → 7 days
 *   correct, state=fluent                     → 21 days
 *   correct, state=cooldown                   → 30 days
 */
export function scheduleNext(
  progress: SkillProgress,
  evaluation: EvaluationResult,
  now: Date = new Date(),
): string {
  if (!evaluation.isCorrect) {
    if (hasSevereError(evaluation.errorTags)) {
      return addMinutes(now, 10).toISOString();
    }
    return addDays(now, 1).toISOString();
  }
  switch (progress.state) {
    case 'new':
    case 'seen':
      return addDays(now, 1).toISOString();
    case 'learning':
      return addDays(now, 2).toISOString();
    case 'fragile':
      return addDays(now, 3).toISOString();
    case 'stable':
      return addDays(now, 7).toISOString();
    case 'fluent':
      return addDays(now, 21).toISOString();
    case 'cooldown':
      return addDays(now, 30).toISOString();
  }
}

/**
 * True iff this attempt should retry within the same session before moving on. Used by
 * BaseTrainingScene to push the failed task to the front of the queue when a severe error
 * fires; in v0.3 it's also used by candidate selectors.
 */
export function shouldRepeatImmediately(evaluation: EvaluationResult): boolean {
  return !evaluation.isCorrect && hasSevereError(evaluation.errorTags);
}

/**
 * Priority for due-queue ordering. Higher = more urgent. Items past their due date get
 * proportionally boosted; items not yet due return 0.
 */
export function getDuePriority(progress: SkillProgress, now: Date = new Date()): number {
  if (!progress.nextDueAt) return 0;
  const due = Date.parse(progress.nextDueAt);
  if (Number.isNaN(due)) return 0;
  const overdueMs = now.getTime() - due;
  if (overdueMs <= 0) return 0;
  // Days overdue. We don't compress with log so a week-overdue item ranks 7 against a 1-day-
  // overdue item — that's intentional; the scheduler should grind through legacy errors.
  return overdueMs / 86_400_000;
}

export function createScheduler(): SchedulerService {
  return { scheduleNext, shouldRepeatImmediately, getDuePriority };
}
