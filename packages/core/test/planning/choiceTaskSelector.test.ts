import { describe, expect, it } from 'vitest';

import { selectChoiceTasks } from '../../src/planning/choiceTaskSelector';
import type { EvaluationStrictness, LearningItem } from '../../src/types/domain';

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
    kana: partial.kana ?? 'はし',
    romaji: partial.romaji ?? ['hashi'],
    meaningsZh: partial.meaningsZh ?? [`meaning of ${partial.id}`],
    tags: partial.tags ?? [],
    skillTags: partial.skillTags ?? ['meaning_recall'],
    ...(partial.errorTags && { errorTags: partial.errorTags }),
    examples: partial.examples ?? [],
    audioRefs: [],
    confusableItemIds: partial.confusableItemIds ?? [],
    sourcePackId: 'pack',
    quality: 'official',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

const RNG = (): number => 0.42;

const trio = [
  item({
    id: 'word-bridge',
    surface: '橋',
    meaningsZh: ['桥'],
    confusableItemIds: ['word-chopsticks', 'word-edge'],
    errorTags: ['same_sound_confusion'],
    tags: ['confusable', 'hashi'],
  }),
  item({
    id: 'word-chopsticks',
    surface: '箸',
    meaningsZh: ['筷子'],
    confusableItemIds: ['word-bridge', 'word-edge'],
    errorTags: ['same_sound_confusion'],
    tags: ['confusable', 'hashi'],
  }),
  item({
    id: 'word-edge',
    surface: '端',
    meaningsZh: ['端'],
    confusableItemIds: ['word-bridge', 'word-chopsticks'],
    errorTags: ['same_sound_confusion'],
    tags: ['confusable', 'hashi'],
  }),
];

