import { describe, expect, it } from 'vitest';

import { selectBossSession } from '../../src/planning/bossSessionSelector';
import type { SentenceItem } from '../../src/planning/sentenceOrderSelector';
import type { LearningItem, SkillProgress } from '../../src/types/domain';

function progress(partial: Partial<SkillProgress> & { itemId: string }): SkillProgress {
  return {
    userId: 'default-user',
    skillDimension: 'meaning_recall',
    state: 'fragile',
    masteryScore: 30,
    stability: 0,
    difficulty: 0.5,
    exposureCount: 5,
    correctCount: 2,
    wrongCount: 3,
    streak: 0,
    lapseCount: 1,
    averageReactionTimeMs: 4000,
    lastErrorTags: [],
    updatedAt: '2026-05-02T00:00:00Z',
    ...partial,
  };
}

function item(partial: Partial<LearningItem> & { id: string }): LearningItem {
  return {
    id: partial.id,
    type: 'word',
    surface: partial.surface ?? `surface-${partial.id}`,
    kana: partial.kana ?? 'はし',
    romaji: partial.romaji ?? ['hashi'],
    meaningsZh: partial.meaningsZh ?? ['meaning'],
    tags: partial.tags ?? [],
    skillTags: partial.skillTags ?? ['meaning_recall'],
    examples: [],
    audioRefs: [],
    confusableItemIds: [],
    sourcePackId: 'p',
    quality: 'official',
    createdAt: '',
    updatedAt: '',
  };
}

function sentence(id: string): SentenceItem {
  return {
    id,
    surface: '私は学校へ行きます',
    chunks: [
      { id: 'c1', text: '私は', kana: 'わたしは', romaji: ['watashiha'] },
      { id: 'c2', text: '学校へ', kana: 'がっこうへ', romaji: ['gakkoue'] },
      { id: 'c3', text: '行きます', kana: 'いきます', romaji: ['ikimasu'] },
    ],
    zhPrompt: '我去学校。',
    acceptedOrders: [],
    tags: [],
    skillTags: ['sentence_order'],
  };
}

describe('selectBossSession — empty cases', () => {
  it('returns no segments when there is no progress', () => {
    const out = selectBossSession({
      progress: [],
      learningItems: [],
      sentenceItems: [],
    });
    expect(out.segments).toEqual([]);
    expect(out.weakCandidateCount).toBe(0);
  });

  it('returns no segments when every progress row is stable / fluent and clean', () => {
    const out = selectBossSession({
      progress: [
        progress({ itemId: 'a', state: 'stable', lastErrorTags: [] }),
        progress({ itemId: 'b', state: 'fluent', lastErrorTags: [] }),
      ],
      learningItems: [item({ id: 'a' }), item({ id: 'b' })],
      sentenceItems: [],
    });
    expect(out.weakCandidateCount).toBe(0);
    expect(out.segments).toEqual([]);
  });
});

describe('selectBossSession — bucket routing', () => {
  it('routes long_vowel_error rows into apple_rescue + mole_story segments', () => {
    const out = selectBossSession({
      progress: [
        progress({
          itemId: 'a',
          state: 'fragile',
          lastErrorTags: ['long_vowel_error'],
          wrongCount: 4,
        }),
        progress({
          itemId: 'b',
          state: 'fragile',
          lastErrorTags: ['long_vowel_error'],
          wrongCount: 3,
        }),
      ],
      learningItems: [item({ id: 'a' }), item({ id: 'b' })],
      sentenceItems: [],
      itemsPerSegment: 5,
    });
    const targets = out.segments.map((s) => s.gameType);
    expect(targets).toContain('apple_rescue');
    expect(targets).toContain('mole_story');
  });

  it('sorts segments by aggregate weight desc', () => {
    const out = selectBossSession({
      progress: [
        // 3 items routed to space_battle (heavy weight)
        progress({
          itemId: 'a',
          lastErrorTags: ['same_sound_confusion'],
          wrongCount: 5,
          lapseCount: 2,
        }),
        progress({
          itemId: 'b',
          lastErrorTags: ['same_sound_confusion'],
          wrongCount: 5,
          lapseCount: 2,
        }),
        progress({
          itemId: 'c',
          lastErrorTags: ['same_sound_confusion'],
          wrongCount: 5,
          lapseCount: 2,
        }),
        // 1 item routed to river_jump (lighter)
        progress({
          itemId: 'd',
          lastErrorTags: ['word_order_error'],
          wrongCount: 1,
          lapseCount: 0,
        }),
      ],
      learningItems: [item({ id: 'a' }), item({ id: 'b' }), item({ id: 'c' })],
      sentenceItems: [sentence('d')],
    });
    expect(out.segments[0]!.gameType).toBe('space_battle');
  });

  it('caps segments at segmentCount', () => {
    const out = selectBossSession({
      progress: [
        progress({ itemId: 'a', lastErrorTags: ['long_vowel_error'] }),
        progress({ itemId: 'b', lastErrorTags: ['same_sound_confusion'] }),
        progress({ itemId: 'c', lastErrorTags: ['word_order_error'] }),
        progress({ itemId: 'd', lastErrorTags: ['kanji_reading_error'] }),
      ],
      learningItems: [item({ id: 'a' }), item({ id: 'b' }), item({ id: 'd' })],
      sentenceItems: [sentence('c')],
      segmentCount: 2,
    });
    expect(out.segments.length).toBeLessThanOrEqual(2);
  });

  it('drops a bucket when no matching content exists', () => {
    // long_vowel_error wants apple_rescue + mole_story, but the user has no LearningItem
    // for the weak progress row — both buckets must be dropped.
    const out = selectBossSession({
      progress: [
        progress({
          itemId: 'orphan',
          lastErrorTags: ['long_vowel_error'],
          wrongCount: 2,
        }),
      ],
      learningItems: [],
      sentenceItems: [],
    });
    expect(out.segments).toEqual([]);
    expect(out.weakCandidateCount).toBe(1); // weak count counted, but no segment built
  });

  it('does not let an unplayable heavy bucket consume the segment budget', () => {
    const out = selectBossSession({
      progress: [
        progress({
          itemId: 'orphan',
          lastErrorTags: ['same_sound_confusion'],
          wrongCount: 99,
        }),
        progress({
          itemId: 'sent-a',
          skillDimension: 'sentence_order',
          lastErrorTags: ['word_order_error'],
          wrongCount: 1,
        }),
      ],
      learningItems: [],
      sentenceItems: [sentence('sent-a')],
      segmentCount: 1,
    });
    expect(out.segments).toHaveLength(1);
    expect(out.segments[0]!.gameType).toBe('river_jump');
  });
});

