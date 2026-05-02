import { buildCrossGameEffects } from '../evaluation/crossGameEffects';
import type {
  CrossGameEffect,
  EvaluationResult,
  LearningItem,
  SkillProgress,
} from '../types/domain';
import type { ErrorTag, GameType, SkillDimension } from '../types/enums';

import type { SentenceItem } from './sentenceOrderSelector';

/**
 * Boss session = a multi-segment cross-game gauntlet built from the user's recent weakness.
 *
 * Strategy (v0.8.6):
 *   1. Filter every progress row to "weak":
 *      - state ∈ {fragile, learning}, OR
 *      - lastErrorTags is non-empty (signals a recent slip even on a stable item).
 *   2. For each weak row, ask `buildCrossGameEffects` what game type the dominant errorTag
 *      should route to. This is the same routing rule the scheduler / ResultPage / Mistakes
 *      page uses, so a Boss session reads as "concentrated version of what your error log
 *      already said you should practise".
 *   3. Bucket the weak rows by recommended gameType, weighting each by `lapseCount + wrongCount`.
 *   4. Pick the top `segmentCount` buckets sorted by total weight; each bucket becomes one
 *      BossSegment. Inside a segment we surface up to `itemsPerSegment` items / sentences,
 *      sorted by per-item weight.
 *
 * The selector deliberately stops at the segment-meta level — the actual TrainingTask shape
 * differs per gameType (kana / choice / sentence-order) and is built in the host page so we
 * don't drag every selector into core just for this orchestration.
 */

export type BossSegmentContent =
  | { kind: 'words'; items: LearningItem[] }
  | { kind: 'sentences'; sentences: SentenceItem[] };

export interface BossSegment {
  gameType: GameType;
  skillDimension: SkillDimension;
  /** Sum of `lapseCount + wrongCount` across items in this segment. Higher = more urgent. */
  weight: number;
  /** Reason tags that contributed to this segment (UI shows them as chips). */
  reasons: ErrorTag[];
  content: BossSegmentContent;
  /** Recommended task time limit for this segment (ms). */
  timeLimitMs: number;
  /** Recommended task count for this segment. */
  taskCount: number;
}

export interface SelectBossSessionInput {
  progress: SkillProgress[];
  learningItems: LearningItem[];
  sentenceItems: SentenceItem[];
  /** Max number of segments in the Boss session. Default 4. */
  segmentCount?: number;
  /** Items per segment. Default 5. */
  itemsPerSegment?: number;
  /** Per-task time limit for word-mode segments (ms). Default 6000. */
  wordTimeLimitMs?: number;
  /** Per-task time limit for sentence-mode segments (ms). Default 25000. */
  sentenceTimeLimitMs?: number;
  /** Per-task time limit for choice-mode segments (ms). Default 8000. */
  choiceTimeLimitMs?: number;
}

export interface SelectBossSessionOutput {
  segments: BossSegment[];
  /** Total candidate weak items considered before bucketing. UI uses this for the empty-state
   * panel ("数据不够 — 先去练几局再来"). */
  weakCandidateCount: number;
}

const DEFAULT_SEGMENT_COUNT = 4;
const DEFAULT_ITEMS_PER_SEGMENT = 5;

const SKILL_FOR_GAME: Record<GameType, SkillDimension> = {
  mole_story: 'kana_typing',
  speed_chase: 'kanji_reading',
  river_jump: 'sentence_order',
  space_battle: 'meaning_recall',
  apple_rescue: 'listening_discrimination',
  // Boss is itself a meta-game; tracking dimension here only matters when a boss segment
  // somehow routes back to itself (it doesn't — buildCrossGameEffects never produces it).
  boss_round: 'active_output',
  real_input: 'active_output',
};

interface Bucket {
  gameType: GameType;
  weight: number;
  reasons: Set<ErrorTag>;
  // We keep raw weak rows so the segment builder can pull either words or sentences.
  weakRows: Array<{ progress: SkillProgress; weight: number }>;
}

