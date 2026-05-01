import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { validatePack, type ContentPackInput } from '../src';

/**
 * Smoke-test the confusables-foundations.json pack ships through the standard validator
 * (LearningItem, not SentenceItem). v0.8.1 SpaceBattle loads this pack via the regular
 * SQLite import path, so a typo or unresolved confusableItemId surfaces here at gate time.
 */
const PACK_PATH = resolve(__dirname, '../../../content/official/confusables-foundations.json');

describe('confusables-foundations.json (real pack)', () => {
  const raw = JSON.parse(readFileSync(PACK_PATH, 'utf8')) as unknown;
  const result = validatePack(raw);

  it('passes the LearningItem pack validator with no errors', () => {
    if (!result.ok) {
      const lines = result.errors.map((e) => `  - ${e.path}: ${e.message} (${e.code})`);
      throw new Error(`pack failed validation:\n${lines.join('\n')}`);
    }
    expect(result.ok).toBe(true);
  });

  it('contains at least 40 items for v0.8.1 minimum', () => {
    expect(result.ok).toBe(true);
    if (result.ok) {
      const pack: ContentPackInput = result.value;
      expect(pack.items.length).toBeGreaterThanOrEqual(40);
    }
  });

  it('every item declares at least one confusable peer', () => {
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const item of result.value.items) {
        expect(item.confusableItemIds.length).toBeGreaterThan(0);
      }
    }
  });
});
