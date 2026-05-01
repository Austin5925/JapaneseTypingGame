import { validatePack, type ContentPackInput } from '@kana-typing/content-schema';
import type { AudioRef, ExampleSentence, LearningItem } from '@kana-typing/core';

import audioDiscrimFoundationsPack from '../../../../../content/official/audio-discrim-foundations.json';

/**
 * Build-time-bundled audio-discrim minimal-pair pack for v0.8.2 AppleRescue. Same loading
 * pattern as the sentences and confusables packs — validation runs at module load, throws
 * loudly on schema drift. v0.8.x will fold this pack into the dev seed alongside the others
 * and switch AppleRescue to listItems-driven boot so attempts persist.
 */
function loadAudioDiscrimPack(): ContentPackInput {
  const result = validatePack(audioDiscrimFoundationsPack);
  if (!result.ok) {
    const summary = result.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
    throw new Error(`audio-discrim-foundations.json failed schema validation: ${summary}`);
  }
  return result.value;
}

const AUDIO_DISCRIM_PACK = loadAudioDiscrimPack();

export function loadAudioDiscrimItems(): LearningItem[] {
  const now = new Date().toISOString();
  return AUDIO_DISCRIM_PACK.items.map((item) => {
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
      sourcePackId: AUDIO_DISCRIM_PACK.id,
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

export function getAudioDiscrimPackInfo(): {
  id: string;
  name: string;
  version: string;
  count: number;
} {
  return {
    id: AUDIO_DISCRIM_PACK.id,
    name: AUDIO_DISCRIM_PACK.name,
    version: AUDIO_DISCRIM_PACK.version,
    count: AUDIO_DISCRIM_PACK.items.length,
  };
}
