import { describe, expect, it } from 'vitest';

import {
  createInitialProgress,
  getMasteryState,
  updateProgress,
} from '../../src/mastery/masteryService';
import type { EvaluationResult, SkillProgress } from '../../src/types/domain';

const NOW = new Date('2026-04-30T12:00:00.000Z');

function evaluation(partial: Partial<EvaluationResult> = {}): EvaluationResult {
  return {
    attemptId: 'a',
    taskId: 't',
    itemId: 'word-yakusoku',
    skillDimension: 'kana_typing',
    isCorrect: true,
    score: 90,
    accuracyScore: 1,
    speedScore: 1,
    confidenceScore: 1,
    errorTags: [],
    expectedDisplay: 'やくそく',
    actualDisplay: 'やくそく',
    reactionTimeMs: 4000,
    shouldRepeatImmediately: false,
    crossGameEffects: [],
    ...partial,
  };
}

describe('getMasteryState', () => {
  it('score 0 → new', () => {
    expect(getMasteryState(0, 0)).toBe('new');
  });
  it('score < 20 → seen', () => {
    expect(getMasteryState(15, 0)).toBe('seen');
  });
  it('score 50 with 0 lapses → learning', () => {
    expect(getMasteryState(50, 0)).toBe('learning');
  });
  it('score 50 with ≥3 lapses → fragile', () => {
    expect(getMasteryState(50, 3)).toBe('fragile');
    expect(getMasteryState(50, 5)).toBe('fragile');
  });
  it('score 75 → stable', () => {
    expect(getMasteryState(75, 0)).toBe('stable');
  });
  it('score 95 → fluent', () => {
    expect(getMasteryState(95, 0)).toBe('fluent');
  });
});

describe('updateProgress — first attempt', () => {
  it('correct first attempt creates initial progress and bumps score', () => {
    const p = updateProgress(null, evaluation({ isCorrect: true, score: 90 }), {
      now: NOW,
      userId: 'u',
    });
    expect(p.userId).toBe('u');
    expect(p.itemId).toBe('word-yakusoku');
    expect(p.exposureCount).toBe(1);
    expect(p.correctCount).toBe(1);
    expect(p.wrongCount).toBe(0);
    expect(p.streak).toBe(1);
    expect(p.masteryScore).toBeGreaterThan(0);
    expect(p.lastAttemptAt).toBe(NOW.toISOString());
    expect(p.nextDueAt).toBeDefined();
  });

  it('wrong first attempt does NOT count as a lapse (no streak to break yet)', () => {
    const p = updateProgress(null, evaluation({ isCorrect: false, errorTags: ['unknown'] }), {
      now: NOW,
      userId: 'u',
    });
    expect(p.lapseCount).toBe(0);
    expect(p.wrongCount).toBe(1);
    expect(p.streak).toBe(0);
  });
});

describe('updateProgress — subsequent attempts', () => {
  it('correct attempts accumulate score until fluent', () => {
    let p: SkillProgress | null = null;
    for (let i = 0; i < 25; i++) {
      p = updateProgress(p, evaluation({ isCorrect: true, score: 92 }), { now: NOW, userId: 'u' });
    }
    expect(p!.masteryScore).toBe(100);
    expect(p!.state).toBe('fluent');
    expect(p!.streak).toBe(25);
  });

  it('wrong attempt after streak counts as a lapse and breaks streak', () => {
    let p: SkillProgress | null = null;
    p = updateProgress(p, evaluation({ isCorrect: true, score: 90 }), { now: NOW, userId: 'u' });
    p = updateProgress(p, evaluation({ isCorrect: true, score: 90 }), { now: NOW, userId: 'u' });
    p = updateProgress(p, evaluation({ isCorrect: false, errorTags: ['unknown'] }), {
      now: NOW,
      userId: 'u',
    });
    expect(p.streak).toBe(0);
    expect(p.lapseCount).toBe(1);
  });

  it('severe error knocks more points off than non-severe', () => {
    let withSevere: SkillProgress | null = null;
    let withMild: SkillProgress | null = null;
    for (let i = 0; i < 5; i++) {
      withSevere = updateProgress(withSevere, evaluation({ isCorrect: true, score: 90 }), {
        now: NOW,
        userId: 'u',
      });
      withMild = updateProgress(withMild, evaluation({ isCorrect: true, score: 90 }), {
        now: NOW,
        userId: 'u',
      });
    }
    const beforeScore = withSevere!.masteryScore;
    withSevere = updateProgress(
      withSevere,
      evaluation({ isCorrect: false, errorTags: ['long_vowel_error'] }),
      { now: NOW, userId: 'u' },
    );
    withMild = updateProgress(withMild, evaluation({ isCorrect: false, errorTags: ['unknown'] }), {
      now: NOW,
      userId: 'u',
    });
    const dropSevere = beforeScore - withSevere.masteryScore;
    const dropMild = beforeScore - withMild.masteryScore;
    expect(dropSevere).toBeGreaterThan(dropMild);
  });

  it('severe error resets stability harder than non-severe', () => {
    let p: SkillProgress | null = null;
    for (let i = 0; i < 5; i++) {
      p = updateProgress(p, evaluation({ isCorrect: true, score: 90 }), { now: NOW, userId: 'u' });
    }
    const beforeStability = p!.stability;
    p = updateProgress(p, evaluation({ isCorrect: false, errorTags: ['sokuon_error'] }), {
      now: NOW,
      userId: 'u',
    });
    expect(p.stability).toBeLessThan(beforeStability);
  });

  it('nextDueAt for severe error is +10min, not +1day', () => {
    const p = updateProgress(
      createInitialProgress({ userId: 'u', itemId: 'i', skillDimension: 'kana_typing' }),
      evaluation({ isCorrect: false, errorTags: ['long_vowel_error'] }),
      { now: NOW, userId: 'u' },
    );
    const dueDelta = new Date(p.nextDueAt!).getTime() - NOW.getTime();
    expect(dueDelta).toBe(10 * 60 * 1000);
  });
});

describe('createInitialProgress', () => {
  it('produces a zeroed record with the given identity', () => {
    const p = createInitialProgress({
      userId: 'me',
      itemId: 'word-x',
      skillDimension: 'kanji_reading',
    });
    expect(p.userId).toBe('me');
    expect(p.itemId).toBe('word-x');
    expect(p.skillDimension).toBe('kanji_reading');
    expect(p.state).toBe('new');
    expect(p.masteryScore).toBe(0);
    expect(p.exposureCount).toBe(0);
    expect(p.lastErrorTags).toEqual([]);
  });
});
