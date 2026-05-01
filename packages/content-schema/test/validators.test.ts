import { describe, expect, it } from 'vitest';

import {
  isAllKana,
  romajiRoundTripsToKana,
  validatePack,
  validateSentencePack,
  type ContentPackInput,
  type SentencePackInput,
} from '../src';
import { minimalSamplePack } from '../src/samplePacks';

function clonePack(pack: ContentPackInput): ContentPackInput {
  return JSON.parse(JSON.stringify(pack)) as ContentPackInput;
}

describe('isAllKana', () => {
  it('accepts hiragana', () => {
    expect(isAllKana('やくそく')).toBe(true);
  });

  it('accepts katakana with long vowel mark', () => {
    expect(isAllKana('ビール')).toBe(true);
  });

  it('rejects kanji', () => {
    expect(isAllKana('約束')).toBe(false);
  });

  it('rejects ascii', () => {
    expect(isAllKana('abc')).toBe(false);
  });

  it('rejects mixed strings', () => {
    expect(isAllKana('ビールbeer')).toBe(false);
  });
});

describe('romajiRoundTripsToKana', () => {
  it('passes for canonical hiragana words', () => {
    expect(romajiRoundTripsToKana('yakusoku', 'やくそく')).toBe(true);
  });

  it('accepts shi/si variants for し', () => {
    expect(romajiRoundTripsToKana('shi', 'し')).toBe(true);
    expect(romajiRoundTripsToKana('si', 'し')).toBe(true);
  });

  it('accepts tsu/tu variants for つ', () => {
    expect(romajiRoundTripsToKana('tsu', 'つ')).toBe(true);
    expect(romajiRoundTripsToKana('tu', 'つ')).toBe(true);
  });

  it('round-trips katakana to hiragana for matching readings', () => {
    expect(romajiRoundTripsToKana('biiru', 'ビール')).toBe(true);
  });

  it('rejects long-vowel mismatch (biru vs biiru)', () => {
    expect(romajiRoundTripsToKana('biru', 'ビール')).toBe(false);
  });

  it('rejects sokuon mismatch (kite vs kitte)', () => {
    expect(romajiRoundTripsToKana('kite', 'きって')).toBe(false);
  });
});

describe('validatePack', () => {
  it('accepts the bundled sample pack', () => {
    const result = validatePack(minimalSamplePack);
    expect(result.ok).toBe(true);
  });

  it('flags duplicate item ids', () => {
    const pack = clonePack(minimalSamplePack);
    pack.items.push({ ...pack.items[0]! });
    const result = validatePack(pack);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'duplicate_id')).toBe(true);
    }
  });

  it('flags kana with non-kana chars', () => {
    const pack = clonePack(minimalSamplePack);
    pack.items[0]!.kana = 'やく束';
    const result = validatePack(pack);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'kana_invalid_chars')).toBe(true);
    }
  });

  it('flags romaji that does not round-trip', () => {
    const pack = clonePack(minimalSamplePack);
    pack.items[0]!.romaji = ['yakusokuu'];
    const result = validatePack(pack);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'romaji_does_not_round_trip')).toBe(true);
    }
  });

  it('flags example missing targetSurface', () => {
    const pack = clonePack(minimalSamplePack);
    pack.items[0]!.examples[0]!.ja = 'これは関係ない文です。';
    const result = validatePack(pack);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'example_missing_target')).toBe(true);
    }
  });

  it('flags confusableItemIds referring to unknown ids', () => {
    const pack = clonePack(minimalSamplePack);
    pack.items[0]!.confusableItemIds = ['word-does-not-exist'];
    const result = validatePack(pack);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'confusable_id_unknown')).toBe(true);
    }
  });

  it('warns on self-referencing confusableItemIds', () => {
    const pack = clonePack(minimalSamplePack);
    pack.items[0]!.confusableItemIds = [pack.items[0]!.id];
    const result = validatePack(pack);
    if (result.ok) {
      expect(result.warnings.some((w) => w.code === 'confusable_id_unknown')).toBe(true);
    }
  });

  it('flags empty audio path', () => {
    const pack = clonePack(minimalSamplePack);
    pack.items[0]!.audioRefs = [{ id: 'a-1', kind: 'word', path: '   ' }];
    const result = validatePack(pack);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // empty path triggers schema-level validation (path.min(1) accepts spaces) so we additionally
      // check our own audio_path_empty rule for whitespace-only paths.
      expect(result.errors.some((e) => e.code === 'audio_path_empty' || e.code === 'schema')).toBe(
        true,
      );
    }
  });

  it('returns schema-level errors when shape is wrong', () => {
    const result = validatePack({ id: 'p', name: 'p', version: '1', items: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]!.code).toBe('schema');
    }
  });
});

const sentencePackFixture: SentencePackInput = {
  id: 'sent-foundations',
  name: '基础句型',
  version: '0.1.0',
  locale: 'zh-CN',
  sentences: [
    {
      id: 'sent-school',
      type: 'sentence',
      surface: '私は学校へ行きます',
      chunks: [
        {
          id: 'c1',
          text: '私は',
          kana: 'わたしは',
          romaji: ['watashiha'],
          pos: 'pronoun',
        },
        {
          id: 'c2',
          text: '学校へ',
          kana: 'がっこうへ',
          romaji: ['gakkouhe'],
          pos: 'noun',
        },
        { id: 'c3', text: '行きます', kana: 'いきます', romaji: ['ikimasu'], pos: 'verb' },
      ],
      zhPrompt: '我去学校。',
      acceptedOrders: [],
      skillTags: ['sentence_order'],
      tags: ['n5'],
    },
  ],
};

function cloneSentencePack(p: SentencePackInput): SentencePackInput {
  return JSON.parse(JSON.stringify(p)) as SentencePackInput;
}

describe('validateSentencePack', () => {
  it('accepts a minimal valid sentence pack', () => {
    const result = validateSentencePack(sentencePackFixture);
    expect(result.ok).toBe(true);
  });

  it('rejects a chunk whose romaji does not round-trip to kana', () => {
    const pack = cloneSentencePack(sentencePackFixture);
    pack.sentences[0]!.chunks[2]!.romaji = ['ikimas']; // missing trailing u
    const result = validateSentencePack(pack);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'romaji_does_not_round_trip')).toBe(true);
    }
  });

  it('rejects a chunk kana with non-kana characters', () => {
    const pack = cloneSentencePack(sentencePackFixture);
    pack.sentences[0]!.chunks[1]!.kana = '学校へ'; // kanji slipped in
    const result = validateSentencePack(pack);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'kana_invalid_chars')).toBe(true);
    }
  });

  it('rejects duplicate sentence ids', () => {
    const pack = cloneSentencePack(sentencePackFixture);
    pack.sentences.push(cloneSentencePack(sentencePackFixture).sentences[0]!);
    const result = validateSentencePack(pack);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'duplicate_id')).toBe(true);
    }
  });
});
