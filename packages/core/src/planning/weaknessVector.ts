import type { SkillProgress, WeaknessVector } from '../types/domain';
import type { ErrorTag, SkillDimension } from '../types/enums';

export interface ErrorTagAggregate {
  tag: ErrorTag;
  count: number;
}

const SKILL_KEYS = [
  'kana_recognition',
  'katakana_recognition',
  'kanji_reading',
  'meaning_recall',
  'ime_conversion',
  'listening_discrimination',
  'particle_usage',
  'sentence_order',
  'active_output',
] as const satisfies readonly SkillDimension[];

/**
 * Roll up a progress list + recent-error aggregate into a WeaknessVector usable by the daily
 * planner.
 *
 * Per-skill weakness is `1 - (avg masteryScore / 100)` over the items the user has
 * encountered, so 0 = mastered, 1 = brand new. Skills with no items observed default to 0.7
 * (a "moderate" weakness that pushes the planner to expose them); we don't default to 0
 * because that would tell the planner "this is mastered" and it would never be picked.
 *
 * topErrorTags keeps the raw count so the planner can prioritise specific drills (e.g.
 * `long_vowel_error → AppleRescue` even though long-vowel doesn't have a dedicated
 * SkillDimension).
 *
 * weakestItems is a flat list of (itemId, weight) sorted by weight desc; weight =
 * 1 - masteryScore/100, so the lowest-mastery items rank first.
 */
type WeaknessNumberKey =
  | 'kanaRecognition'
  | 'katakanaRecognition'
  | 'kanjiReading'
  | 'meaningRecall'
  | 'imeConversion'
  | 'listeningDiscrimination'
  | 'particleUsage'
  | 'sentenceOrder'
  | 'activeOutput';

export function buildWeaknessVector(
  progressList: SkillProgress[],
  recentErrors: ErrorTagAggregate[],
): WeaknessVector {
  const numbers: Record<WeaknessNumberKey, number> = {
    kanaRecognition: 0.7,
    katakanaRecognition: 0.7,
    kanjiReading: 0.7,
    meaningRecall: 0.7,
    imeConversion: 0.7,
    listeningDiscrimination: 0.7,
    particleUsage: 0.7,
    sentenceOrder: 0.7,
    activeOutput: 0.7,
  };
  for (const skill of SKILL_KEYS) {
    const fieldKey = skillToVectorKey(skill);
    numbers[fieldKey] = computeSkillWeakness(progressList, skill);
  }
  const topErrorTags = [...recentErrors]
    .map((e) => ({ tag: e.tag, weight: e.count }))
    .sort((a, b) => b.weight - a.weight);
  const weakestItems = [...progressList]
    .map((p) => ({ itemId: p.itemId, weight: 1 - p.masteryScore / 100 }))
    .sort((a, b) => b.weight - a.weight);
  return {
    ...numbers,
    topErrorTags,
    weakestItems,
  };
}

function computeSkillWeakness(progressList: SkillProgress[], skill: SkillDimension): number {
  // MoleScene currently emits `skillDimension: 'kana_typing'` for every kana attempt
  // regardless of whether the underlying item is hiragana or katakana (that data lives in
  // item.tags, not in the progress dimension). To keep the planner from showing uniform 0.7
  // defaults for `kana_recognition` AND `katakana_recognition` to a user who only plays
  // mole, we fold `kana_typing` into both dimensions. When mole later splits its dimension
  // by item-script, this fold can shrink to just kana_recognition.
  let accept: ReadonlySet<SkillDimension>;
  if (skill === 'kana_recognition' || skill === 'katakana_recognition') {
    accept = new Set<SkillDimension>([skill, 'kana_typing']);
  } else {
    accept = new Set<SkillDimension>([skill]);
  }
  const filtered = progressList.filter((p) => accept.has(p.skillDimension));
  if (filtered.length === 0) return 0.7;
  const avg = filtered.reduce((sum, p) => sum + p.masteryScore, 0) / filtered.length;
  return Math.max(0, Math.min(1, 1 - avg / 100));
}

// SkillDimension values are snake_case strings (e.g. `kana_recognition`); WeaknessVector
// fields are camelCase. The mapping is mechanical.
function skillToVectorKey(skill: SkillDimension): WeaknessNumberKey {
  switch (skill) {
    case 'kana_recognition':
      return 'kanaRecognition';
    case 'katakana_recognition':
      return 'katakanaRecognition';
    case 'kanji_reading':
      return 'kanjiReading';
    case 'meaning_recall':
      return 'meaningRecall';
    case 'ime_conversion':
      return 'imeConversion';
    case 'listening_discrimination':
      return 'listeningDiscrimination';
    case 'particle_usage':
      return 'particleUsage';
    case 'sentence_order':
      return 'sentenceOrder';
    case 'active_output':
      return 'activeOutput';
    case 'kana_typing':
      // kana_typing isn't an explicit field on WeaknessVector — its weakness folds into
      // kanaRecognition for the planner's purposes.
      return 'kanaRecognition';
  }
}

export function hasTopError(vector: WeaknessVector, tags: readonly ErrorTag[]): boolean {
  return vector.topErrorTags.some((e) => tags.includes(e.tag));
}
