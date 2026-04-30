import { describe, expect, it } from 'vitest';

import { ContentPackSchema, LearningItemSchema } from '../src/schemas';

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
