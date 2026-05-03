import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  validatePack,
  validateSentencePack,
  type ContentPackInput,
  type SentencePackInput,
} from '../src';

const OFFICIAL_DIR = resolve(__dirname, '../../../content/official');
const PACK_FILES = readdirSync(OFFICIAL_DIR)
  .filter((name) => /^official-phase1-.*\.json$/u.test(name))
  .sort();

describe('official phase1 corpus packs', () => {
  it('keeps the expected v0.9 corpus inventory under validation', () => {
    expect(PACK_FILES).toHaveLength(11);
  });

  it.each(PACK_FILES)('%s validates and emits canonical core vocab tags', (fileName) => {
    const packPath = resolve(OFFICIAL_DIR, fileName);
    const raw = JSON.parse(readFileSync(packPath, 'utf8')) as unknown;
    const isSentencePack =
      raw !== null &&
      typeof raw === 'object' &&
      'sentences' in raw &&
      Array.isArray((raw as { sentences?: unknown }).sentences);
    const result = isSentencePack ? validateSentencePack(raw) : validatePack(raw);

    if (!result.ok) {
      const lines = result.errors.map((e) => `  - ${e.path}: ${e.message} (${e.code})`);
      throw new Error(`pack failed validation:\n${lines.join('\n')}`);
    }

    const tags = collectCoreVocabTags(result.value, isSentencePack);
    expect(tags.every((tag) => !tag.includes('-'))).toBe(true);
    expect(tags).not.toContain('particle_misuse');
  });
});

function collectCoreVocabTags(
  pack: ContentPackInput | SentencePackInput,
  isSentencePack: boolean,
): string[] {
  if (isSentencePack) {
    const sentencePack = pack as SentencePackInput;
    return sentencePack.sentences.flatMap((sentence) => sentence.skillTags);
  }
  const contentPack = pack as ContentPackInput;
  return contentPack.items.flatMap((item) => [...item.skillTags, ...(item.errorTags ?? [])]);
}
