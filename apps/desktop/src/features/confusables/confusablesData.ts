import { validatePack, type ContentPackInput } from '@kana-typing/content-schema';
import type { AudioRef, ExampleSentence, LearningItem } from '@kana-typing/core';

import confusablesFoundationsPack from '../../../../../content/official/confusables-foundations.json';

/**
 * Build-time-bundled confusables pack for v0.8.1 SpaceBattle. Loaded the same way as the
 * sentence pack — validation runs once at module import, throws loudly on schema drift.
 *
 * v0.8.1 ships SpaceBattle as ephemeral too (no SQLite ingest): the existing pack-import
 * pipeline persists `confusableItemIds` into `item_confusables` rows referencing
 * `learning_items.id`, but the relevant ChoiceTask flow only needs the in-memory item list.
 * v0.8.x will fold this pack into the dev seed and switch SpaceBattle to listItems-driven
 * boot like Mole/SpeedChase.
 */
function loadConfusablesPack(): ContentPackInput {
  const result = validatePack(confusablesFoundationsPack);
  if (!result.ok) {
    const summary = result.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
    throw new Error(`confusables-foundations.json failed schema validation: ${summary}`);
  }
  return result.value;
}

const CONFUSABLES_PACK = loadConfusablesPack();

export function loadConfusableItems(): LearningItem[] {
  const now = new Date().toISOString();
  return CONFUSABLES_PACK.items.map((item) => {
    const examples: ExampleSentence[] = item.examples.map((ex) => {
      const out: ExampleSentence = { id: ex.id, ja: ex.ja, zh: ex.zh };
      if (ex.kana !== undefined) out.kana = ex.kana;
      if (ex.targetSurface !== undefined) out.targetSurface = ex.targetSurface;
      if (ex.targetKana !== undefined) out.targetKana = ex.targetKana;
      if (ex.audioRef !== undefined) out.audioRef = ex.audioRef;
      if (ex.tags) out.tags = [...ex.tags];
      return out;
    });
    const audioRefs: AudioRef[] = item.audioRefs.map((a) => {
      const out: AudioRef = { id: a.id, kind: a.kind, path: a.path };
      if (a.durationMs !== undefined) out.durationMs = a.durationMs;
      if (a.speaker !== undefined) out.speaker = a.speaker;
      if (a.speed !== undefined) out.speed = a.speed;
      return out;
    });
    const result: LearningItem = {
      id: item.id,
      type: item.type,
      surface: item.surface,
      kana: item.kana,
      romaji: [...item.romaji],
      meaningsZh: [...item.meaningsZh],
      tags: [...item.tags],
      skillTags: [...item.skillTags],
      examples,
      audioRefs,
      confusableItemIds: [...item.confusableItemIds],
      sourcePackId: CONFUSABLES_PACK.id,
      quality: 'official',
      createdAt: now,
      updatedAt: now,
    };
    if (item.meaningsEn) result.meaningsEn = [...item.meaningsEn];
    if (item.pos !== undefined) result.pos = item.pos;
    if (item.jlpt !== undefined) result.jlpt = item.jlpt;
    if (item.errorTags) result.errorTags = [...item.errorTags];
    if (item.acceptedSurfaces) result.acceptedSurfaces = [...item.acceptedSurfaces];
    if (item.acceptedKana) result.acceptedKana = [...item.acceptedKana];
    return result;
  });
}

export function getConfusablesPackInfo(): {
  id: string;
  name: string;
  version: string;
  count: number;
} {
  return {
    id: CONFUSABLES_PACK.id,
    name: CONFUSABLES_PACK.name,
    version: CONFUSABLES_PACK.version,
    count: CONFUSABLES_PACK.items.length,
  };
}
