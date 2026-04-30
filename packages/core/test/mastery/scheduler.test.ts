import { describe, expect, it } from 'vitest';

import { getDuePriority, scheduleNext, shouldRepeatImmediately } from '../../src/mastery/scheduler';
import type { EvaluationResult, SkillProgress } from '../../src/types/domain';

const NOW = new Date('2026-04-30T12:00:00.000Z');

function progress(partial: Partial<SkillProgress> = {}): SkillProgress {
  return {
    userId: 'u',
    itemId: 'i',
    skillDimension: 'kana_typing',
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
    updatedAt: NOW.toISOString(),
    ...partial,
  };
}

function evaluation(partial: Partial<EvaluationResult> = {}): EvaluationResult {
  return {
    attemptId: 'a',
    taskId: 't',
    itemId: 'i',
    skillDimension: 'kana_typing',
    isCorrect: true,
    score: 90,
    accuracyScore: 1,
    speedScore: 1,
    confidenceScore: 1,
    errorTags: [],
    expectedDisplay: '',
    actualDisplay: '',
    reactionTimeMs: 5000,
    shouldRepeatImmediately: false,
    crossGameEffects: [],
    ...partial,
  };
}

describe('scheduleNext', () => {
  it('severe error → +10 minutes', () => {
    const out = scheduleNext(
      progress(),
      evaluation({ isCorrect: false, errorTags: ['long_vowel_error'] }),
      NOW,
    );
    const due = new Date(out).getTime() - NOW.getTime();
    expect(due).toBe(10 * 60 * 1000);
  });

  it('non-severe error → +1 day', () => {
    const out = scheduleNext(
      progress(),
      evaluation({ isCorrect: false, errorTags: ['unknown'] }),
      NOW,
    );
    const due = new Date(out).getTime() - NOW.getTime();
    expect(due).toBe(86_400_000);
  });

  it('correct on new state → +1 day', () => {
    const out = scheduleNext(progress({ state: 'new' }), evaluation({ isCorrect: true }), NOW);
    const due = new Date(out).getTime() - NOW.getTime();
    expect(due).toBe(86_400_000);
  });

  it('correct on learning → +2 days', () => {
    const out = scheduleNext(progress({ state: 'learning' }), evaluation({ isCorrect: true }), NOW);
    const due = new Date(out).getTime() - NOW.getTime();
    expect(due).toBe(2 * 86_400_000);
  });

  it('correct on stable → +7 days', () => {
    const out = scheduleNext(progress({ state: 'stable' }), evaluation({ isCorrect: true }), NOW);
    const due = new Date(out).getTime() - NOW.getTime();
    expect(due).toBe(7 * 86_400_000);
  });

  it('correct on fluent → +21 days', () => {
    const out = scheduleNext(progress({ state: 'fluent' }), evaluation({ isCorrect: true }), NOW);
    const due = new Date(out).getTime() - NOW.getTime();
    expect(due).toBe(21 * 86_400_000);
  });
});

describe('shouldRepeatImmediately', () => {
  it('true for severe error', () => {
    expect(
      shouldRepeatImmediately(evaluation({ isCorrect: false, errorTags: ['sokuon_error'] })),
    ).toBe(true);
  });
  it('false for correct attempt', () => {
    expect(shouldRepeatImmediately(evaluation({ isCorrect: true }))).toBe(false);
  });
  it('false for non-severe error', () => {
    expect(shouldRepeatImmediately(evaluation({ isCorrect: false, errorTags: ['unknown'] }))).toBe(
      false,
    );
  });
});

describe('getDuePriority', () => {
  it('returns 0 for items not yet due', () => {
    const future = new Date(NOW.getTime() + 86_400_000).toISOString();
    expect(getDuePriority(progress({ nextDueAt: future }), NOW)).toBe(0);
  });

  it('returns days-overdue for past-due items', () => {
    const past = new Date(NOW.getTime() - 3 * 86_400_000).toISOString();
    expect(getDuePriority(progress({ nextDueAt: past }), NOW)).toBeCloseTo(3, 5);
  });

  it('returns 0 for items with no nextDueAt', () => {
    expect(getDuePriority(progress(), NOW)).toBe(0);
  });
});
