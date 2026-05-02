import { buildCrossGameEffects, type ErrorTag, type GameType } from '@kana-typing/core';

import type { AttemptEventRow, ProgressDto } from '../../tauri/invoke';

/**
 * ResultPage's "what changed this session" derivation. All inputs are already on the page
 * (attempt log + the user's full progress map), so this stays a pure function — easy to test
 * and trivial to swap in a future Boss-round result view that aggregates across multiple
 * sessions.
 */

export interface SessionInsightsInput {
  /** All attempts logged for this session, oldest → newest. */
  attempts: AttemptEventRow[];
  /**
   * Progress rows for the user as of *now* (post-session). The page reads these from
   * `listProgress` after the session has flushed, then passes them in.
   */
  currentProgress: ProgressDto[];
}

export interface CrossGameRecommendation {
  targetGameType: GameType;
  reason: ErrorTag;
  /** How many attempts in the session contributed to this recommendation. */
  weight: number;
  /** UI-friendly Chinese label for the recommendation chip. */
  label: string;
  /** Suggested deep-link hash to open the recommended game. */
  href: string;
}

export interface SessionInsights {
  /** Item ids the user got wrong at least once in this session. */
  newMistakeItemIds: string[];
  /**
   * Item ids whose post-session mastery state is `stable` or `fluent` AND whose latest
   * attempt belongs to this session. Sample uses: "本次掌握 N 词" badge.
   */
  newlyMasteredItemIds: string[];
  /** Sorted by weight desc, deduped by gameType+reason. */
  crossGameRecommendations: CrossGameRecommendation[];
}

const MASTERED_STATES = new Set<ProgressDto['state']>(['stable', 'fluent']);

const RECOMMENDATION_LABELS: Record<GameType, { label: string; href: string }> = {
  apple_rescue: { label: '去拯救苹果听辨', href: '#/game/apple-rescue' },
  space_battle: { label: '去太空大战辨义', href: '#/game/space-battle' },
  river_jump: { label: '去激流勇进练语序', href: '#/game/river-jump' },
  speed_chase: { label: '去生死时速读音', href: '#/game/speed-chase' },
  mole_story: { label: '去鼹鼠的故事补假名', href: '#/game/mole' },
  real_input: { label: '去实战输入', href: '#/' },
};

export function computeSessionInsights(input: SessionInsightsInput): SessionInsights {
  const { attempts, currentProgress } = input;

  // 1. Mistakes: any wrong attempt on item X qualifies X. Repeated wrongs of the same item
  // do not double-count — the user perceives "new wrong word entered notebook" once.
  const wrongIds = new Set<string>();
  for (const a of attempts) {
    if (!a.isCorrect) wrongIds.add(a.itemId);
  }

  // 2. Newly mastered: progress state is now in the mastered set, AND the most recent attempt
  // happened during this session. Without the latter, every previously-mastered item would
  // light up the "新掌握" badge on every result page.
  const sessionItemIds = new Set(attempts.map((a) => a.itemId));
  const newlyMastered: string[] = [];
  for (const p of currentProgress) {
    if (!sessionItemIds.has(p.itemId)) continue;
    if (!MASTERED_STATES.has(p.state)) continue;
    newlyMastered.push(p.itemId);
  }

  // 3. Cross-game recommendations: aggregate over every wrong attempt's errorTags. We
  // synthesise a minimal EvaluationResult shape so we can reuse buildCrossGameEffects without
  // forking the routing rules. Weight = how many attempts in this session contributed.
  const recoCounts = new Map<string, { rec: CrossGameRecommendation; count: number }>();
  for (const a of attempts) {
    if (a.isCorrect) continue;
    const tags = (a.errorTags as ErrorTag[]) ?? [];
    if (tags.length === 0) continue;
    const synthetic = {
      attemptId: a.id,
      taskId: '',
      itemId: a.itemId,
      skillDimension: 'meaning_recall',
      isCorrect: false,
      score: 0,
      accuracyScore: 0,
      speedScore: 0,
      confidenceScore: 0,
      errorTags: tags,
      expectedDisplay: '',
      actualDisplay: '',
      reactionTimeMs: a.reactionTimeMs,
      shouldRepeatImmediately: false,
      crossGameEffects: [],
    } as Parameters<typeof buildCrossGameEffects>[0];
    const effects = buildCrossGameEffects(synthetic);
    for (const e of effects) {
      const key = `${e.targetGameType}::${e.reason}`;
      const meta = RECOMMENDATION_LABELS[e.targetGameType];
      if (!meta) continue;
      const existing = recoCounts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        recoCounts.set(key, {
          rec: {
            targetGameType: e.targetGameType,
            reason: e.reason,
            weight: 0,
            label: meta.label,
            href: meta.href,
          },
          count: 1,
        });
      }
    }
  }
  const recommendations = [...recoCounts.values()]
    .map(({ rec, count }) => ({ ...rec, weight: count }))
    .sort((a, b) => b.weight - a.weight);

  return {
    newMistakeItemIds: [...wrongIds],
    newlyMasteredItemIds: newlyMastered,
    crossGameRecommendations: recommendations,
  };
}
