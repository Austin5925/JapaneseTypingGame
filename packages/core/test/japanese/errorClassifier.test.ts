import { describe, expect, it } from 'vitest';

import {
  classifyKanaError,
  hasSevereError,
  normalizeYouon,
  removeLongVowel,
  removeSokuon,
  stripDakuten,
  stripHandakuten,
} from '../../src/japanese/errorClassifier';

describe('removeLongVowel', () => {
  it('strips katakana ー', () => {
    expect(removeLongVowel('ビール')).toBe('ビル');
  });

  it('contracts hiragana double vowels', () => {
    expect(removeLongVowel('おばあさん')).toBe('おばさん');
    expect(removeLongVowel('スーパー')).toBe('スパ');
  });

  it('contracts canonical おう / えい (long-vowel orthography)', () => {
    // Standard Japanese spells long o as お+う (ありがとう) and long e as え+い (せんせい).
    // Both forms collapse alongside the doubled-vowel case.
    expect(removeLongVowel('もう')).toBe('も');
    expect(removeLongVowel('せんせい')).toBe('せんせ');
    expect(removeLongVowel('もお')).toBe('も');
  });
});

describe('removeSokuon', () => {
  it('strips small っ', () => {
    expect(removeSokuon('きって')).toBe('きて');
    expect(removeSokuon('がっこう')).toBe('がこう');
  });

  it('strips small ッ', () => {
    expect(removeSokuon('カップ')).toBe('カプ');
  });
});

describe('stripDakuten', () => {
  it('maps が→か, だ→た, ば→は', () => {
    expect(stripDakuten('がくせい')).toBe('かくせい');
    expect(stripDakuten('だいがく')).toBe('たいかく');
  });
});

describe('stripHandakuten', () => {
  it('maps ぱ→は etc.', () => {
    expect(stripHandakuten('ぱぴぷぺぽ')).toBe('はひふへほ');
  });
});

describe('normalizeYouon', () => {
  it('replaces small ゃゅょ with full-size', () => {
    expect(normalizeYouon('しゃ')).toBe('しや');
    expect(normalizeYouon('きょ')).toBe('きよ');
  });
});

describe('classifyKanaError — language-meaningful differences', () => {
  it('returns [] for identical input', () => {
    expect(classifyKanaError('やくそく', 'やくそく')).toEqual([]);
  });

  it('detects long_vowel_error: ビール vs ビル', () => {
    const tags = classifyKanaError('ビール', 'ビル');
    expect(tags).toContain('long_vowel_error');
    expect(tags).not.toContain('sokuon_error');
  });

  it('detects long_vowel_error: おばあさん vs おばさん', () => {
    expect(classifyKanaError('おばあさん', 'おばさん')).toContain('long_vowel_error');
  });

  it('detects sokuon_error: きって vs きて', () => {
    const tags = classifyKanaError('きって', 'きて');
    expect(tags).toContain('sokuon_error');
    expect(tags).not.toContain('long_vowel_error');
  });

  it('detects dakuten_error: がくせい vs かくせい', () => {
    const tags = classifyKanaError('がくせい', 'かくせい');
    expect(tags).toContain('dakuten_error');
  });

  it('detects dakuten_error: かき vs がき', () => {
    expect(classifyKanaError('かき', 'がき')).toContain('dakuten_error');
  });

  it('detects youon_error: しゃ vs しや', () => {
    expect(classifyKanaError('しゃ', 'しや')).toContain('youon_error');
  });

  it('detects handakuten_error: ぱ vs は', () => {
    expect(classifyKanaError('ぱ', 'は')).toContain('handakuten_error');
  });

  it('detects n_error when ん is dropped', () => {
    expect(classifyKanaError('こんにちは', 'こにちは')).toContain('n_error');
  });

  it('returns [unknown] for genuinely unrelated strings', () => {
    expect(classifyKanaError('やま', 'かわ')).toEqual(['unknown']);
  });

  it('contracts long-vowel orthography (おう/えい) so せんせい vs せんせ flags long_vowel_error', () => {
    expect(classifyKanaError('せんせい', 'せんせ')).toContain('long_vowel_error');
  });

  it('script-insensitive: ビール vs びる still gives long_vowel_error', () => {
    expect(classifyKanaError('ビール', 'びる')).toContain('long_vowel_error');
  });
});

describe('hasSevereError', () => {
  it('flags long_vowel/sokuon/dakuten/particle/meaning/ime', () => {
    expect(hasSevereError(['long_vowel_error'])).toBe(true);
    expect(hasSevereError(['sokuon_error'])).toBe(true);
    expect(hasSevereError(['dakuten_error'])).toBe(true);
    expect(hasSevereError(['particle_error'])).toBe(true);
    expect(hasSevereError(['meaning_confusion'])).toBe(true);
    expect(hasSevereError(['ime_conversion_error'])).toBe(true);
  });

  it('does not flag youon or n_error or shape_confusion as severe', () => {
    expect(hasSevereError(['youon_error'])).toBe(false);
    expect(hasSevereError(['n_error'])).toBe(false);
    expect(hasSevereError(['katakana_shape_confusion'])).toBe(false);
    expect(hasSevereError(['unknown'])).toBe(false);
  });

  it('returns false on empty', () => {
    expect(hasSevereError([])).toBe(false);
  });
});
