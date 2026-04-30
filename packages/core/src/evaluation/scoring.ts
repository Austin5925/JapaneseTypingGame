import { hasSevereError } from '../japanese/errorClassifier';
import type { ErrorTag } from '../types/enums';
import { clamp } from '../util/math';

export interface AttemptScoreInput {
  isCorrect: boolean;
  reactionTimeMs: number;
  /** Expected response time for this task (set by task selector based on difficulty). */
  expectedReactionTimeMs: number;
  usedHint: boolean;
  errorTags: ErrorTag[];
  /** 0-1, set by task — feeds into the `quality` mapping. */
  difficulty: number;
}

export interface AttemptScore {
  /** 0-100 final score for the attempt. */
  raw: number;
  accuracy: number;
  speed: number;
  /** 0-1; the proportion of the attempt's potential offset by hints + severe errors. */
  penalty: number;
  /**
   * FSRS-aligned 0..5 grade: 0 = lapse with severe error, 1 = lapse, 2 = hard correct,
   * 3 = good, 4 = easy, 5 = perfect. Used by SchedulerService.
   */
  quality: 0 | 1 | 2 | 3 | 4 | 5;
}

const MIN_REACTION_MS = 300;
const HINT_PENALTY = 0.2;
const SEVERE_ERROR_PENALTY = 0.3;

/**
 * Score a single attempt. Centralised here so every game uses the same formula and severe
 * Japanese errors (long_vowel/sokuon/dakuten/particle/meaning/ime) cannot be offset by raw
 * speed — see AIRouter postmortem #21 in CLAUDE.md.
 *
 * Formula (from devdocs §9.2 with one fix):
 *   speed   = clamp(expectedRtMs / max(actualRtMs, MIN_REACTION_MS), 0, 1.2)
 *   penalty = clamp(hintPenalty + severeErrorPenalty, 0, 0.7)
 *   raw     = clamp(accuracy*70 + speed*20 + (1 - penalty)*10, 0, 100)
 *
 * Why MIN_REACTION_MS=300: a user who answers in 1ms is gaming the system; the floor caps the
 * speed bonus at ~3.3x the expected time. A correct, on-time, no-hint, no-severe answer scores
 * around 90 — this leaves headroom for "perfect" runs without inflating the floor.
 */
export function scoreAttempt(input: AttemptScoreInput): AttemptScore {
  const accuracy = input.isCorrect ? 1 : 0;
  const reactionFloor = Math.max(input.reactionTimeMs, MIN_REACTION_MS);
  const speed = clamp(input.expectedReactionTimeMs / reactionFloor, 0, 1.2);
  const hintPenalty = input.usedHint ? HINT_PENALTY : 0;
  const severePenalty = hasSevereError(input.errorTags) ? SEVERE_ERROR_PENALTY : 0;
  const penalty = clamp(hintPenalty + severePenalty, 0, 0.7);

  const raw = clamp(accuracy * 70 + speed * 20 + (1 - penalty) * 10, 0, 100);
  const quality = mapRawScoreToQuality(raw, input.isCorrect, input.errorTags, input.usedHint);

  return { raw, accuracy, speed, penalty, quality };
}

function mapRawScoreToQuality(
  raw: number,
  isCorrect: boolean,
  errorTags: readonly ErrorTag[],
  usedHint: boolean,
): 0 | 1 | 2 | 3 | 4 | 5 {
  if (!isCorrect) {
    return hasSevereError(errorTags) ? 0 : 1;
  }
  // Correct attempts split by raw score; a correct attempt with severe error tags is unusual
  // (warn-mode policy) but we still cap quality at 3 since it shouldn't promote rapidly.
  if (hasSevereError(errorTags)) return 3;
  // A hint inevitably caps the quality at 3 — the user didn't recall the answer unaided. The
  // raw score's small hint penalty (-2 from the clarity term) by itself wasn't enough to
  // demote a fast correct answer; the cap here is the policy bite.
  if (usedHint) return raw >= 90 ? 3 : 2;
  if (raw >= 95) return 5;
  if (raw >= 85) return 4;
  if (raw >= 70) return 3;
  return 2;
}
