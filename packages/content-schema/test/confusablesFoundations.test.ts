import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { validatePack, type ContentPackInput } from '../src';

/**
 * Smoke-test the phase1 error-lab pack (replaces the old confusables-foundations.json since
 * v0.9.0). The pack merges the old confusables + audio-discrim sets plus 50+ new minimal
 * pairs and zh-misleading items, so SpaceBattle / AppleRescue both feed off this single file.
 * A typo or a broken confusableItemId surfaces here at gate time.
 */
const PACK_PATH = resolve(__dirname, '../../../content/official/official-phase1-error-lab.json');

describe('official-phase1-error-lab.json (real pack)', () => {
  const raw = JSON.parse(readFileSync(PACK_PATH, 'utf8')) as unknown;
  const result = validatePack(raw);

  it('passes the LearningItem pack validator with no errors', () => {
    if (!result.ok) {
      const lines = result.errors.map((e) => `  - ${e.path}: ${e.message} (${e.code})`);
      throw new Error(`pack failed validation:\n${lines.join('\n')}`);
    }
    expect(result.ok).toBe(true);
  });

  it('contains at least 100 items (covers confusables + audio-discrim)', () => {
    expect(result.ok).toBe(true);
    if (result.ok) {
      const pack: ContentPackInput = result.value;
      expect(pack.items.length).toBeGreaterThanOrEqual(100);
    }
  });

  it('most items declare at least one confusable peer (>=60% coverage)', () => {
    expect(result.ok).toBe(true);
    if (result.ok) {
      const items = result.value.items;
      const withPeers = items.filter((i) => i.confusableItemIds.length > 0).length;
      // ~67% of error-lab items currently have peers; the rest are stand-alone zh-misleading
      // entries (汽車/老婆/etc.) that don't pair against another phase1 item.
      expect(withPeers / items.length).toBeGreaterThanOrEqual(0.6);
    }
  });
});
