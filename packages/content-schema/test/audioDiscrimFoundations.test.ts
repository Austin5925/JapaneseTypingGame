import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { validatePack } from '../src';

/**
 * Smoke-test the phase1 n5-core pack (the new mole-story / dev fallback baseline). v0.9.0
 * replaces the old n5-basic-mini + audio-discrim-foundations smoke tests with this single
 * gate over the 320-item N5/N4 core file. AppleRescue items live in error-lab; the
 * audio-discrim-specific assertions moved to that test.
 */
const PACK_PATH = resolve(__dirname, '../../../content/official/official-phase1-n5-core.json');

describe('official-phase1-n5-core.json (real pack)', () => {
  const raw = JSON.parse(readFileSync(PACK_PATH, 'utf8')) as unknown;
  const result = validatePack(raw);

  it('passes the LearningItem pack validator with no errors', () => {
    if (!result.ok) {
      const lines = result.errors.map((e) => `  - ${e.path}: ${e.message} (${e.code})`);
      throw new Error(`pack failed validation:\n${lines.join('\n')}`);
    }
    expect(result.ok).toBe(true);
  });

  it('contains at least 300 items', () => {
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items.length).toBeGreaterThanOrEqual(300);
    }
  });

  it('every item has a non-empty kana and at least one romaji form', () => {
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const item of result.value.items) {
        expect(item.kana.length).toBeGreaterThan(0);
        expect(item.romaji.length).toBeGreaterThanOrEqual(1);
      }
    }
  });
});
