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
 * Strategy (v0.8.7):
 *   1. Filter every progress row to "weak":
 *      - state ∈ {fragile, learning}, OR
 *      - lastErrorTags is non-empty (signals a recent slip even on a stable item).
 *   2. For each weak row, ask `buildCrossGameEffects` what game type the dominant errorTag
 *      should route to. This is the same routing rule the scheduler / ResultPage / Mistakes
 *      page uses, so a Boss session reads as "concentrated version of what your error log
 *      already said you should practise".
 *   3. Bucket the weak rows by recommended (gameType, skillDimension), weighting each by
 *      `lapseCount + wrongCount`.
 *   4. Pick up to `segmentCount` playable buckets sorted by total weight; each bucket becomes
 *      one BossSegment. Inside a segment we surface up to `itemsPerSegment` items / sentences,
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

interface Bucket {
  gameType: GameType;
  skillDimension: SkillDimension;
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

  // 1. Bucket every weak row by the cross-game routing of its lastErrorTags.
  const buckets = new Map<string, Bucket>();
  for (const row of weakRows) {
    const itemWeight = Math.max(1, row.lapseCount + row.wrongCount);
    const tags = row.lastErrorTags;
    const targets = tags.length === 0 ? defaultTargetForState(row) : routeTags(tags);
    if (targets.length === 0) continue;
    for (const t of targets) {
      const bucketKey = `${t.targetGameType}::${t.skillDimension}`;
      let bucket = buckets.get(bucketKey);
      if (!bucket) {
        bucket = {
          gameType: t.targetGameType,
          skillDimension: t.skillDimension,
          weight: 0,
          reasons: new Set<ErrorTag>(),
          weakRows: [],
        };
        buckets.set(bucketKey, bucket);
      }
      bucket.weight += itemWeight * t.priorityBoost;
      bucket.reasons.add(t.reason);
      bucket.weakRows.push({ progress: row, weight: itemWeight });
    }
  }

  // 2. Sort buckets by aggregate weight; take the top N. Tie-breaker on bucket count keeps
  // gameTypes with more distinct items above thin-but-heavy buckets.
  const sortedBuckets = [...buckets.values()].sort(
    (a, b) => b.weight - a.weight || b.weakRows.length - a.weakRows.length,
  );

  // 3. For each bucket, pull the matching content (LearningItems for word/choice/listening
  // games, SentenceItems for river_jump). Items are sorted by per-item weight desc, then
  // truncated to `itemsPerSegment`. If a bucket can't be filled (no eligible content), drop
  // it — better to ship a 3-segment Boss than a hollow placeholder segment.
  const itemIndex = new Map(input.learningItems.map((it) => [it.id, it]));
  const sentenceIndex = new Map(input.sentenceItems.map((s) => [s.id, s]));
  const segments: BossSegment[] = [];
  for (const bucket of sortedBuckets) {
    if (segments.length >= segmentCount) break;
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
        skillDimension: bucket.skillDimension,
        weight: bucket.weight,
        reasons: [...bucket.reasons],
        content: { kind: 'sentences', sentences },
        timeLimitMs: sentenceTimeLimitMs,
        taskCount: sentences.length,
      });
      continue;
    }
    const targetItems = pickTargetItems(sortedRows, itemIndex, itemsPerSegment);
    if (targetItems.length === 0) continue;
    const items = isChoiceGame(bucket.gameType)
      ? withChoiceSupport(
          targetItems,
          input.learningItems,
          bucket.gameType === 'apple_rescue' ? 1 : 3,
        )
      : targetItems;
    segments.push({
      gameType: bucket.gameType,
      skillDimension: bucket.skillDimension,
      weight: bucket.weight,
      reasons: [...bucket.reasons],
      content: { kind: 'words', items },
      timeLimitMs:
        bucket.gameType === 'space_battle' || bucket.gameType === 'apple_rescue'
          ? choiceTimeLimitMs
          : wordTimeLimitMs,
      taskCount: targetItems.length,
    });
  }

  return { segments, weakCandidateCount: weakRows.length };
}

function pickTargetItems(
  sortedRows: Array<{ progress: SkillProgress; weight: number }>,
  itemIndex: Map<string, LearningItem>,
  limit: number,
): LearningItem[] {
  const out: LearningItem[] = [];
  const seen = new Set<string>();
  for (const row of sortedRows) {
    if (out.length >= limit) break;
    if (seen.has(row.progress.itemId)) continue;
    const it = itemIndex.get(row.progress.itemId);
    if (!it) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out;
}

function isChoiceGame(gameType: GameType): boolean {
  return gameType === 'space_battle' || gameType === 'apple_rescue';
}

function withChoiceSupport(
  targetItems: LearningItem[],
  allItems: LearningItem[],
  distractorCount: number,
): LearningItem[] {
  const out = [...targetItems];
  const seen = new Set(out.map((item) => item.id));
  const allById = new Map(allItems.map((item) => [item.id, item]));

  for (const target of targetItems) {
    for (const id of target.confusableItemIds) {
      if (seen.has(id)) continue;
      const item = allById.get(id);
      if (!item || !isChoiceEligible(item)) continue;
      seen.add(item.id);
      out.push(item);
    }
  }

  const minimumPoolSize = Math.max(...targetItems.map((item) => item.confusableItemIds.length), 0);
  const requiredPoolSize = Math.max(distractorCount + 1, minimumPoolSize + 1);
  for (const item of allItems) {
    if (out.length >= requiredPoolSize) break;
    if (seen.has(item.id)) continue;
    if (!isChoiceEligible(item)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function isChoiceEligible(item: LearningItem): boolean {
  return item.meaningsZh.length > 0 && item.surface.length > 0;
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
      return [
        {
          targetGameType: 'mole_story',
          skillDimension: 'kana_typing',
          priorityBoost: 0.5,
          reason: 'unknown',
        },
      ];
    case 'kana_recognition':
      return [
        {
          targetGameType: 'mole_story',
          skillDimension: 'kana_recognition',
          priorityBoost: 0.5,
          reason: 'unknown',
        },
      ];
    case 'katakana_recognition':
      return [
        {
          targetGameType: 'mole_story',
          skillDimension: 'katakana_recognition',
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
    case 'particle_usage':
      return [
        {
          targetGameType: 'river_jump',
          skillDimension: 'particle_usage',
          priorityBoost: 0.5,
          reason: 'unknown',
        },
      ];
    case 'sentence_order':
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
