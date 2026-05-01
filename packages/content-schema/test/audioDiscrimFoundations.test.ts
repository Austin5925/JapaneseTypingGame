import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { validatePack } from '../src';

/**
 * Smoke-test the audio-discrim-foundations.json pack ships through the standard validator.
 * Runs at gate time so a typo in any minimal-pair kana / romaji round-trip blocks before
 * AppleRescue tries to feed it to the player.
 */
const PACK_PATH = resolve(__dirname, '../../../content/official/audio-discrim-foundations.json');

describe('audio-discrim-foundations.json (real pack)', () => {
  const raw = JSON.parse(readFileSync(PACK_PATH, 'utf8')) as unknown;
  const result = validatePack(raw);

  it('passes the LearningItem pack validator with no errors', () => {
    if (!result.ok) {
      const lines = result.errors.map((e) => `  - ${e.path}: ${e.message} (${e.code})`);
      throw new Error(`pack failed validation:\n${lines.join('\n')}`);
    }
    expect(result.ok).toBe(true);
  });

  it('contains at least 20 minimal-pair items', () => {
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items.length).toBeGreaterThanOrEqual(20);
    }
  });

  it('every item has exactly one confusable peer (minimal-pair structure)', () => {
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const item of result.value.items) {
        expect(item.confusableItemIds.length).toBe(1);
      }
    }
  });

  it('every item declares one of the audio-discrim error tags', () => {
    expect(result.ok).toBe(true);
    if (result.ok) {
      const allowed = new Set(['long_vowel_error', 'sokuon_error', 'dakuten_error']);
      for (const item of result.value.items) {
        const tags = item.errorTags ?? [];
        const hasOne = tags.some((t) => allowed.has(t));
        expect(hasOne).toBe(true);
      }
    }
  });
});
