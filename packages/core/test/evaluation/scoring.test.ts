import { describe, expect, it } from 'vitest';

import { scoreAttempt } from '../../src/evaluation/scoring';

describe('scoreAttempt — happy path', () => {
  it('correct + on-time + no-hint → max raw, quality 5 only when fast', () => {
    const r = scoreAttempt({
      isCorrect: true,
      reactionTimeMs: 5000,
      expectedReactionTimeMs: 5000,
      usedHint: false,
      errorTags: [],
      difficulty: 0.5,
    });
    expect(r.raw).toBe(100);
    expect(r.accuracy).toBe(1);
    expect(r.speed).toBe(1);
    expect(r.penalty).toBe(0);
    expect(r.quality).toBe(5);
  });

  it('perfect run (correct + very fast) → quality 5', () => {
    const r = scoreAttempt({
      isCorrect: true,
      reactionTimeMs: 800,
      expectedReactionTimeMs: 5000,
      usedHint: false,
      errorTags: [],
      difficulty: 0.5,
    });
    expect(r.speed).toBe(1.2); // capped at 1.2
    expect(r.raw).toBeGreaterThanOrEqual(95);
    expect(r.quality).toBe(5);
  });

  it('correct but hint → quality capped at 3 (raw barely moves; the cap is the bite)', () => {
    const r = scoreAttempt({
      isCorrect: true,
      reactionTimeMs: 5000,
      expectedReactionTimeMs: 5000,
      usedHint: true,
      errorTags: [],
      difficulty: 0.5,
    });
    expect(r.penalty).toBeCloseTo(0.2);
    // The raw formula's hint contribution is small (only the clarity term reacts);
    // mapRawScoreToQuality applies the policy cap so a hint never produces quality 4 or 5.
    expect(r.quality).toBe(3);
  });
});

describe('scoreAttempt — severe errors cannot be offset by speed', () => {
  it('lapse with severe error → quality 0 even at minimum reaction time', () => {
    const r = scoreAttempt({
      isCorrect: false,
      reactionTimeMs: 100,
      expectedReactionTimeMs: 5000,
      usedHint: false,
      errorTags: ['long_vowel_error'],
      difficulty: 0.5,
    });
    expect(r.quality).toBe(0);
  });

  it('lapse with non-severe error → quality 1', () => {
    const r = scoreAttempt({
      isCorrect: false,
      reactionTimeMs: 5000,
      expectedReactionTimeMs: 5000,
      usedHint: false,
      errorTags: ['unknown'],
      difficulty: 0.5,
    });
    expect(r.quality).toBe(1);
  });

  it('correct but warn-mode severe error → quality capped at 3', () => {
    const r = scoreAttempt({
      isCorrect: true,
      reactionTimeMs: 800,
      expectedReactionTimeMs: 5000,
      usedHint: false,
      errorTags: ['long_vowel_error'],
      difficulty: 0.5,
    });
    // Even though raw would normally be perfect, severe-error tag caps quality at 3.
    expect(r.quality).toBe(3);
  });
});

describe('scoreAttempt — speed floor', () => {
  it('reaction time < 300ms is treated as 300ms (anti-gaming floor)', () => {
    const r1 = scoreAttempt({
      isCorrect: true,
      reactionTimeMs: 50,
      expectedReactionTimeMs: 1500,
      usedHint: false,
      errorTags: [],
      difficulty: 0.5,
    });
    const r2 = scoreAttempt({
      isCorrect: true,
      reactionTimeMs: 300,
      expectedReactionTimeMs: 1500,
      usedHint: false,
      errorTags: [],
      difficulty: 0.5,
    });
    // 50ms gets clamped to 300ms, so the speed score is identical to a real 300ms response.
    expect(r1.speed).toBe(r2.speed);
  });
});