describe('selectBossSession — sentence routing', () => {
  it('uses SentenceItems for river_jump segments', () => {
    const out = selectBossSession({
      progress: [
        progress({
          itemId: 'sent-a',
          skillDimension: 'sentence_order',
          lastErrorTags: ['word_order_error'],
          wrongCount: 4,
        }),
      ],
      learningItems: [],
      sentenceItems: [sentence('sent-a')],
    });
    const seg = out.segments[0]!;
    expect(seg.gameType).toBe('river_jump');
    expect(seg.content.kind).toBe('sentences');
    if (seg.content.kind === 'sentences') {
      expect(seg.content.sentences[0]!.id).toBe('sent-a');
    }
  });

  it('keeps particle_usage on particle-error river segments', () => {
    const out = selectBossSession({
      progress: [
        progress({
          itemId: 'sent-a',
          skillDimension: 'particle_usage',
          lastErrorTags: ['particle_error'],
          wrongCount: 3,
        }),
      ],
      learningItems: [],
      sentenceItems: [sentence('sent-a')],
    });
    const seg = out.segments[0]!;
    expect(seg.gameType).toBe('river_jump');
    expect(seg.skillDimension).toBe('particle_usage');
  });

  it('falls back to default routing when lastErrorTags is empty but state is fragile', () => {
    const out = selectBossSession({
      progress: [
        progress({
          itemId: 'a',
          state: 'fragile',
          lastErrorTags: [],
          skillDimension: 'kanji_reading',
        }),
      ],
      learningItems: [item({ id: 'a' })],
      sentenceItems: [],
    });
    expect(out.segments[0]!.gameType).toBe('speed_chase');
  });

  it('keeps fallback kana-recognition dimensions instead of collapsing to kana_typing', () => {
    const out = selectBossSession({
      progress: [
        progress({
          itemId: 'kata-a',
          state: 'fragile',
          lastErrorTags: [],
          skillDimension: 'katakana_recognition',
        }),
      ],
      learningItems: [
        item({ id: 'kata-a', tags: ['katakana'], skillTags: ['katakana_recognition'] }),
      ],
      sentenceItems: [],
    });
    expect(out.segments[0]!.gameType).toBe('mole_story');
    expect(out.segments[0]!.skillDimension).toBe('katakana_recognition');
  });
});

describe('selectBossSession — choice support pool', () => {
  it('adds support items for choice-game distractors while keeping taskCount focused', () => {
    const out = selectBossSession({
      progress: [
        progress({
          itemId: 'weak-a',
          lastErrorTags: ['same_sound_confusion'],
          wrongCount: 4,
        }),
      ],
      learningItems: [
        item({ id: 'weak-a' }),
        item({ id: 'support-b' }),
        item({ id: 'support-c' }),
        item({ id: 'support-d' }),
      ],
      sentenceItems: [],
    });
    const seg = out.segments.find((s) => s.gameType === 'space_battle')!;
    expect(seg.taskCount).toBe(1);
    expect(seg.content.kind).toBe('words');
    if (seg.content.kind === 'words') {
      expect(seg.content.items.map((it) => it.id)).toContain('weak-a');
      expect(seg.content.items.length).toBeGreaterThanOrEqual(4);
    }
  });
});
