// Closed enums for domain core. Keep values stable — they may be persisted in SQLite
// and referenced by content packs. Adding a value is safe; renaming/removing is a breaking change.

export type GameType =
  | 'mole_story'
  | 'speed_chase'
  | 'space_battle'
  | 'river_jump'
  | 'apple_rescue'
  | 'boss_round'
  | 'real_input';

export const ALL_GAME_TYPES: readonly GameType[] = [
  'mole_story',
  'speed_chase',
  'space_battle',
  'river_jump',
  'apple_rescue',
  'boss_round',
  'real_input',
] as const;

export type SkillDimension =
  | 'kana_recognition'
  | 'kana_typing'
  | 'katakana_recognition'
  | 'kanji_reading'
  | 'meaning_recall'
  | 'ime_conversion'
  | 'listening_discrimination'
  | 'particle_usage'
  | 'sentence_order'
  | 'active_output';

export const ALL_SKILL_DIMENSIONS: readonly SkillDimension[] = [
  'kana_recognition',
  'kana_typing',
  'katakana_recognition',
  'kanji_reading',
  'meaning_recall',
  'ime_conversion',
  'listening_discrimination',
  'particle_usage',
  'sentence_order',
  'active_output',
] as const;

export type ErrorTag =
  | 'kana_shape_confusion'
  | 'katakana_shape_confusion'
  | 'dakuten_error'
  | 'handakuten_error'
  | 'sokuon_error'
  | 'long_vowel_error'
  | 'youon_error'
  | 'n_error'
  | 'particle_error'
  | 'kanji_reading_error'
  | 'same_sound_confusion'
  | 'near_sound_confusion'
  | 'meaning_confusion'
  | 'ime_conversion_error'
  | 'word_order_error'
  | 'timeout'
  | 'misclick'
  | 'unknown';

export const ALL_ERROR_TAGS: readonly ErrorTag[] = [
  'kana_shape_confusion',
  'katakana_shape_confusion',
  'dakuten_error',
  'handakuten_error',
  'sokuon_error',
  'long_vowel_error',
  'youon_error',
  'n_error',
  'particle_error',
  'kanji_reading_error',
  'same_sound_confusion',
  'near_sound_confusion',
  'meaning_confusion',
  'ime_conversion_error',
  'word_order_error',
  'timeout',
  'misclick',
  'unknown',
] as const;

// Severe errors are domain-meaningful (long vowel / sokuon / dakuten / particle / meaning / IME).
// Speed bonuses cannot offset these — see `scoreAttempt` in evaluation/scoring.ts (Sprint 2).
export const SEVERE_ERROR_TAGS: readonly ErrorTag[] = [
  'long_vowel_error',
  'sokuon_error',
  'dakuten_error',
  'particle_error',
  'meaning_confusion',
  'ime_conversion_error',
] as const;

export type AnswerMode =
  | 'romaji_to_kana'
  | 'kana_input'
  | 'kanji_to_reading'
  | 'meaning_to_surface'
  | 'audio_to_surface'
  | 'sentence_chunk_order'
  | 'option_select'
  | 'ime_surface';

export type MasteryState =
  | 'new'
  | 'seen'
  | 'learning'
  | 'fragile'
  | 'stable'
  | 'fluent'
  | 'cooldown';

export type LearningItemType =
  | 'kana'
  | 'word'
  | 'phrase'
  | 'sentence'
  | 'grammar_pattern'
  | 'minimal_pair';

export type LearningItemQuality = 'official' | 'verified' | 'user_imported' | 'needs_review';

export type Jlpt = 'N5' | 'N4' | 'N3' | 'N2' | 'N1' | 'none';
