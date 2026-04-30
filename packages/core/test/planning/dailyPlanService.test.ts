import { describe, expect, it } from 'vitest';

import { selectGameBlocks } from '../../src/planning/dailyPlanService';
import type { WeaknessVector } from '../../src/types/domain';

function vector(partial: Partial<WeaknessVector> = {}): WeaknessVector {
  return {
    kanaRecognition: 0.5,
    katakanaRecognition: 0.5,
    kanjiReading: 0.5,
    meaningRecall: 0.5,
    imeConversion: 0.5,
    listeningDiscrimination: 0.5,
    particleUsage: 0.5,
    sentenceOrder: 0.5,
    activeOutput: 0.5,
    topErrorTags: [],
    weakestItems: [],
    ...partial,
  };
}

describe('selectGameBlocks', () => {
  it('always returns at least one block (empty-state fallback)', () => {
    const blocks = selectGameBlocks({
      vector: vector({ kanaRecognition: 0, katakanaRecognition: 0, kanjiReading: 0 }),
      targetDurationMs: 480_000,
    });
    expect(blocks.length).toBeGreaterThan(0);
  });

  it('katakana weakness > 0.6 picks a mole-story block', () => {
    const blocks = selectGameBlocks({
      vector: vector({ katakanaRecognition: 0.8 }),
      targetDurationMs: 480_000,
    });
    expect(blocks.some((b) => b.gameType === 'mole_story')).toBe(true);
  });

  it('kanji-reading weakness > 0.5 picks speed_chase', () => {
    const blocks = selectGameBlocks({
      vector: vector({ kanjiReading: 0.7 }),
      targetDurationMs: 480_000,
    });
    expect(blocks.some((b) => b.gameType === 'speed_chase')).toBe(true);
  });

  it('respects the duration budget', () => {
    const blocks = selectGameBlocks({
      vector: vector({ kanjiReading: 0.7, katakanaRecognition: 0.8 }),
      targetDurationMs: 90_000,
    });
    const total = blocks.reduce((s, b) => s + b.durationMs, 0);
    expect(total).toBeLessThanOrEqual(90_000 + 90_000); // first block always allowed even if oversize
  });

  it('long-vowel errors in topErrorTags route to a mole drill (apple_rescue stand-in)', () => {
    const blocks = selectGameBlocks({
      vector: vector({
        kanaRecognition: 0.3,
        katakanaRecognition: 0.3,
        kanjiReading: 0.2,
        topErrorTags: [{ tag: 'long_vowel_error', weight: 8 }],
      }),
      targetDurationMs: 480_000,
    });
    expect(blocks.some((b) => b.gameType === 'mole_story')).toBe(true);
  });

  it('sorts blocks by priority', () => {
    const blocks = selectGameBlocks({
      vector: vector({ katakanaRecognition: 0.8, kanjiReading: 0.7 }),
      targetDurationMs: 480_000,
    });
    for (let i = 1; i < blocks.length; i++) {
      expect(blocks[i]!.priority).toBeGreaterThanOrEqual(blocks[i - 1]!.priority);
    }
  });
});