export function selectBossSession(input: SelectBossSessionInput): SelectBossSessionOutput {
  const segmentCount = input.segmentCount ?? DEFAULT_SEGMENT_COUNT;
  const itemsPerSegment = input.itemsPerSegment ?? DEFAULT_ITEMS_PER_SEGMENT;
  const wordTimeLimitMs = input.wordTimeLimitMs ?? 6000;
  const sentenceTimeLimitMs = input.sentenceTimeLimitMs ?? 25_000;
  const choiceTimeLimitMs = input.choiceTimeLimitMs ?? 8000;

  const weakRows = input.progress.filter(isWeak);
  if (weakRows.length === 0) {
    return { segments: [], weakCandidateCount: 0 };
  }

  // 1. Bucket every weak row by the cross-game routing of its first lastErrorTag.
  const buckets = new Map<GameType, Bucket>();
  for (const row of weakRows) {
    const itemWeight = Math.max(1, row.lapseCount + row.wrongCount);
    const tags = row.lastErrorTags;
    const targets = tags.length === 0 ? defaultTargetForState(row) : routeTags(tags);
    if (targets.length === 0) continue;
    for (const t of targets) {
      let bucket = buckets.get(t.targetGameType);
      if (!bucket) {
        bucket = {
          gameType: t.targetGameType,
          weight: 0,
          reasons: new Set<ErrorTag>(),
          weakRows: [],
        };
        buckets.set(t.targetGameType, bucket);
      }
      bucket.weight += itemWeight * t.priorityBoost;
      bucket.reasons.add(t.reason);
      bucket.weakRows.push({ progress: row, weight: itemWeight });
    }
  }

  // 2. Sort buckets by aggregate weight; take the top N. Tie-breaker on bucket count keeps
  // gameTypes with more distinct items above thin-but-heavy buckets.
  const sortedBuckets = [...buckets.values()]
    .sort((a, b) => b.weight - a.weight || b.weakRows.length - a.weakRows.length)
    .slice(0, segmentCount);

  // 3. For each bucket, pull the matching content (LearningItems for word/choice/listening
  // games, SentenceItems for river_jump). Items are sorted by per-item weight desc, then
  // truncated to `itemsPerSegment`. If a bucket can't be filled (no eligible content), drop
  // it — better to ship a 3-segment Boss than a hollow placeholder segment.
  const itemIndex = new Map(input.learningItems.map((it) => [it.id, it]));
  const sentenceIndex = new Map(input.sentenceItems.map((s) => [s.id, s]));
  const segments: BossSegment[] = [];
  for (const bucket of sortedBuckets) {
    const sortedRows = [...bucket.weakRows].sort((a, b) => b.weight - a.weight);
    if (bucket.gameType === 'river_jump') {
      const sentences: SentenceItem[] = [];
      for (const row of sortedRows) {
        if (sentences.length >= itemsPerSegment) break;
        const s = sentenceIndex.get(row.progress.itemId);
        if (s) sentences.push(s);
      }
      if (sentences.length === 0) continue;
      segments.push({
        gameType: bucket.gameType,
        skillDimension: 'sentence_order',
        weight: bucket.weight,
        reasons: [...bucket.reasons],
        content: { kind: 'sentences', sentences },
        timeLimitMs: sentenceTimeLimitMs,
        taskCount: sentences.length,
      });
      continue;
    }
    const items: LearningItem[] = [];
    for (const row of sortedRows) {
      if (items.length >= itemsPerSegment) break;
      const it = itemIndex.get(row.progress.itemId);
      if (it) items.push(it);
    }
    if (items.length === 0) continue;
    segments.push({
      gameType: bucket.gameType,
      skillDimension: SKILL_FOR_GAME[bucket.gameType],
      weight: bucket.weight,
      reasons: [...bucket.reasons],
      content: { kind: 'words', items },
      timeLimitMs:
        bucket.gameType === 'space_battle' || bucket.gameType === 'apple_rescue'
          ? choiceTimeLimitMs
          : wordTimeLimitMs,
      taskCount: items.length,
    });
  }

  return { segments, weakCandidateCount: weakRows.length };
}

function isWeak(p: SkillProgress): boolean {
  if (p.state === 'fragile' || p.state === 'learning') return true;
  if (p.lastErrorTags.length > 0) return true;
  return false;
}

function routeTags(tags: ErrorTag[]): CrossGameEffect[] {
  // Synthesise a minimal evaluation result so we can reuse the canonical routing rule.
  const synthetic: EvaluationResult = {
    attemptId: '',
    taskId: '',
    itemId: '',
    skillDimension: 'meaning_recall',
    isCorrect: false,
    score: 0,
    accuracyScore: 0,
    speedScore: 0,
    confidenceScore: 0,
    errorTags: tags,
    expectedDisplay: '',
    actualDisplay: '',
    reactionTimeMs: 0,
    shouldRepeatImmediately: false,
    crossGameEffects: [],
  };
  return buildCrossGameEffects(synthetic);
}

/**
 * Fallback when a row is fragile/learning but has no recorded errorTags (rare but possible
 * for items that lapsed after an SRS cooldown). Route by skill dimension so the user still
 * sees a meaningful segment.
 */
function defaultTargetForState(p: SkillProgress): CrossGameEffect[] {
  switch (p.skillDimension) {
    case 'kana_typing':
    case 'kana_recognition':
    case 'katakana_recognition':
      return [
        {
          targetGameType: 'mole_story',
          skillDimension: 'kana_typing',
          priorityBoost: 0.5,
          reason: 'unknown',
        },
      ];
    case 'kanji_reading':
      return [
        {
          targetGameType: 'speed_chase',
          skillDimension: 'kanji_reading',
          priorityBoost: 0.5,
          reason: 'unknown',
        },
      ];
    case 'meaning_recall':
      return [
        {
          targetGameType: 'space_battle',
          skillDimension: 'meaning_recall',
          priorityBoost: 0.5,
          reason: 'unknown',
        },
      ];
    case 'listening_discrimination':
      return [
        {
          targetGameType: 'apple_rescue',
          skillDimension: 'listening_discrimination',
          priorityBoost: 0.5,
          reason: 'unknown',
        },
      ];
    case 'sentence_order':
    case 'particle_usage':
      return [
        {
          targetGameType: 'river_jump',
          skillDimension: 'sentence_order',
          priorityBoost: 0.5,
          reason: 'unknown',
        },
      ];
    case 'ime_conversion':
    case 'active_output':
      return [];
  }
}
