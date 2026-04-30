import type { ContentPackInput } from './schemas';

// Tiny pack used by tests and content-cli smoke tests. Real official packs live in /content.
export const minimalSamplePack: ContentPackInput = {
  id: 'sample-mini',
  name: 'Sample Mini Pack',
  version: '0.1.0',
  author: 'Kana Typing Team',
  locale: 'zh-CN',
  description: 'Two-item smoke-test pack used by validator tests.',
  items: [
    {
      id: 'word-yakusoku',
      type: 'word',
      surface: '約束',
      kana: 'やくそく',
      romaji: ['yakusoku'],
      meaningsZh: ['约定'],
      pos: 'noun',
      jlpt: 'N4',
      tags: ['daily', 'kanji_word'],
      skillTags: ['kanji_reading', 'meaning_recall', 'ime_conversion'],
      examples: [
        {
          id: 'ex-yakusoku-1',
          ja: '明日、友達と約束があります。',
          kana: 'あした、ともだちとやくそくがあります。',
          zh: '明天我和朋友有约。',
          targetSurface: '約束',
          targetKana: 'やくそく',
        },
      ],
      audioRefs: [],
      confusableItemIds: [],
    },
    {
      id: 'word-biiru',
      type: 'word',
      surface: 'ビール',
      kana: 'ビール',
      romaji: ['biiru'],
      meaningsZh: ['啤酒'],
      pos: 'noun',
      jlpt: 'N5',
      tags: ['daily', 'katakana', 'long_vowel'],
      skillTags: ['katakana_recognition', 'listening_discrimination'],
      examples: [
        {
          id: 'ex-biiru-1',
          ja: 'ビールを飲みます。',
          kana: 'びーるをのみます。',
          zh: '喝啤酒。',
          targetSurface: 'ビール',
        },
      ],
      audioRefs: [],
      confusableItemIds: [],
    },
  ],
};
