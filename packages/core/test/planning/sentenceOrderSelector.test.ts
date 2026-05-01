import { describe, expect, it } from 'vitest';

import {
  selectSentenceOrderTasks,
  type SentenceItem,
} from '../../src/planning/sentenceOrderSelector';
import type { EvaluationStrictness } from '../../src/types/domain';

const STRICT: EvaluationStrictness = {
  longVowel: 'strict',
  sokuon: 'strict',
  dakuten: 'strict',
  handakuten: 'strict',
  youon: 'strict',
  kanjiSurface: 'strict',
  particleReading: 'surface',
};

function sentence(partial: Partial<SentenceItem> & { id: string }): SentenceItem {
  return {
    id: partial.id,
    surface: partial.surface ?? '私は学校へ行きます',
    chunks: partial.chunks ?? [
      { id: 'c1', text: '私は', kana: 'わたしは', romaji: ['watashiha'] },
      { id: 'c2', text: '学校へ', kana: 'がっこうへ', romaji: ['gakkouhe'] },
      { id: 'c3', text: '行きます', kana: 'いきます', romaji: ['ikimasu'] },
    ],
    zhPrompt: partial.zhPrompt ?? '我去学校。',
    acceptedOrders: partial.acceptedOrders ?? [],
    tags: partial.tags ?? [],
    skillTags: partial.skillTags ?? ['sentence_order'],
  };
}

const RNG = (): number => 0.42;

describe('selectSentenceOrderTasks — basic shape', () => {
  it('returns a queue with the requested count', () => {
    const q = selectSentenceOrderTasks({
      sentences: [sentence({ id: 'a' }), sentence({ id: 'b' })],
      count: 4,
      sessionId: 'sess',
      gameType: 'river_jump',
      skillDimension: 'sentence_order',
      strictness: STRICT,
      random: RNG,
    });
    expect(q.remaining()).toBe(4);
  });

  it('produces tasks whose expected.chunkOrder matches sentence chunk order', () => {
    const q = selectSentenceOrderTasks({
      sentences: [sentence({ id: 'a' })],
      count: 1,
      sessionId: 'sess',
      gameType: 'river_jump',
      skillDimension: 'sentence_order',
      strictness: STRICT,
      random: RNG,
    });
    const task = q.next();
    expect(task).not.toBeNull();
    expect(task!.answerMode).toBe('sentence_chunk_order');
    expect(task!.expected.chunkOrder).toEqual(['c1', 'c2', 'c3']);
    expect(task!.expected.chunks).toHaveLength(3);
    expect(task!.gameType).toBe('river_jump');
  });

  it('forwards acceptedOrders to the task as acceptedChunkOrders', () => {
    const q = selectSentenceOrderTasks({
      sentences: [
        sentence({
          id: 'osv',
          acceptedOrders: [['c2', 'c1', 'c3']],
        }),
      ],
      count: 1,
      sessionId: 'sess',
      gameType: 'river_jump',
      skillDimension: 'sentence_order',
      strictness: STRICT,
      random: RNG,
    });
    const task = q.next()!;
    expect(task.expected.acceptedChunkOrders).toEqual([['c2', 'c1', 'c3']]);
  });

  it('omits acceptedChunkOrders when sentence has no alternates', () => {
    const q = selectSentenceOrderTasks({
      sentences: [sentence({ id: 'plain' })],
      count: 1,
      sessionId: 'sess',
      gameType: 'river_jump',
      skillDimension: 'sentence_order',
      strictness: STRICT,
      random: RNG,
    });
    const task = q.next()!;
    expect(task.expected.acceptedChunkOrders).toBeUndefined();
  });

  it('cycles sentences when count > sentences.length', () => {
    const q = selectSentenceOrderTasks({
      sentences: [sentence({ id: 'only' })],
      count: 3,
      sessionId: 'sess',
      gameType: 'river_jump',
      skillDimension: 'sentence_order',
      strictness: STRICT,
      random: RNG,
    });
    expect(q.remaining()).toBe(3);
  });

  it('returns an empty queue when no sentences are supplied', () => {
    const q = selectSentenceOrderTasks({
      sentences: [],
      count: 5,
      sessionId: 'sess',
      gameType: 'river_jump',
      skillDimension: 'sentence_order',
      strictness: STRICT,
      random: RNG,
    });
    expect(q.remaining()).toBe(0);
    expect(q.next()).toBeNull();
  });

  it('pushFront returns a previously-popped task to the head', () => {
    const q = selectSentenceOrderTasks({
      sentences: [sentence({ id: 'a' }), sentence({ id: 'b' })],
      count: 2,
      sessionId: 'sess',
      gameType: 'river_jump',
      skillDimension: 'sentence_order',
      strictness: STRICT,
      random: RNG,
    });
    const first = q.next()!;
    q.pushFront(first);
    expect(q.next()).toBe(first);
  });

  it('honours timeLimitMs override', () => {
    const q = selectSentenceOrderTasks({
      sentences: [sentence({ id: 'a' })],
      count: 1,
      sessionId: 'sess',
      gameType: 'river_jump',
      skillDimension: 'sentence_order',
      strictness: STRICT,
      timeLimitMs: 25_000,
      random: RNG,
    });
    expect(q.next()!.timeLimitMs).toBe(25_000);
  });
});

describe('selectSentenceOrderTasks — preferTags weighting', () => {
  it('biases towards tagged sentences without excluding the rest', () => {
    const tagged = sentence({ id: 'tagged', tags: ['particle'] });
    const untagged = sentence({ id: 'plain' });
    const q = selectSentenceOrderTasks({
      sentences: [untagged, tagged],
      count: 6,
      sessionId: 'sess',
      gameType: 'river_jump',
      skillDimension: 'sentence_order',
      strictness: STRICT,
      preferTags: ['particle'],
      random: RNG,
    });
    expect(q.remaining()).toBe(6);
    let tagSeen = 0;
    let untagSeen = 0;
    while (q.remaining() > 0) {
      const t = q.next()!;
      if (t.itemId === 'tagged') tagSeen++;
      else untagSeen++;
    }
    expect(tagSeen).toBeGreaterThan(untagSeen);
    expect(untagSeen).toBeGreaterThan(0);
  });
});
