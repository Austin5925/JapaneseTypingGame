import { describe, expect, it } from 'vitest';

import {
  expandLongVowelMark,
  normalizeKana,
  normalizeRawInput,
} from '../../src/japanese/normalizeKana';

describe('normalizeRawInput', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeRawInput('  yakusoku  ')).toBe('yakusoku');
  });

  it('converts full-width ASCII letters to half-width', () => {
    expect(normalizeRawInput('ｓｈｉ')).toBe('shi');
  });

  it('converts full-width digits to half-width', () => {
    expect(normalizeRawInput('１２３')).toBe('123');
  });

  it('replaces ideographic space with ASCII space', () => {
    expect(normalizeRawInput('hello　world')).toBe('hello world');
  });
});

describe('normalizeKana', () => {
  it('returns empty string for empty input', () => {
    expect(normalizeKana('')).toBe('');
  });

  it('katakana → hiragana by default', () => {
    expect(normalizeKana('ヤクソク')).toBe('やくそく');
  });

  it('preserves long-vowel marks unless asked to expand', () => {
    expect(normalizeKana('ビール')).toBe('びーる');
  });

  it('expands long-vowel marks when expandLongVowel=true', () => {
    expect(normalizeKana('ビール', { expandLongVowel: true })).toBe('びいる');
  });

  it('half-width katakana → full-width', () => {
    expect(normalizeKana('ｱｲｳ', { katakanaToHiragana: false })).toBe('アイウ');
  });

  it('strips spaces when stripSpaces=true', () => {
    expect(normalizeKana('やく そく', { stripSpaces: true })).toBe('やくそく');
  });

  it('keeps spaces by default', () => {
    expect(normalizeKana('やく そく')).toBe('やく そく');
  });

  it('does not erase sokuon (is not a format-only difference)', () => {
    expect(normalizeKana('きって')).toBe('きって');
    expect(normalizeKana('きって')).not.toBe(normalizeKana('きて'));
  });

  it('does not erase dakuten (is not a format-only difference)', () => {
    expect(normalizeKana('がくせい')).not.toBe(normalizeKana('かくせい'));
  });
});

describe('expandLongVowelMark', () => {
  it('replaces ー with the preceding vowel in katakana', () => {
    expect(expandLongVowelMark('ビール')).toBe('ビイル');
    expect(expandLongVowelMark('コーヒー')).toBe('コオヒイ');
    expect(expandLongVowelMark('スーパー')).toBe('スウパア');
  });

  it('replaces ー with the preceding vowel in hiragana', () => {
    expect(expandLongVowelMark('びーる')).toBe('びいる');
  });

  it('drops ー when no preceding kana has a vowel', () => {
    expect(expandLongVowelMark('ー')).toBe('');
    expect(expandLongVowelMark('っー')).toBe('っ');
  });

  it('is a no-op for strings without ー', () => {
    expect(expandLongVowelMark('やくそく')).toBe('やくそく');
  });
});
