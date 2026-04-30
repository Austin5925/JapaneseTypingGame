import { describe, expect, it } from 'vitest';

import {
  compareKana,
  compareSurface,
  createJapaneseInputService,
} from '../../src/japanese/japaneseInputService';
import type { EvaluationStrictness } from '../../src/types/domain';

const STRICT: EvaluationStrictness = {
  longVowel: 'strict',
  sokuon: 'strict',
  dakuten: 'strict',
  kanjiSurface: 'strict',
  particleReading: 'surface',
};

const READING_MODE: EvaluationStrictness = {
  ...STRICT,
  particleReading: 'pronunciation',
};

const LENIENT_LONG: EvaluationStrictness = {
  ...STRICT,
  longVowel: 'warn',
};

describe('compareKana — strictness defaults', () => {
  it('exact match is exact + acceptable', () => {
    const r = compareKana('やくそく', 'やくそく', STRICT);
    expect(r.isExact).toBe(true);
    expect(r.isAcceptable).toBe(true);
    expect(r.errorTags).toEqual([]);
  });

  it('script-only difference: ヤクソク vs やくそく → exact via normalisation', () => {
    const r = compareKana('ヤクソク', 'やくそく', STRICT);
    expect(r.isExact).toBe(true);
    expect(r.isAcceptable).toBe(true);
  });

  it('half-width katakana matches full-width: ｱｲｳ vs アイウ', () => {
    const r = compareKana('ｱｲｳ', 'アイウ', STRICT);
    expect(r.isExact).toBe(true);
  });

  it('strict long-vowel rejects ビール vs ビル', () => {
    const r = compareKana('ビール', 'ビル', STRICT);
    expect(r.isExact).toBe(false);
    expect(r.isAcceptable).toBe(false);
    expect(r.errorTags).toContain('long_vowel_error');
  });

  it('strict sokuon rejects きって vs きて', () => {
    const r = compareKana('きって', 'きて', STRICT);
    expect(r.isAcceptable).toBe(false);
    expect(r.errorTags).toContain('sokuon_error');
  });

  it('strict dakuten rejects がくせい vs かくせい', () => {
    const r = compareKana('がくせい', 'かくせい', STRICT);
    expect(r.isAcceptable).toBe(false);
    expect(r.errorTags).toContain('dakuten_error');
  });
});

describe('compareKana — particle reading policy', () => {
  it('reading mode accepts わ for は particle', () => {
    const r = compareKana('わたしは', 'わたしわ', READING_MODE);
    expect(r.isAcceptable).toBe(true);
  });

  it('surface mode rejects わ where は is expected', () => {
    const r = compareKana('わたしは', 'わたしわ', STRICT);
    expect(r.isAcceptable).toBe(false);
  });

  it('reading mode accepts え for へ particle', () => {
    const r = compareKana('がっこうへ', 'がっこうえ', READING_MODE);
    expect(r.isAcceptable).toBe(true);
  });

  it('reading mode accepts お for を particle', () => {
    const r = compareKana('ほんを', 'ほんお', READING_MODE);
    expect(r.isAcceptable).toBe(true);
  });
});

describe('compareKana — long-vowel leniency', () => {
  it('warn mode tolerates ビール vs ビル but flags it', () => {
    const r = compareKana('ビール', 'ビル', LENIENT_LONG);
    expect(r.isAcceptable).toBe(true);
    expect(r.errorTags).toContain('long_vowel_error');
  });

  it('warn mode does not erase sokuon errors', () => {
    const r = compareKana('きって', 'きて', LENIENT_LONG);
    expect(r.isAcceptable).toBe(false);
    expect(r.errorTags).toContain('sokuon_error');
  });
});

describe('compareSurface', () => {
  it('exact surface match', () => {
    const r = compareSurface({ surface: '約束' }, '約束');
    expect(r.isExact).toBe(true);
    expect(r.isAcceptable).toBe(true);
  });

  it('accepts an alternative from acceptedSurfaces', () => {
    const r = compareSurface({ surface: '会う', acceptedSurfaces: ['逢う'] }, '逢う');
    expect(r.isExact).toBe(false);
    expect(r.isAcceptable).toBe(true);
    expect(r.matchedAcceptedSurface).toBe('逢う');
  });

  it('rejects a different surface', () => {
    const r = compareSurface({ surface: '約束' }, '予約');
    expect(r.isAcceptable).toBe(false);
  });

  it('trims whitespace', () => {
    const r = compareSurface({ surface: '約束' }, '  約束  ');
    expect(r.isExact).toBe(true);
  });
});

describe('createJapaneseInputService', () => {
  it('exposes the full surface area', () => {
    const svc = createJapaneseInputService();
    expect(typeof svc.normalizeRawInput).toBe('function');
    expect(typeof svc.normalizeKana).toBe('function');
    expect(typeof svc.toKanaCandidates).toBe('function');
    expect(typeof svc.toRomajiCandidates).toBe('function');
    expect(typeof svc.compareKana).toBe('function');
    expect(typeof svc.compareSurface).toBe('function');
    expect(typeof svc.isLikelyImeComposing).toBe('function');
  });
});
