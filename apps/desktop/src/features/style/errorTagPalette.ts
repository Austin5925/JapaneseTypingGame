import type { ErrorTag } from '@kana-typing/core';

/**
 * Map every {@link ErrorTag} to a CSS variable defined in styles.css. The
 * palette has 9 distinct hues (long_vowel / sokuon / dakuten / handakuten /
 * youon / particle / ime_conversion / shape_confusion / unknown) — the 18
 * `ErrorTag` cases collapse onto those 9 buckets by linguistic kinship.
 *
 * If a new ErrorTag is added in @kana-typing/core, TypeScript will flag the
 * missing key here at compile time.
 */
export const ERROR_TAG_COLOR_VARS: Record<ErrorTag, string> = {
  // shape — kana / katakana visually-confused glyphs
  kana_shape_confusion: 'var(--tag-shape_confusion)',
  katakana_shape_confusion: 'var(--tag-shape_confusion)',
  // dakuten / handakuten — voiced / semi-voiced marker errors
  dakuten_error: 'var(--tag-dakuten)',
  handakuten_error: 'var(--tag-handakuten)',
  // structural kana errors with their own dedicated hues
  sokuon_error: 'var(--tag-sokuon)',
  long_vowel_error: 'var(--tag-long_vowel)',
  youon_error: 'var(--tag-youon)',
  n_error: 'var(--tag-youon)', // cyan family — both are "special kana shapes"
  // particle / IME / kanji-reading — explicit semantic buckets
  particle_error: 'var(--tag-particle)',
  ime_conversion_error: 'var(--tag-ime_conversion)',
  kanji_reading_error: 'var(--tag-shape_confusion)', // visual-recognition-adjacent
  // sound confusions — colour as IME-conversion (both reflect "I picked the wrong candidate")
  same_sound_confusion: 'var(--tag-ime_conversion)',
  near_sound_confusion: 'var(--tag-ime_conversion)',
  // higher-level mistakes — meaning / order / unclassified all share the slate "unknown" hue
  meaning_confusion: 'var(--tag-handakuten)', // magenta is conspicuous; meaning errors are rare and worth noticing
  word_order_error: 'var(--tag-particle)', // grammatical, same family as particles
  timeout: 'var(--tag-unknown)',
  misclick: 'var(--tag-unknown)',
  unknown: 'var(--tag-unknown)',
};

/**
 * Chinese display label for each ErrorTag. Used by the error chip / mistake
 * book / result page. Concise (≤ 4 chars) so chips stay tight.
 */
export const ERROR_TAG_LABEL_ZH: Record<ErrorTag, string> = {
  kana_shape_confusion: '假名形近',
  katakana_shape_confusion: '片假名形近',
  dakuten_error: '浊音',
  handakuten_error: '半浊音',
  sokuon_error: '促音',
  long_vowel_error: '长音',
  youon_error: '拗音',
  n_error: '拨音 ん',
  particle_error: '助词',
  kanji_reading_error: '汉字读音',
  same_sound_confusion: '同音混淆',
  near_sound_confusion: '近音混淆',
  meaning_confusion: '词义',
  ime_conversion_error: 'IME 转换',
  word_order_error: '语序',
  timeout: '超时',
  misclick: '误触',
  unknown: '未分类',
};
