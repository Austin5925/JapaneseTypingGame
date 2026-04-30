import { describe, expect, it } from 'vitest';

import { buildWeaknessVector } from '../../src/planning/weaknessVector';
import type { SkillProgress } from '../../src/types/domain';
import type { SkillDimension } from '../../src/types/enums';

function progress(itemId: string, skill: SkillDimension, score: number): SkillProgress {
  return {
    userId: 'u',
    itemId,
    skillDimension: skill,
    state: 'learning',
    masteryScore: score,
    stability: 0,
    difficulty: 0.5,
    exposureCount: 1,
    correctCount: 0,
    wrongCount: 0,
    streak: 0,
    lapseCount: 0,
    lastErrorTags: [],
    updatedAt: new Date().toISOString(),
  };
}

describe('buildWeaknessVector', () => {
  it('returns 0.7 default for skills with no observed progress', () => {
    const v = buildWeaknessVector([], []);
    expect(v.kanaRecognition).toBe(0.7);
    expect(v.kanjiReading).toBe(0.7);
    expect(v.listeningDiscrimination).toBe(0.7);
  });

  it('strong items pull weakness toward 0', () => {
    const v = buildWeaknessVector(
      [progress('a', 'kanji_reading', 100), progress('b', 'kanji_reading', 95)],
      [],
    );
    expect(v.kanjiReading).toBeLessThan(0.1);
  });

  it('weak items pull weakness toward 1', () => {
    const v = buildWeaknessVector(
      [progress('a', 'kanji_reading', 5), progress('b', 'kanji_reading', 0)],
      [],
    );
    expect(v.kanjiReading).toBeGreaterThan(0.9);
  });

  it('topErrorTags carries the input counts sorted desc', () => {
    const v = buildWeaknessVector(
      [],
      [
        { tag: 'long_vowel_error', count: 7 },
        { tag: 'sokuon_error', count: 3 },
        { tag: 'unknown', count: 12 },
      ],
    );
    expect(v.topErrorTags[0]).toEqual({ tag: 'unknown', weight: 12 });
    expect(v.topErrorTags[1]).toEqual({ tag: 'long_vowel_error', weight: 7 });
  });

  it('weakestItems sorts items by 1 - masteryScore', () => {
    const v = buildWeaknessVector(
      [progress('a', 'kana_typing', 90), progress('b', 'kana_typing', 30)],
      [],
    );
    expect(v.weakestItems[0]?.itemId).toBe('b');
    expect(v.weakestItems[0]?.weight).toBeCloseTo(0.7, 5);
  });

  it('kana_typing folds into kanaRecognition for the planner', () => {
    const v = buildWeaknessVector([progress('a', 'kana_typing', 0)], []);
    // The single 0-score kana_typing item makes kanaRecognition == 1, since both share the
    // same WeaknessVector field.
    expect(v.kanaRecognition).toBe(1);
  });
});