describe('selectChoiceTasks — basic shape', () => {
  it('returns a queue with the requested count', () => {
    const q = selectChoiceTasks({
      items: trio,
      count: 6,
      sessionId: 'sess',
      gameType: 'space_battle',
      skillDimension: 'meaning_recall',
      strictness: STRICT,
      distractorCount: 2,
      random: RNG,
    });
    expect(q.remaining()).toBe(6);
  });

  it('produces tasks whose answerMode is option_select and options.length === distractor+1', () => {
    const q = selectChoiceTasks({
      items: trio,
      count: 1,
      sessionId: 'sess',
      gameType: 'space_battle',
      skillDimension: 'meaning_recall',
      strictness: STRICT,
      distractorCount: 2,
      random: RNG,
    });
    const t = q.next()!;
    expect(t.answerMode).toBe('option_select');
    expect(t.options).toHaveLength(3);
    const correct = t.options!.filter((o) => o.isCorrect);
    expect(correct).toHaveLength(1);
    expect(t.expected.optionId).toBe(correct[0]!.id);
  });

  it('uses confusableItemIds first when filling distractors', () => {
    // Pool is the trio only — correctItem is any of them and its two distractors must come
    // from the other two trio members because each declares the others as confusable.
    const q = selectChoiceTasks({
      items: trio,
      count: 1,
      sessionId: 'sess',
      gameType: 'space_battle',
      skillDimension: 'meaning_recall',
      strictness: STRICT,
      distractorCount: 2,
      random: RNG,
    });
    const t = q.next()!;
    const ids = t.options!.map((o) => o.itemId).filter((x): x is string => Boolean(x));
    const trioIds = new Set(['word-bridge', 'word-chopsticks', 'word-edge']);
    for (const id of ids) {
      expect(trioIds.has(id)).toBe(true);
    }
  });

  it('propagates errorTagIfChosen from the distractor item', () => {
    const q = selectChoiceTasks({
      items: trio,
      count: 1,
      sessionId: 'sess',
      gameType: 'space_battle',
      skillDimension: 'meaning_recall',
      strictness: STRICT,
      distractorCount: 2,
      random: RNG,
    });
    const t = q.next()!;
    const wrongs = t.options!.filter((o) => !o.isCorrect);
    expect(wrongs.length).toBeGreaterThan(0);
    for (const w of wrongs) {
      expect(w.errorTagIfChosen).toBe('same_sound_confusion');
    }
  });

  it('falls back to global pool distractors when confusables are missing', () => {
    // All four items have empty confusableItemIds. Selector should still produce a valid
    // 3-option task by drawing distractors from the global pool, with no duplicates and
    // none equal to the correct option.
    const all = [
      item({ id: 'lonely', surface: '孤', meaningsZh: ['孤'] }),
      item({ id: 'fill-1', surface: '一', meaningsZh: ['一'] }),
      item({ id: 'fill-2', surface: '二', meaningsZh: ['二'] }),
      item({ id: 'fill-3', surface: '三', meaningsZh: ['三'] }),
    ];
    const q = selectChoiceTasks({
      items: all,
      count: 1,
      sessionId: 'sess',
      gameType: 'space_battle',
      skillDimension: 'meaning_recall',
      strictness: STRICT,
      distractorCount: 2,
      random: RNG,
    });
    const t = q.next()!;
    expect(t.options).toHaveLength(3);
    const ids = t.options!.map((o) => o.itemId).filter((x): x is string => Boolean(x));
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
    const correct = t.options!.find((o) => o.isCorrect)!;
    const distractorIds = t
      .options!.filter((o) => !o.isCorrect)
      .map((o) => o.itemId)
      .filter((x): x is string => Boolean(x));
    for (const id of distractorIds) {
      expect(id).not.toBe(correct.itemId);
    }
  });

  it('skips items lacking enough distractors', () => {
    // Only 1 item total in the pool → cannot build a 3-option ChoiceTask.
    const q = selectChoiceTasks({
      items: [item({ id: 'solo' })],
      count: 3,
      sessionId: 'sess',
      gameType: 'space_battle',
      skillDimension: 'meaning_recall',
      strictness: STRICT,
      distractorCount: 2,
      random: RNG,
    });
    expect(q.remaining()).toBe(0);
  });

  it('honours timeLimitMs override', () => {
    const q = selectChoiceTasks({
      items: trio,
      count: 1,
      sessionId: 'sess',
      gameType: 'space_battle',
      skillDimension: 'meaning_recall',
      strictness: STRICT,
      distractorCount: 2,
      timeLimitMs: 9000,
      random: RNG,
    });
    expect(q.next()!.timeLimitMs).toBe(9000);
  });

  it('builds a meaning-prompt by default', () => {
    const q = selectChoiceTasks({
      items: trio,
      count: 1,
      sessionId: 'sess',
      gameType: 'space_battle',
      skillDimension: 'meaning_recall',
      strictness: STRICT,
      distractorCount: 2,
      random: RNG,
    });
    const t = q.next()!;
    expect(t.prompt.kind).toBe('meaning');
    // Whichever of the trio became the correct item, the prompt must carry that item's
    // first Chinese meaning — not a distractor's.
    expect(['桥', '筷子', '端']).toContain(t.prompt.meaningZh);
  });

  it('reading prompt mode emits the kana as the prompt text', () => {
    const q = selectChoiceTasks({
      items: trio,
      count: 1,
      sessionId: 'sess',
      gameType: 'space_battle',
      skillDimension: 'meaning_recall',
      strictness: STRICT,
      distractorCount: 2,
      promptKind: 'reading',
      random: RNG,
    });
    const t = q.next()!;
    expect(t.prompt.kind).toBe('text');
    // All three trio members share the kana 'はし' (this is what makes them confusable).
    expect(t.prompt.text).toBe('はし');
  });

  it('pushFront returns a previously popped task to the head', () => {
    const q = selectChoiceTasks({
      items: trio,
      count: 2,
      sessionId: 'sess',
      gameType: 'space_battle',
      skillDimension: 'meaning_recall',
      strictness: STRICT,
      distractorCount: 2,
      random: RNG,
    });
    const first = q.next()!;
    q.pushFront(first);
    expect(q.next()).toBe(first);
  });
});
