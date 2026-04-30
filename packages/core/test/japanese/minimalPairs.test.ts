import { describe, expect, it } from 'vitest';

import { classifyKanaError } from '../../src/japanese/errorClassifier';

// Minimal-pair tests use real Japanese pairs (copied from the JLPT reference reading lists,
// not invented). When a user mistypes within a pair, the classifier should emit a precise
// shape-confusion tag so the scheduler can route them to a focused mole drill.

describe('katakana minimal pairs (shape confusion)', () => {
  it('シ vs ツ', () => {
    expect(classifyKanaError('シート', 'ツート')).toContain('katakana_shape_confusion');
    expect(classifyKanaError('ツアー', 'シアー')).toContain('katakana_shape_confusion');
  });

  it('ソ vs ン', () => {
    expect(classifyKanaError('ソース', 'ンース')).toContain('katakana_shape_confusion');
  });

  it('ク vs ケ', () => {
    expect(classifyKanaError('クラス', 'ケラス')).toContain('katakana_shape_confusion');
  });

  it('ワ vs ウ', () => {
    expect(classifyKanaError('ワイン', 'ウイン')).toContain('katakana_shape_confusion');
  });

  it('ヌ vs ス', () => {
    expect(classifyKanaError('ヌード', 'スード')).toContain('katakana_shape_confusion');
  });
});

describe('strictness: language-meaningful differences must surface', () => {
  it('ビル ≠ ビール (long-vowel error, must not silently pass)', () => {
    const tags = classifyKanaError('ビール', 'ビル');
    expect(tags).toContain('long_vowel_error');
    expect(tags.length).toBeGreaterThan(0);
  });

  it('きて ≠ きって (sokuon error)', () => {
    const tags = classifyKanaError('きって', 'きて');
    expect(tags).toContain('sokuon_error');
  });

  it('かき ≠ がき (dakuten error)', () => {
    expect(classifyKanaError('かき', 'がき')).toContain('dakuten_error');
  });

  it('おばさん ≠ おばあさん (long-vowel error specifically)', () => {
    const tags = classifyKanaError('おばあさん', 'おばさん');
    expect(tags).toContain('long_vowel_error');
    expect(tags).not.toContain('sokuon_error');
    expect(tags).not.toContain('dakuten_error');
  });

  it('multi-tag scenario: しゃ vs しや is youon, not anything else', () => {
    const tags = classifyKanaError('しゃ', 'しや');
    expect(tags).toContain('youon_error');
    expect(tags).not.toContain('long_vowel_error');
    expect(tags).not.toContain('sokuon_error');
  });
});
