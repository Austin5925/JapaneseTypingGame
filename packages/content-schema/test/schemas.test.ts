import { describe, expect, it } from 'vitest';

import {
  ContentPackSchema,
  LearningItemSchema,
  SentenceItemSchema,
  SentencePackSchema,
} from '../src/schemas';

describe('LearningItemSchema', () => {
  it('accepts a minimal valid item', () => {
    const result = LearningItemSchema.safeParse({
      id: 'word-yama',
      type: 'word',
      surface: '山',
      kana: 'やま',
      romaji: ['yama'],
      meaningsZh: ['山'],
      skillTags: ['kanji_reading'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty romaji array', () => {
    const result = LearningItemSchema.safeParse({
      id: 'x',
      type: 'word',
      surface: 'x',
      kana: 'やま',
      romaji: [],
      meaningsZh: ['山'],
      skillTags: ['kanji_reading'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown skillTags', () => {
    const result = LearningItemSchema.safeParse({
      id: 'x',
      type: 'word',
      surface: 'x',
      kana: 'やま',
      romaji: ['yama'],
      meaningsZh: ['山'],
      skillTags: ['flying'],
    });
    expect(result.success).toBe(false);
  });
});

describe('ContentPackSchema', () => {
  it('rejects empty items array', () => {
    const result = ContentPackSchema.safeParse({
      id: 'p',
      name: 'p',
      version: '1',
      items: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('SentenceItemSchema', () => {
  // Three-chunk SOV sentence (私は学校へ行きます — minus the topic-particle for simplicity).
  const validSentence = {
    id: 'sent-school',
    type: 'sentence' as const,
    surface: '私は学校へ行きます',
    chunks: [
      { id: 'c1', text: '私は', kana: 'わたしは', romaji: ['watashiha'], pos: 'pronoun' as const },
      { id: 'c2', text: '学校へ', kana: 'がっこうへ', romaji: ['gakkouhe'], pos: 'noun' as const },
      { id: 'c3', text: '行きます', kana: 'いきます', romaji: ['ikimasu'], pos: 'verb' as const },
    ],
    zhPrompt: '我去学校。',
    acceptedOrders: [],
    skillTags: ['sentence_order'],
    tags: ['n5', 'foundation'],
  };

  it('accepts a minimal valid sentence', () => {
    const result = SentenceItemSchema.safeParse(validSentence);
    expect(result.success).toBe(true);
  });

  it('rejects sentence with fewer than two chunks', () => {
    const result = SentenceItemSchema.safeParse({
      ...validSentence,
      chunks: [validSentence.chunks[0]],
    });
    expect(result.success).toBe(false);
  });

  it('rejects acceptedOrders entry that misses a chunk id', () => {
    const result = SentenceItemSchema.safeParse({
      ...validSentence,
      acceptedOrders: [['c1', 'c2']], // c3 missing
    });
    expect(result.success).toBe(false);
  });

  it('rejects acceptedOrders entry with unknown chunk id', () => {
    const result = SentenceItemSchema.safeParse({
      ...validSentence,
      acceptedOrders: [['c1', 'c2', 'c99']],
    });
    expect(result.success).toBe(false);
  });

  it('rejects acceptedOrders entry with duplicates', () => {
    const result = SentenceItemSchema.safeParse({
      ...validSentence,
      acceptedOrders: [['c1', 'c2', 'c2']],
    });
    expect(result.success).toBe(false);
  });

  it('accepts acceptedOrders with a legitimate alternate ordering', () => {
    const result = SentenceItemSchema.safeParse({
      ...validSentence,
      acceptedOrders: [['c2', 'c1', 'c3']], // OSV variant
    });
    expect(result.success).toBe(true);
  });

  it('rejects duplicate chunk ids', () => {
    const result = SentenceItemSchema.safeParse({
      ...validSentence,
      chunks: [
        { ...validSentence.chunks[0]!, id: 'dup' },
        { ...validSentence.chunks[1]!, id: 'dup' },
        { ...validSentence.chunks[2]! },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe('SentencePackSchema', () => {
  it('rejects empty sentences array', () => {
    const result = SentencePackSchema.safeParse({
      id: 'pack',
      name: 'pack',
      version: '1',
      sentences: [],
    });
    expect(result.success).toBe(false);
  });
});
