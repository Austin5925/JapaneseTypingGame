import { validateSentencePack, type SentencePackInput } from '@kana-typing/content-schema';
import type { SentenceItem } from '@kana-typing/core';

import sentencesFoundationsPack from '../../../../../content/official/sentences-foundations.json';

/**
 * Build-time-bundled sentence pack(s) for v0.8.0 RiverJump. Sentences are static JSON
 * shipped alongside the binary — no SQLite ingestion yet (see CLAUDE.md v0.8 handoff §5.2).
 *
 * The validator runs once at module load. If the bundled JSON ever drifts out of schema (e.g.
 * a romaji that no longer round-trips after a wanakana upgrade), the throw makes the failure
 * loud at first session start rather than letting RiverJump silently feed bad tasks.
 */
function loadFoundationsPack(): SentencePackInput {
  const result = validateSentencePack(sentencesFoundationsPack);
  if (!result.ok) {
    const summary = result.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
    throw new Error(`sentences-foundations.json failed schema validation: ${summary}`);
  }
  return result.value;
}

const FOUNDATIONS_PACK = loadFoundationsPack();

export function loadFoundationsSentences(): SentenceItem[] {
  return FOUNDATIONS_PACK.sentences.map((s) => ({
    id: s.id,
    surface: s.surface,
    chunks: s.chunks.map((c) => ({
      id: c.id,
      text: c.text,
      kana: c.kana,
      romaji: [...c.romaji],
      ...(c.acceptedSurfaces && c.acceptedSurfaces.length > 0
        ? { acceptedSurfaces: [...c.acceptedSurfaces] }
        : {}),
    })),
    zhPrompt: s.zhPrompt,
    acceptedOrders: s.acceptedOrders.map((o) => [...o]),
    ...(s.jlpt !== undefined ? { jlpt: s.jlpt } : {}),
    tags: [...s.tags],
    skillTags: [...s.skillTags],
  }));
}

export function getFoundationsPackInfo(): {
  id: string;
  name: string;
  version: string;
  count: number;
} {
  return {
    id: FOUNDATIONS_PACK.id,
    name: FOUNDATIONS_PACK.name,
    version: FOUNDATIONS_PACK.version,
    count: FOUNDATIONS_PACK.sentences.length,
  };
}
