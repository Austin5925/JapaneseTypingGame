import { describe, expect, it } from 'vitest';

import { getSpeedChaseDifficulty } from '../src/scenes/speedChaseDifficulty';

describe('getSpeedChaseDifficulty', () => {
  it('starts loose (~7s timer) at session start', () => {
    const d = getSpeedChaseDifficulty(0, 1);
    expect(d.timeLimitMs).toBe(7000 * 0.85); // accuracy 1.0 tightens to 0.85
  });

  it('tightens with elapsed time', () => {
    const start = getSpeedChaseDifficulty(0, 0.7).timeLimitMs;
    const later = getSpeedChaseDifficulty(120_000, 0.7).timeLimitMs;
    expect(later).toBeLessThan(start);
  });

  it('floors at 4500ms even at very long sessions', () => {
    const d = getSpeedChaseDifficulty(600_000, 0.5);
    expect(d.timeLimitMs).toBeGreaterThanOrEqual(4500);
  });

  it('high accuracy tightens the timer (≥0.85 → 0.85x base)', () => {
    const high = getSpeedChaseDifficulty(60_000, 0.95);
    const mid = getSpeedChaseDifficulty(60_000, 0.7);
    expect(high.timeLimitMs).toBeLessThan(mid.timeLimitMs);
  });

  it('low accuracy loosens the timer (≤0.5 → 1.15x base)', () => {
    const low = getSpeedChaseDifficulty(60_000, 0.4);
    const mid = getSpeedChaseDifficulty(60_000, 0.7);
    expect(low.timeLimitMs).toBeGreaterThan(mid.timeLimitMs);
  });

  it('pursuer speed grows with elapsed time', () => {
    const start = getSpeedChaseDifficulty(0, 0.7).pursuerSpeedPx;
    const later = getSpeedChaseDifficulty(180_000, 0.7).pursuerSpeedPx;
    expect(later).toBeGreaterThan(start);
  });
});
