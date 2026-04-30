import { describe, expect, it } from 'vitest';

import { ALL_ERROR_TAGS, ALL_GAME_TYPES, ALL_SKILL_DIMENSIONS, SEVERE_ERROR_TAGS } from '../src';

describe('enum tables', () => {
  it('lists every game type without duplicates', () => {
    expect(new Set(ALL_GAME_TYPES).size).toBe(ALL_GAME_TYPES.length);
    expect(ALL_GAME_TYPES).toContain('mole_story');
    expect(ALL_GAME_TYPES).toContain('speed_chase');
  });

  it('lists every skill dimension without duplicates', () => {
    expect(new Set(ALL_SKILL_DIMENSIONS).size).toBe(ALL_SKILL_DIMENSIONS.length);
    expect(ALL_SKILL_DIMENSIONS).toContain('kanji_reading');
    expect(ALL_SKILL_DIMENSIONS).toContain('listening_discrimination');
  });

  it('lists every error tag without duplicates', () => {
    expect(new Set(ALL_ERROR_TAGS).size).toBe(ALL_ERROR_TAGS.length);
    expect(ALL_ERROR_TAGS).toContain('long_vowel_error');
    expect(ALL_ERROR_TAGS).toContain('sokuon_error');
  });

  it('treats long_vowel/sokuon/dakuten/particle/meaning/ime as severe', () => {
    expect(SEVERE_ERROR_TAGS).toEqual(
      expect.arrayContaining([
        'long_vowel_error',
        'sokuon_error',
        'dakuten_error',
        'particle_error',
        'meaning_confusion',
        'ime_conversion_error',
      ]),
    );
  });

  it('keeps SEVERE_ERROR_TAGS a strict subset of ALL_ERROR_TAGS', () => {
    for (const tag of SEVERE_ERROR_TAGS) {
      expect(ALL_ERROR_TAGS).toContain(tag);
    }
  });
});
