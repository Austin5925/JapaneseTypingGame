import { z } from 'zod';

// Closed enums mirror @kana-typing/core. Kept here as Zod literals so that pack-time validation
// is independent of the runtime types — a content pack file can be validated even without core
// types loaded (e.g. by content-cli in a fresh environment).

export const LearningItemTypeSchema = z.enum([
  'kana',
  'word',
  'phrase',
  'sentence',
  'grammar_pattern',
  'minimal_pair',
]);

export const JlptSchema = z.enum(['N5', 'N4', 'N3', 'N2', 'N1', 'none']);

export const SkillDimensionSchema = z.enum([
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
]);

export const ErrorTagSchema = z.enum([
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
]);

export const AudioRefKindSchema = z.enum(['word', 'sentence', 'cue', 'sfx']);

export const AudioRefSchema = z.object({
  id: z.string().min(1),
  kind: AudioRefKindSchema,
  path: z.string().min(1, 'audio path must not be empty'),
  durationMs: z.number().int().nonnegative().optional(),
  speaker: z.string().optional(),
  speed: z.enum(['normal', 'slow']).optional(),
});

export const ExampleSentenceSchema = z.object({
  id: z.string().min(1),
  ja: z.string().min(1),
  kana: z.string().optional(),
  zh: z.string().min(1),
  targetSurface: z.string().optional(),
  targetKana: z.string().optional(),
  audioRef: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const LearningItemSchema = z.object({
  id: z.string().min(1),
  type: LearningItemTypeSchema,
  surface: z.string().min(1),
  kana: z.string().min(1),
  romaji: z.array(z.string().min(1)).min(1, 'at least one romaji form is required'),
  meaningsZh: z.array(z.string().min(1)).min(1, 'at least one zh meaning is required'),
  meaningsEn: z.array(z.string().min(1)).optional(),
  pos: z.string().optional(),
  jlpt: JlptSchema.optional(),
  tags: z.array(z.string()).default([]),
  skillTags: z.array(SkillDimensionSchema).min(1),
  errorTags: z.array(ErrorTagSchema).optional(),
  acceptedSurfaces: z.array(z.string().min(1)).optional(),
  acceptedKana: z.array(z.string().min(1)).optional(),
  examples: z.array(ExampleSentenceSchema).default([]),
  audioRefs: z.array(AudioRefSchema).default([]),
  confusableItemIds: z.array(z.string().min(1)).default([]),
});

export const ContentPackSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  author: z.string().optional(),
  locale: z.string().default('zh-CN'),
  description: z.string().optional(),
  items: z.array(LearningItemSchema).min(1),
});

export type LearningItemInput = z.infer<typeof LearningItemSchema>;
export type ContentPackInput = z.infer<typeof ContentPackSchema>;
export type ExampleSentenceInput = z.infer<typeof ExampleSentenceSchema>;
export type AudioRefInput = z.infer<typeof AudioRefSchema>;
