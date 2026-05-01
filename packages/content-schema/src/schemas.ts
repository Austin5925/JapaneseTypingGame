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

// ──────────────────────────────────────────────────────────────────────────
// Sentence items — v0.8 RiverJump (sentence-order training).
// Kept as a separate union member from LearningItem because the field shape diverges
// substantially: chunks/zhPrompt/acceptedOrders are sentence-specific and would force LearningItem
// into one-or-the-other ergonomics. content-cli currently ignores `sentences`; v0.8.0 loads them
// in-memory (no SQLite persistence yet) — see SentencePackSchema docs.
// ──────────────────────────────────────────────────────────────────────────

export const ChunkPosSchema = z.enum([
  'noun',
  'pronoun',
  'verb',
  'adjective',
  'adverb',
  'particle',
  'auxiliary',
  'conjunction',
  'interjection',
  'phrase',
  'other',
]);

export const SentenceChunkSchema = z.object({
  /** Stable id used in acceptedOrders[][]. */
  id: z.string().min(1),
  /** What the user sees on the lily pad (kanji/kana/mixed allowed). */
  text: z.string().min(1),
  /** Kana reading the user must type when the chunk is selected. */
  kana: z.string().min(1),
  /** Romaji forms accepted for the kana reading; must round-trip to `kana`. */
  romaji: z.array(z.string().min(1)).min(1, 'at least one romaji form is required'),
  pos: ChunkPosSchema,
  /** Optional alt-surface variants accepted (e.g. kanji vs hiragana for the same chunk). */
  acceptedSurfaces: z.array(z.string().min(1)).optional(),
});

export const SentenceItemSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('sentence'),
    /** The fully-rendered Japanese sentence (canonical order). */
    surface: z.string().min(1),
    /** Ordered chunks that compose `surface`. Order in this array is the canonical answer. */
    chunks: z.array(SentenceChunkSchema).min(2, 'a sentence needs at least two chunks'),
    /** Chinese prompt the user reads at the top of the screen. */
    zhPrompt: z.string().min(1),
    /**
     * Accepted chunk-id orderings. The canonical chunk order is always accepted; this list
     * declares additional valid orderings (e.g. SOV vs OSV with object-fronting). Empty array
     * means "only the canonical order is accepted".
     */
    acceptedOrders: z.array(z.array(z.string().min(1)).min(2)).default([]),
    jlpt: JlptSchema.optional(),
    tags: z.array(z.string()).default([]),
    /** Skill the sentence trains; almost always sentence_order/particle_usage. */
    skillTags: z.array(SkillDimensionSchema).min(1),
  })
  .refine(
    (item) => {
      // Every acceptedOrders entry must reference exactly the chunk id set, no more no less.
      const canonical = new Set(item.chunks.map((c) => c.id));
      for (const order of item.acceptedOrders) {
        if (order.length !== canonical.size) return false;
        const seen = new Set(order);
        if (seen.size !== order.length) return false;
        for (const id of order) {
          if (!canonical.has(id)) return false;
        }
      }
      return true;
    },
    {
      message:
        'each acceptedOrders entry must be a permutation of the chunk ids (no duplicates, no extras)',
      path: ['acceptedOrders'],
    },
  )
  .refine(
    (item) => {
      // Chunk ids must be unique inside one sentence.
      const ids = new Set<string>();
      for (const c of item.chunks) {
        if (ids.has(c.id)) return false;
        ids.add(c.id);
      }
      return true;
    },
    { message: 'duplicate chunk id within sentence', path: ['chunks'] },
  );

/**
 * Sentence-only content packs for v0.8 RiverJump. content-cli currently ignores these (no
 * SQLite table for sentences yet), so v0.8.0 ships sentence training as ephemeral — attempts
 * are not persisted. v0.8.x will introduce migration 005 + sentence_items table; the schema
 * here is forward-compatible.
 */
export const SentencePackSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  author: z.string().optional(),
  locale: z.string().default('zh-CN'),
  description: z.string().optional(),
  sentences: z.array(SentenceItemSchema).min(1),
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
export type SentenceChunkInput = z.infer<typeof SentenceChunkSchema>;
export type SentenceItemInput = z.infer<typeof SentenceItemSchema>;
export type SentencePackInput = z.infer<typeof SentencePackSchema>;
