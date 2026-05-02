import { describe, expect, it } from 'vitest';

import type { AttemptEventRow, ProgressDto } from '../../tauri/invoke';

import { computeSessionInsights } from './sessionInsights';

function attempt(partial: Partial<AttemptEventRow> & { itemId: string }): AttemptEventRow {
  return {
    id: `att-${partial.itemId}-${Math.random().toString(16).slice(2, 6)}`,
    sessionId: 's',
    gameType: 'mole_story',
    skillDimension: 'kana_typing',
    answerMode: 'kana_input',
    isCorrect: false,
    score: 0,
    reactionTimeMs: 2000,
    errorTags: [],
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

function progress(partial: Partial<ProgressDto> & { itemId: string }): ProgressDto {
  return {
    userId: 'default-user',
    skillDimension: 'meaning_recall',
    state: 'seen',
    masteryScore: 0,
    stability: 0,
    difficulty: 0.5,
    exposureCount: 0,
    correctCount: 0,
    wrongCount: 0,
    streak: 0,
    lapseCount: 0,
    averageReactionTimeMs: null,
    lastAttemptAt: null,
    nextDueAt: null,
    lastErrorTags: [],
    updatedAt: new Date().toISOString(),
    ...partial,
  };
}

describe('computeSessionInsights — newMistakeItemIds', () => {
  it('captures unique wrong items only once', () => {
    const result = computeSessionInsights({
      attempts: [
        attempt({ itemId: 'a', isCorrect: false }),
        attempt({ itemId: 'a', isCorrect: false }),
        attempt({ itemId: 'b', isCorrect: false }),
        attempt({ itemId: 'c', isCorrect: true }),
      ],
      currentProgress: [],
    });
    expect(result.newMistakeItemIds.sort()).toEqual(['a', 'b']);
  });

  it('returns empty when every attempt was correct', () => {
    const result = computeSessionInsights({
      attempts: [
        attempt({ itemId: 'x', isCorrect: true }),
        attempt({ itemId: 'y', isCorrect: true }),
      ],
      currentProgress: [],
    });
    expect(result.newMistakeItemIds).toEqual([]);
  });
});

describe('computeSessionInsights — newlyMasteredItemIds', () => {
  it('lists items reached stable/fluent that were touched this session', () => {
    const result = computeSessionInsights({
      attempts: [
        attempt({ itemId: 'a', isCorrect: true }),
        attempt({ itemId: 'b', isCorrect: true }),
      ],
      currentProgress: [
        progress({ itemId: 'a', skillDimension: 'kana_typing', state: 'stable', masteryScore: 82 }),
        progress({ itemId: 'b', skillDimension: 'kana_typing', state: 'fluent', masteryScore: 95 }),
        progress({ itemId: 'c', state: 'stable', masteryScore: 88 }), // not touched this session
      ],
    });
    expect(result.newlyMasteredItemIds.sort()).toEqual(['a', 'b']);
  });

  it('excludes items still in fragile/learning even if touched this session', () => {
    const result = computeSessionInsights({
      attempts: [attempt({ itemId: 'a', isCorrect: false })],
      currentProgress: [progress({ itemId: 'a', state: 'fragile', masteryScore: 40 })],
    });
    expect(result.newlyMasteredItemIds).toEqual([]);
  });

  it('does not count a mastered progress row from a skill not touched this session', () => {
    const result = computeSessionInsights({
      attempts: [attempt({ itemId: 'a', skillDimension: 'kana_typing', isCorrect: false })],
      currentProgress: [
        progress({ itemId: 'a', skillDimension: 'listening_discrimination', state: 'stable' }),
      ],
    });
    expect(result.newlyMasteredItemIds).toEqual([]);
  });

  it('does not count a mastered row when the latest same-skill attempt was wrong', () => {
    const result = computeSessionInsights({
      attempts: [
        attempt({ itemId: 'a', skillDimension: 'kana_typing', isCorrect: true }),
        attempt({ itemId: 'a', skillDimension: 'kana_typing', isCorrect: false }),
      ],
      currentProgress: [progress({ itemId: 'a', skillDimension: 'kana_typing', state: 'stable' })],
    });
    expect(result.newlyMasteredItemIds).toEqual([]);
  });
});

describe('computeSessionInsights — crossGameRecommendations', () => {
  it('routes long_vowel_error to apple_rescue + mole_story', () => {
    const result = computeSessionInsights({
      attempts: [attempt({ itemId: 'a', isCorrect: false, errorTags: ['long_vowel_error'] })],
      currentProgress: [],
    });
    const targets = result.crossGameRecommendations.map((r) => r.targetGameType);
    expect(targets).toContain('apple_rescue');
    expect(targets).toContain('mole_story');
  });

  it('aggregates weight across attempts with the same routing', () => {
    const result = computeSessionInsights({
      attempts: [
        attempt({ itemId: 'a', isCorrect: false, errorTags: ['same_sound_confusion'] }),
        attempt({ itemId: 'b', isCorrect: false, errorTags: ['same_sound_confusion'] }),
        attempt({ itemId: 'c', isCorrect: false, errorTags: ['same_sound_confusion'] }),
      ],
      currentProgress: [],
    });
    const reco = result.crossGameRecommendations.find(
      (r) => r.targetGameType === 'space_battle' && r.reason === 'same_sound_confusion',
    );
    expect(reco?.weight).toBe(3);
  });

  it('sorts recommendations by weight desc', () => {
    const result = computeSessionInsights({
      attempts: [
        // 3 same_sound (space_battle)
        attempt({ itemId: 'a', isCorrect: false, errorTags: ['same_sound_confusion'] }),
        attempt({ itemId: 'b', isCorrect: false, errorTags: ['same_sound_confusion'] }),
        attempt({ itemId: 'c', isCorrect: false, errorTags: ['same_sound_confusion'] }),
        // 1 word_order_error (river_jump)
        attempt({ itemId: 'd', isCorrect: false, errorTags: ['word_order_error'] }),
      ],
      currentProgress: [],
    });
    expect(result.crossGameRecommendations[0]!.targetGameType).toBe('space_battle');
  });

  it('drops timeout/misclick/unknown which produce no routing', () => {
    const result = computeSessionInsights({
      attempts: [
        attempt({ itemId: 'a', isCorrect: false, errorTags: ['timeout'] }),
        attempt({ itemId: 'b', isCorrect: false, errorTags: ['misclick'] }),
        attempt({ itemId: 'c', isCorrect: false, errorTags: ['unknown'] }),
      ],
      currentProgress: [],
    });
    expect(result.crossGameRecommendations).toEqual([]);
  });

  it('emits href links for each recommended game', () => {
    const result = computeSessionInsights({
      attempts: [attempt({ itemId: 'a', isCorrect: false, errorTags: ['particle_error'] })],
      currentProgress: [],
    });
    const reco = result.crossGameRecommendations[0]!;
    expect(reco.href).toBe('#/game/river-jump?skillDimension=particle_usage');
    expect(reco.label).toContain('激流勇进');
  });

  it('preserves routed skill dimensions in recommendation links', () => {
    const result = computeSessionInsights({
      attempts: [
        attempt({ itemId: 'a', isCorrect: false, errorTags: ['katakana_shape_confusion'] }),
      ],
      currentProgress: [],
    });
    const reco = result.crossGameRecommendations.find((r) => r.targetGameType === 'mole_story')!;
    expect(reco.skillDimension).toBe('katakana_recognition');
    expect(reco.href).toBe('#/game/mole?skillDimension=katakana_recognition');
  });
});
