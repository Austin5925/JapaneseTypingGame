import type { GameBlock, WeaknessVector } from '../types/domain';

import { hasTopError } from './weaknessVector';

export interface SelectGameBlocksInput {
  vector: WeaknessVector;
  /** Total session length the user committed to today (ms). 8 minutes = 480_000. */
  targetDurationMs: number;
}

/**
 * Pick the game blocks for today's session.
 *
 * Strategy (devdocs §10.2 with concrete thresholds):
 *   - katakana weakness > 0.6  → 90s mole (katakana专项)
 *   - kanji-reading > 0.5      → 180s speed-chase
 *   - long-vowel/sokuon/dakuten in topErrorTags → 120s apple_rescue (listening)
 *   - particle/sentence-order weakness > 0.5 → 120s river_jump
 *   - meaning/same-sound confusion or meaningRecall weakness → 120s space_battle
 *
 * The function clamps the total to `targetDurationMs` by dropping the lowest-priority block
 * if necessary. Sprint 5 is intentionally simple; Sprint 5+ will swap this for a richer
 * planner that consults `topErrorTags` more aggressively.
 */
export function selectGameBlocks(input: SelectGameBlocksInput): GameBlock[] {
  const { vector, targetDurationMs } = input;
  const blocks: GameBlock[] = [];

  if (vector.katakanaRecognition > 0.6) {
    blocks.push({
      gameType: 'mole_story',
      skillDimension: 'katakana_recognition',
      durationMs: 90_000,
      priority: 1,
      reason: '片假名识别速度慢',
    });
  } else if (vector.kanaRecognition > 0.6) {
    blocks.push({
      gameType: 'mole_story',
      skillDimension: 'kana_typing',
      durationMs: 60_000,
      priority: 1,
      reason: '假名输入还在练习阶段',
    });
  }

  if (vector.kanjiReading > 0.5) {
    blocks.push({
      gameType: 'speed_chase',
      skillDimension: 'kanji_reading',
      durationMs: 180_000,
      priority: 2,
      reason: '汉字读音弱',
    });
  }

  if (
    hasTopError(vector, [
      'long_vowel_error',
      'sokuon_error',
      'dakuten_error',
      'near_sound_confusion',
    ])
  ) {
    blocks.push({
      gameType: 'apple_rescue',
      skillDimension: 'listening_discrimination',
      durationMs: 120_000,
      priority: 3,
      reason: '近期长音 / 促音 / 浊音听辨错误偏多',
    });
  }

  if (
    vector.particleUsage > 0.5 ||
    vector.sentenceOrder > 0.5 ||
    hasTopError(vector, ['particle_error', 'word_order_error'])
  ) {
    const particleFocused =
      vector.particleUsage > vector.sentenceOrder || hasTopError(vector, ['particle_error']);
    blocks.push({
      gameType: 'river_jump',
      skillDimension: particleFocused ? 'particle_usage' : 'sentence_order',
      durationMs: 120_000,
      priority: 4,
      reason: particleFocused ? '助词读音 / 用法需要回流' : '句子 chunk 顺序需要巩固',
    });
  }

  if (
    vector.meaningRecall > 0.6 ||
    hasTopError(vector, ['same_sound_confusion', 'meaning_confusion'])
  ) {
    blocks.push({
      gameType: 'space_battle',
      skillDimension: 'meaning_recall',
      durationMs: 120_000,
      priority: 5,
      reason: '同音 / 近形 / 意义混淆需要辨析',
    });
  }

  // Empty-state fallback: a user with no progress should still see *something*.
  if (blocks.length === 0) {
    blocks.push({
      gameType: 'mole_story',
      skillDimension: 'kana_typing',
      durationMs: 60_000,
      priority: 1,
      reason: '今天先做一轮基础假名训练',
    });
    blocks.push({
      gameType: 'speed_chase',
      skillDimension: 'kanji_reading',
      durationMs: 120_000,
      priority: 2,
      reason: '热身后再来 2 分钟读音冲刺',
    });
  }

  blocks.sort((a, b) => a.priority - b.priority);
  return fitBlocksToDuration(blocks, targetDurationMs);
}

function fitBlocksToDuration(blocks: GameBlock[], targetMs: number): GameBlock[] {
  let total = 0;
  const out: GameBlock[] = [];
  for (const b of blocks) {
    if (total + b.durationMs > targetMs && out.length > 0) break;
    out.push(b);
    total += b.durationMs;
  }
  return out;
}
