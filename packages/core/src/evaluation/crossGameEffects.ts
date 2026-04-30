import type { CrossGameEffect, EvaluationResult } from '../types/domain';
import type { ErrorTag } from '../types/enums';

/**
 * Map an evaluation's error tags to follow-up cross-game routing.
 *
 * Why this matters: a user who fails `ビール` for long-vowel reasons in SpeedChase shouldn't
 * just retry it in SpeedChase — they should also see ビール ↔ ビル in the listening game and a
 * dedicated katakana-with-ー mole drill. The data shape is a forward-compatible queue: each
 * effect names the targetGame + skill + priorityBoost + reason. The scheduler / candidate
 * selector consumes these in Sprint 4 to bias the next session.
 */
export function buildCrossGameEffects(evaluation: EvaluationResult): CrossGameEffect[] {
  const effects: CrossGameEffect[] = [];
  const seen = new Set<string>();
  const push = (e: CrossGameEffect): void => {
    const key = `${e.targetGameType}::${e.skillDimension}::${e.reason}`;
    if (seen.has(key)) return;
    seen.add(key);
    effects.push(e);
  };

  for (const tag of evaluation.errorTags) {
    for (const e of mapTag(tag)) push(e);
  }
  return effects;
}

function mapTag(tag: ErrorTag): CrossGameEffect[] {
  switch (tag) {
    case 'long_vowel_error':
    case 'sokuon_error':
    case 'dakuten_error':
    case 'handakuten_error':
      return [
        {
          targetGameType: 'apple_rescue',
          skillDimension: 'listening_discrimination',
          priorityBoost: 0.8,
          reason: tag,
        },
        {
          targetGameType: 'mole_story',
          skillDimension: 'kana_typing',
          priorityBoost: 0.4,
          reason: tag,
        },
      ];
    case 'youon_error':
    case 'n_error':
      return [
        {
          targetGameType: 'mole_story',
          skillDimension: 'kana_typing',
          priorityBoost: 0.5,
          reason: tag,
        },
      ];
    case 'kana_shape_confusion':
    case 'katakana_shape_confusion':
      return [
        {
          targetGameType: 'mole_story',
          skillDimension:
            tag === 'katakana_shape_confusion' ? 'katakana_recognition' : 'kana_recognition',
          priorityBoost: 0.7,
          reason: tag,
        },
      ];
    case 'same_sound_confusion':
    case 'meaning_confusion':
      return [
        {
          targetGameType: 'space_battle',
          skillDimension: 'meaning_recall',
          priorityBoost: 0.9,
          reason: tag,
        },
      ];
    case 'near_sound_confusion':
      return [
        {
          targetGameType: 'apple_rescue',
          skillDimension: 'listening_discrimination',
          priorityBoost: 0.8,
          reason: tag,
        },
      ];
    case 'kanji_reading_error':
    case 'ime_conversion_error':
      return [
        {
          targetGameType: 'speed_chase',
          skillDimension: 'kanji_reading',
          priorityBoost: 0.6,
          reason: tag,
        },
      ];
    case 'particle_error':
      return [
        {
          targetGameType: 'river_jump',
          skillDimension: 'particle_usage',
          priorityBoost: 0.9,
          reason: tag,
        },
      ];
    case 'word_order_error':
      return [
        {
          targetGameType: 'river_jump',
          skillDimension: 'sentence_order',
          priorityBoost: 0.9,
          reason: tag,
        },
      ];
    case 'timeout':
    case 'misclick':
    case 'unknown':
      return [];
  }
}
