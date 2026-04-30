import * as wanakana from 'wanakana';

import type { ExpectedAnswer } from '../types/domain';

import { normalizeKana } from './normalizeKana';

export type KanaMode = 'hiragana' | 'katakana' | 'mixed';

/**
 * Convert raw romaji into one or more candidate kana strings.
 *
 * wanakana already accepts the common variants we care about — `shi/si`, `chi/ti`, `tsu/tu`,
 * `fu/hu`, `ji/zi`, `sha/sya`, double-letter sokuon (`kk/tt/...`), and `n/nn/n'` for ん — so
 * we delegate to it. Multiple modes return both hiragana and katakana candidates so callers
 * can compare against either expected script.
 *
 * Returns an empty array on empty input rather than throwing; downstream evaluation has a
 * single "no answer" branch and we keep it that way.
 */
export function toKanaCandidates(rawRomaji: string, mode: KanaMode): string[] {
  const trimmed = rawRomaji.trim();
  if (!trimmed) return [];
  const out = new Set<string>();
  if (mode === 'hiragana' || mode === 'mixed') {
    out.add(wanakana.toHiragana(trimmed, { passRomaji: false }));
  }
  if (mode === 'katakana' || mode === 'mixed') {
    out.add(wanakana.toKatakana(trimmed, { passRomaji: false }));
  }
  return [...out];
}

/**
 * Reverse: kana → canonical romaji. Used for content-pack validation and to display the
 * "what the user actually typed equivalent" in result panels.
 */
export function toRomajiCandidates(kana: string): string[] {
  if (!kana) return [];
  return [wanakana.toRomaji(kana)];
}

/**
 * Build the set of acceptable kana forms for an answer: the canonical `expected.kana` plus any
 * pack-declared `acceptedKana` (for items with multiple legitimate readings). The returned set
 * is normalised through the same `normalizeKana(katakana→hiragana, no long-vowel expansion)`
 * pipeline that `compareKana` uses, so a katakana word with ー (e.g. `ビール`) ends up as
 * `びーる` here and matches the result of `compareKana`'s normalisation rather than the
 * silently-expanded `びいる` that `wanakana.toHiragana` would produce.
 */
export function buildAcceptedKanaSet(
  expected: Pick<ExpectedAnswer, 'kana' | 'acceptedKana'>,
): Set<string> {
  const set = new Set<string>();
  const add = (k: string | undefined): void => {
    if (!k) return;
    set.add(normalizeKana(k, { katakanaToHiragana: true, expandLongVowel: false }));
  };
  add(expected.kana);
  for (const k of expected.acceptedKana ?? []) add(k);
  return set;
}
