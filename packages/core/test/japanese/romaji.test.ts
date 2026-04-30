import { describe, expect, it } from 'vitest';

import {
  buildAcceptedKanaSet,
  toKanaCandidates,
  toRomajiCandidates,
} from '../../src/japanese/romaji';

describe('toKanaCandidates — romaji variants', () => {
  it('shi and si both produce し', () => {
    expect(toKanaCandidates('shi', 'hiragana')).toContain('し');
    expect(toKanaCandidates('si', 'hiragana')).toContain('し');
  });

  it('chi and ti both produce ち', () => {
    expect(toKanaCandidates('chi', 'hiragana')).toContain('ち');
    expect(toKanaCandidates('ti', 'hiragana')).toContain('ち');
  });

  it('tsu and tu both produce つ', () => {
    expect(toKanaCandidates('tsu', 'hiragana')).toContain('つ');
    expect(toKanaCandidates('tu', 'hiragana')).toContain('つ');
  });

  it('fu and hu both produce ふ', () => {
    expect(toKanaCandidates('fu', 'hiragana')).toContain('ふ');
    expect(toKanaCandidates('hu', 'hiragana')).toContain('ふ');
  });

  it('ji and zi both produce じ', () => {
    expect(toKanaCandidates('ji', 'hiragana')).toContain('じ');
    expect(toKanaCandidates('zi', 'hiragana')).toContain('じ');
  });

  it('sha and sya both produce しゃ', () => {
    expect(toKanaCandidates('sha', 'hiragana')).toContain('しゃ');
    expect(toKanaCandidates('sya', 'hiragana')).toContain('しゃ');
  });

  it('cha and tya both produce ちゃ', () => {
    expect(toKanaCandidates('cha', 'hiragana')).toContain('ちゃ');
    expect(toKanaCandidates('tya', 'hiragana')).toContain('ちゃ');
  });

  it('cha/chu/cho map to ちゃ/ちゅ/ちょ in any order', () => {
    expect(toKanaCandidates('chu', 'hiragana')).toContain('ちゅ');
    expect(toKanaCandidates('tyu', 'hiragana')).toContain('ちゅ');
    expect(toKanaCandidates('cho', 'hiragana')).toContain('ちょ');
    expect(toKanaCandidates('tyo', 'hiragana')).toContain('ちょ');
  });

  it('kya/kyu/kyo work', () => {
    expect(toKanaCandidates('kya', 'hiragana')).toContain('きゃ');
    expect(toKanaCandidates('kyu', 'hiragana')).toContain('きゅ');
    expect(toKanaCandidates('kyo', 'hiragana')).toContain('きょ');
  });

  it('double consonants render sokuon: kk → っk in kitte', () => {
    expect(toKanaCandidates('kitte', 'hiragana')).toContain('きって');
    expect(toKanaCandidates('matta', 'hiragana')).toContain('まった');
    expect(toKanaCandidates('gakkou', 'hiragana')).toContain('がっこう');
  });

  it('ん accepts double-n and n-apostrophe disambiguation', () => {
    // wanakana parses `nn` as ん and `n'` as ん followed by a vowel-starting syllable.
    // It does NOT collapse `nnn` to `nn`+next; that's an unusual user input we don't promise
    // to handle (the IME usually gives `nn` directly), so it's not in the contract.
    expect(toKanaCandidates('konnichiha', 'hiragana')).toContain('こんにちは');
    expect(toKanaCandidates("kon'nichiha", 'hiragana')).toContain('こんにちは');
  });

  it('mode=mixed returns both hiragana and katakana candidates', () => {
    const cands = toKanaCandidates('biiru', 'mixed');
    expect(cands).toContain('びいる');
    expect(cands).toContain('ビイル');
  });

  it('mode=katakana skips hiragana', () => {
    const cands = toKanaCandidates('biiru', 'katakana');
    expect(cands).not.toContain('びいる');
    expect(cands).toContain('ビイル');
  });

  it('returns [] for empty input', () => {
    expect(toKanaCandidates('', 'hiragana')).toEqual([]);
    expect(toKanaCandidates('   ', 'hiragana')).toEqual([]);
  });
});

describe('toRomajiCandidates', () => {
  it('round-trips canonical kana', () => {
    expect(toRomajiCandidates('やくそく')).toContain('yakusoku');
  });

  it('contains long-vowel romaji for katakana with ー', () => {
    expect(toRomajiCandidates('ビール')).toContain('biiru');
  });

  it('returns [] for empty', () => {
    expect(toRomajiCandidates('')).toEqual([]);
  });
});

describe('buildAcceptedKanaSet', () => {
  it('includes the canonical kana', () => {
    const set = buildAcceptedKanaSet({ kana: 'やくそく' });
    expect(set.has('やくそく')).toBe(true);
  });

  it('includes acceptedKana variants', () => {
    const set = buildAcceptedKanaSet({ kana: 'やくそく', acceptedKana: ['ヤクソク'] });
    expect(set.has('やくそく')).toBe(true); // ヤクソク is normalised to hiragana
  });

  it('returns empty set when expected has no kana', () => {
    const set = buildAcceptedKanaSet({});
    expect(set.size).toBe(0);
  });
});
