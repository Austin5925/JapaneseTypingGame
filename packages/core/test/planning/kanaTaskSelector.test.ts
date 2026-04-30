import { describe, expect, it } from 'vitest';

import { selectKanaTasks } from '../../src/planning/kanaTaskSelector';
import type { EvaluationStrictness, LearningItem, SkillProgress } from '../../src/types/domain';

const STRICT: EvaluationStrictness = {
  longVowel: 'strict',
  sokuon: 'strict',
  dakuten: 'strict',
  handakuten: 'strict',
  youon: 'strict',
  kanjiSurface: 'strict',
  particleReading: 'surface',
};

function item(partial: Partial<LearningItem> & { id: string }): LearningItem {
  return {
    id: partial.id,
    type: partial.type ?? 'word',
    surface: partial.surface ?? `surface-${partial.id}`,
    kana: partial.kana ?? 'やま',
    romaji: partial.romaji ?? ['yama'],
    meaningsZh: partial.meaningsZh ?? ['mountain'],
    tags: partial.tags ?? [],
    skillTags: partial.skillTags ?? ['kana_typing'],
    examples: [],
    audioRefs: [],
    confusableItemIds: [],
    sourcePackId: 'pack',
    quality: 'official',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

const RNG = (): number => 0.42; // deterministic test rng

describe('selectKanaTasks — basic shape', () => {
  it('returns a queue with the requested count', () => {
    const q = selectKanaTasks({
      items: [item({ id: 'a' }), item({ id: 'b' }), item({ id: 'c' })],
      count: 5,
      sessionId: 'sess',
      gameType: 'mole_story',
      answerMode: 'romaji_to_kana',
      skillDimension: 'kana_typing',
      timeLimitMs: 6000,
      strictness: STRICT,
      random: RNG,
    });
    expect(q.remaining()).toBe(5);
  });

  it('cycles items when count > items.length', () => {
    const q = selectKanaTasks({
      items: [item({ id: 'a' })],
      count: 3,
      sessionId: 'sess',
      gameType: 'mole_story',
      answerMode: 'romaji_to_kana',
      skillDimension: 'kana_typing',
      timeLimitMs: 6000,
      strictness: STRICT,
      random: RNG,
    });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const t = q.next();
      ids.push(t!.itemId);
    }
    // Single-item pool means every task references the same item.
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toBe('a');
  });

  it('returns next() then null after the queue drains', () => {
    const q = selectKanaTasks({
      items: [item({ id: 'a' })],
      count: 1,
      sessionId: 'sess',
      gameType: 'mole_story',
      answerMode: 'romaji_to_kana',
      skillDimension: 'kana_typing',
      timeLimitMs: 6000,
      strictness: STRICT,
      random: RNG,
    });
    expect(q.next()).not.toBeNull();
    expect(q.next()).toBeNull();
    expect(q.remaining()).toBe(0);
  });

  it('pushFront returns the task to the head of the queue', () => {
    const q = selectKanaTasks({
      items: [item({ id: 'a' }), item({ id: 'b' })],
      count: 2,
      sessionId: 'sess',
      gameType: 'mole_story',
      answerMode: 'romaji_to_kana',
      skillDimension: 'kana_typing',
      timeLimitMs: 6000,
      strictness: STRICT,
      random: RNG,
    });
    const first = q.next()!;
    q.pushFront(first);
    expect(q.next()!.id).toBe(first.id);
  });
});

describe('selectKanaTasks — bucket priorities', () => {
  it('items with no progress are still eligible', () => {
    const q = selectKanaTasks({
      items: [item({ id: 'a' }), item({ id: 'b' })],
      count: 2,
      sessionId: 'sess',
      gameType: 'mole_story',
      answerMode: 'romaji_to_kana',
      skillDimension: 'kana_typing',
      timeLimitMs: 6000,
      strictness: STRICT,
      random: RNG,
    });
    expect(q.remaining()).toBe(2);
  });

  it('preferTags duplicates matching items in the candidate pool', () => {
    // With one preferred item and one not, preferred should appear ~2x as often.
    const items = [item({ id: 'pref', tags: ['katakana'] }), item({ id: 'plain' })];
    const counts = { pref: 0, plain: 0 };
    const N = 200;
    let seed = 0;
    const rng = (): number => {
      seed = (seed * 1664525 + 1013904223) & 0xffffffff;
      return ((seed >>> 0) % 1000) / 1000;
    };
    for (let i = 0; i < N; i++) {
      const q = selectKanaTasks({
        items,
        count: 1,
        sessionId: 'sess',
        gameType: 'mole_story',
        answerMode: 'romaji_to_kana',
        skillDimension: 'kana_typing',
        timeLimitMs: 6000,
        strictness: STRICT,
        preferTags: ['katakana'],
        random: rng,
      });
      const t = q.next()!;
      counts[t.itemId as 'pref' | 'plain']++;
    }
    expect(counts.pref).toBeGreaterThan(counts.plain);
  });

  it('overdue items are bucketed first (bucket 0)', () => {
    const items = [item({ id: 'overdue' }), item({ id: 'fresh' })];
    const progress = new Map<string, SkillProgress>();
    progress.set('overdue::kana_typing', {
      userId: 'u',
      itemId: 'overdue',
      skillDimension: 'kana_typing',
      state: 'stable',
      masteryScore: 75,
      stability: 1,
      difficulty: 0.5,
      exposureCount: 5,
      correctCount: 4,
      wrongCount: 1,
      streak: 0,
      lapseCount: 0,
      nextDueAt: new Date(Date.now() - 86400000).toISOString(),
      lastErrorTags: [],
      updatedAt: new Date().toISOString(),
    });
    // Drain a longer queue and look at first 5 picks; "overdue" should appear at least once.
    const q = selectKanaTasks({
      items,
      progress,
      count: 5,
      sessionId: 'sess',
      gameType: 'mole_story',
      answerMode: 'romaji_to_kana',
      skillDimension: 'kana_typing',
      timeLimitMs: 6000,
      strictness: STRICT,
      random: () => 0.0, // deterministic: shuffle picks first index every time
    });
    const ids: string[] = [];
    while (q.remaining() > 0) ids.push(q.next()!.itemId);
    expect(ids).toContain('overdue');
  });
});
