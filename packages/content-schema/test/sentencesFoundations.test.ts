import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { validateSentencePack, type SentencePackInput } from '../src';

/**
 * Smoke-test the actual `content/official/sentences-foundations.json` ships through the
 * validator clean. v0.8.0 RiverJump loads this pack at runtime, so a typo in any chunk's
 * kana / romaji round-trip will surface here and block the gate before it can crash a session.
 */
const PACK_PATH = resolve(__dirname, '../../../content/official/sentences-foundations.json');

describe('sentences-foundations.json (real pack)', () => {
  const raw = JSON.parse(readFileSync(PACK_PATH, 'utf8')) as unknown;
  const result = validateSentencePack(raw);

  it('passes the SentencePack validator with no errors', () => {
    if (!result.ok) {
      const lines = result.errors.map((e) => `  - ${e.path}: ${e.message} (${e.code})`);
      throw new Error(`pack failed validation:\n${lines.join('\n')}`);
    }
    expect(result.ok).toBe(true);
  });

  it('contains at least 30 sentences for v0.8.0 minimum', () => {
    expect(result.ok).toBe(true);
    if (result.ok) {
      const pack: SentencePackInput = result.value;
      expect(pack.sentences.length).toBeGreaterThanOrEqual(30);
    }
  });

  it('every sentence has at least 2 chunks', () => {
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const s of result.value.sentences) {
        expect(s.chunks.length).toBeGreaterThanOrEqual(2);
      }
    }
  });
});
