// Difficulty curve for the speed-chase scene. Lives in its own file (not in
// SpeedChaseScene.ts) so unit tests can import it without dragging the full Phaser bundle —
// Phaser's canvas-feature probe blows up under jsdom.

export interface SpeedChaseDifficulty {
  /** Time the user has per task (ms). Tightens with elapsed session time. */
  timeLimitMs: number;
  /** Pursuer's gain per second of session elapsed (visual only). */
  pursuerSpeedPx: number;
  /** Distance lost on a wrong answer (visual only). */
  wrongAnswerSetbackPx: number;
}

/**
 * Speed-chase difficulty curve.
 *
 * Numbers tuned for a 3-minute MVP session:
 *   - timer linearly tightens from 7000ms to a 4500ms floor over 180s of session;
 *   - accuracy ≥ 0.85 multiplies the timer by 0.85 (tighten); ≤ 0.5 multiplies by 1.15 (relax);
 *   - pursuer speed grows mildly with elapsed seconds (0.8 → ~1.4 px/frame at 360s);
 *   - wrong-answer setback is a flat 12 px (visual only).
 *
 * Sprint 5 may swap this for a real DDA with user data; for now the function is deterministic
 * so the unit tests can pin behaviour in place.
 */
export function getSpeedChaseDifficulty(elapsedMs: number, accuracy: number): SpeedChaseDifficulty {
  const elapsedSeconds = elapsedMs / 1000;
  const baseTime = Math.max(4500, 7000 - (elapsedSeconds / 180) * 2500);
  const accuracyFactor = accuracy >= 0.85 ? 0.85 : accuracy <= 0.5 ? 1.15 : 1.0;
  const timeLimitMs = Math.round(baseTime * accuracyFactor);
  const pursuerSpeedPx = 0.8 + Math.min(0.6, elapsedSeconds / 360);
  const wrongAnswerSetbackPx = 12;
  return { timeLimitMs, pursuerSpeedPx, wrongAnswerSetbackPx };
}
