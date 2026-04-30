import type { ErrorTag } from '../types/enums';
import { SEVERE_ERROR_TAGS } from '../types/enums';

import {
  DAKUTEN_TO_BASE,
  HANDAKUTEN_TO_BASE,
  LONG_VOWEL_MARK,
  SOKUON_CHARS,
  vowelOfPrev,
  VOWEL_TO_HIRAGANA,
  VOWEL_TO_KATAKANA,
  YOUON_SMALL_TO_BIG,
} from './charTables';
import { normalizeKana } from './normalizeKana';

/**
 * Strip katakana ー and any kana that is acting as a long-vowel extension of the preceding
 * kana. The result loses meaningful long-vowel information, so use only inside
 * `classifyKanaError` to detect that two strings differ ONLY by long-vowel content
 * (`ビール` vs `ビル`, `おばあさん` vs `おばさん`, `せんせい` vs `せんせ`).
 *
 * Long-vowel rules applied:
 *   - ー is always dropped.
 *   - A vowel kana whose vowel matches the previous kana's vowel is dropped (`ばあ` → `ば`).
 *   - `お+う` and `え+い` are dropped (canonical Japanese long-vowel spelling: こう, せい).
 *
 * Edge case: this is intentionally lossy. `こう` and `こ` collapse to the same form, so a
 * theoretical `こうこう` vs `ここ` minimal pair would falsely fire `long_vowel_error`. We
 * accept that — those words are not realistic typing-error pairs in practice.
 */
export function removeLongVowel(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === LONG_VOWEL_MARK) continue;
    const v = vowelOfPrev(s, i);
    if (!v) {
      out += ch;
      continue;
    }
    if (isLongVowelExtension(v, ch)) continue;
    out += ch;
  }
  return out;
}

function isLongVowelExtension(prevVowel: 'a' | 'i' | 'u' | 'e' | 'o', ch: string): boolean {
  if (ch === VOWEL_TO_HIRAGANA[prevVowel] || ch === VOWEL_TO_KATAKANA[prevVowel]) return true;
  // Canonical orthographic long-vowel pairings: お+う (ありがとう), え+い (せんせい).
  if (prevVowel === 'o' && (ch === 'う' || ch === 'ウ')) return true;
  if (prevVowel === 'e' && (ch === 'い' || ch === 'イ')) return true;
  return false;
}

/** Strip sokuon (small っ/ッ) entirely. */
export function removeSokuon(s: string): string {
  let out = '';
  for (const ch of s) if (!SOKUON_CHARS.has(ch)) out += ch;
  return out;
}

/** Map every voiced kana to its unvoiced base. か stays か; が becomes か; だ becomes た. */
export function stripDakuten(s: string): string {
  let out = '';
  for (const ch of s) out += DAKUTEN_TO_BASE[ch] ?? ch;
  return out;
}

export function stripHandakuten(s: string): string {
  let out = '';
  for (const ch of s) out += HANDAKUTEN_TO_BASE[ch] ?? ch;
  return out;
}

/** Replace small ゃゅょ etc. with their full-size form. しゃ → しや (used to detect youon errors). */
export function normalizeYouon(s: string): string {
  let out = '';
  for (const ch of s) out += YOUON_SMALL_TO_BIG[ch] ?? ch;
  return out;
}

// Common katakana minimal pairs that look alike. When we see substitution between members of a
// pair we tag `katakana_shape_confusion` so the scheduler can route the user to a focused mole
// drill (Sprint 3).
const KATAKANA_SHAPE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['シ', 'ツ'],
  ['ソ', 'ン'],
  ['ク', 'ケ'],
  ['ワ', 'ウ'],
  ['ヌ', 'ス'],
  ['ロ', 'コ'],
];

const HIRAGANA_SHAPE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['ね', 'れ'],
  ['ぬ', 'め'],
  ['は', 'ほ'],
  ['さ', 'き'],
  ['つ', 'う'],
];

function pairwiseShapeError(
  expected: string,
  actual: string,
  pairs: ReadonlyArray<readonly [string, string]>,
): boolean {
  // Both strings must have the same length; we check whether every differing position swaps
  // characters within one of the listed pairs.
  if (expected.length !== actual.length) return false;
  let differences = 0;
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i]!;
    const a = actual[i]!;
    if (e === a) continue;
    differences++;
    const isPair = pairs.some(([p1, p2]) => (e === p1 && a === p2) || (e === p2 && a === p1));
    if (!isPair) return false;
  }
  return differences > 0;
}

/**
 * Returns the union of error tags that explain why `actual` differs from `expected`.
 *
 * Multiple tags can fire (a substitution can be both a long-vowel and a sokuon error), but we
 * fall back to `unknown` if no targeted classifier matches; that signal lets the scheduler
 * know it should not promote the item out of `fragile` based on this attempt alone.
 *
 * Both inputs are passed through `normalizeKana` (default options: katakana→hiragana, half→
 * full, punctuation normalised) so callers don't have to. Long-vowel marks and sokuon are
 * intentionally NOT erased by that step.
 */
export function classifyKanaError(expectedRaw: string, actualRaw: string): ErrorTag[] {
  const expected = normalizeKana(expectedRaw);
  const actual = normalizeKana(actualRaw);
  if (expected === actual) return [];

  const tags = new Set<ErrorTag>();

  if (removeLongVowel(expected) === removeLongVowel(actual)) {
    tags.add('long_vowel_error');
  }
  if (removeSokuon(expected) === removeSokuon(actual)) {
    tags.add('sokuon_error');
  }
  if (stripDakuten(expected) === stripDakuten(actual)) {
    tags.add('dakuten_error');
  }
  if (stripHandakuten(expected) === stripHandakuten(actual)) {
    // handakuten uniquely flags ぱ↔は etc.; if dakuten classifier already fired (because the
    // strings only differed in the same characters) we still emit handakuten as a more precise
    // hint for `ぱ` vs `は`.
    tags.add('handakuten_error');
  }
  if (normalizeYouon(expected) === normalizeYouon(actual)) {
    tags.add('youon_error');
  }

  // ん dropped or doubled.
  const expectedN = (expected.match(/ん/gu) ?? []).length;
  const actualN = (actual.match(/ん/gu) ?? []).length;
  if (expectedN !== actualN) {
    tags.add('n_error');
  }

  // Shape confusion: only meaningful when the two strings are the same length and differ at
  // positions where a known minimal pair lives.
  if (pairwiseShapeError(expectedRaw, actualRaw, KATAKANA_SHAPE_PAIRS)) {
    tags.add('katakana_shape_confusion');
  }
  if (pairwiseShapeError(expected, actual, HIRAGANA_SHAPE_PAIRS)) {
    tags.add('kana_shape_confusion');
  }

  if (tags.size === 0) {
    tags.add('unknown');
  }
  return [...tags];
}

export function hasSevereError(tags: readonly ErrorTag[]): boolean {
  for (const t of tags) {
    if (SEVERE_ERROR_TAGS.includes(t)) return true;
  }
  return false;
}
