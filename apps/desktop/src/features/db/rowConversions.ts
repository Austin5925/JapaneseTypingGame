import type {
  ChunkExpectation,
  LearningItem,
  SentenceItem,
  SkillProgress,
} from '@kana-typing/core';

import type { DevItemRow, ProgressDto } from '../../tauri/invoke';
import { toDomainProgress } from '../session/GameSessionService';

/**
 * Promote a DevItemRow (the projection list_items returns) into a LearningItem suitable for
 * the kana / choice selectors. v0.8.3 grew the row shape so most fields now ship through
 * 1:1 (errorTags, confusableItemIds, source pack id) and selectors can drive themselves
 * directly off SQLite without extra plumbing.
 */
export function rowToLearningItem(row: DevItemRow): LearningItem {
  const item: LearningItem = {
    id: row.id,
    type: row.type,
    surface: row.surface,
    kana: row.kana,
    romaji: row.romaji,
    meaningsZh: row.meaningsZh,
    tags: row.tags,
    skillTags: row.skillTags.length > 0 ? row.skillTags : ['kana_typing'],
    examples: [],
    audioRefs: [],
    confusableItemIds: row.confusableItemIds,
    sourcePackId: row.sourcePackId,
    quality: 'official',
    createdAt: '',
    updatedAt: '',
  };
  if (row.jlpt) {
    item.jlpt = row.jlpt as NonNullable<LearningItem['jlpt']>;
  }
  if (row.errorTags.length > 0) {
    item.errorTags = row.errorTags;
  }
  if (row.acceptedKana.length > 0) {
    item.acceptedKana = row.acceptedKana;
  }
  return item;
}

/**
 * Wire-format echo of the JSON v0.8.3 seed_test_pack writes into learning_items.extras_json
 * for sentence rows. Mirrors the SentenceItemSchema shape minus the surface/id/skillTags
 * fields (those live on the LearningItem row already).
 */
interface SentenceExtrasJson {
  chunks: Array<{
    id: string;
    text: string;
    kana: string;
    romaji: string[];
    pos: string;
    acceptedSurfaces?: string[];
  }>;
  acceptedOrders: string[][];
  zhPrompt: string;
}

/**
 * Reverse the seed_test_pack translation: recover a SentenceItem from a sentence-typed
 * DevItemRow. Returns null if the row's `extrasJson` is absent or malformed (tolerant —
 * we don't want a single bad row to fail the whole session).
 */
export function rowToSentenceItem(row: DevItemRow): SentenceItem | null {
  if (row.type !== 'sentence' || !row.extrasJson) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.extrasJson);
  } catch {
    return null;
  }
  if (!isSentenceExtras(parsed)) return null;
  const chunks: ChunkExpectation[] = parsed.chunks.map((c) => {
    const out: ChunkExpectation = {
      id: c.id,
      text: c.text,
      kana: c.kana,
      romaji: [...c.romaji],
    };
    if (c.acceptedSurfaces && c.acceptedSurfaces.length > 0) {
      out.acceptedSurfaces = [...c.acceptedSurfaces];
    }
    return out;
  });
  const item: SentenceItem = {
    id: row.id,
    surface: row.surface,
    chunks,
    zhPrompt: parsed.zhPrompt,
    acceptedOrders: parsed.acceptedOrders.map((o) => [...o]),
    tags: row.tags,
    skillTags: row.skillTags.length > 0 ? row.skillTags : ['sentence_order'],
  };
  if (row.jlpt) {
    item.jlpt = row.jlpt as NonNullable<SentenceItem['jlpt']>;
  }
  return item;
}

function isSentenceExtras(value: unknown): value is SentenceExtrasJson {
  if (!value || typeof value !== 'object') return false;
  const v = value as { chunks?: unknown; acceptedOrders?: unknown; zhPrompt?: unknown };
  if (!Array.isArray(v.chunks)) return false;
  if (!Array.isArray(v.acceptedOrders)) return false;
  if (typeof v.zhPrompt !== 'string') return false;
  for (const c of v.chunks) {
    if (!c || typeof c !== 'object') return false;
    const ch = c as Record<string, unknown>;
    if (typeof ch.id !== 'string') return false;
    if (typeof ch.text !== 'string') return false;
    if (typeof ch.kana !== 'string') return false;
    if (!Array.isArray(ch.romaji)) return false;
    if (typeof ch.pos !== 'string') return false;
  }
  for (const o of v.acceptedOrders) {
    if (!Array.isArray(o)) return false;
  }
  return true;
}

export function buildProgressMap(dtos: ProgressDto[]): Map<string, SkillProgress> {
  const map = new Map<string, SkillProgress>();
  for (const dto of dtos) {
    const progress = toDomainProgress(dto);
    if (!progress) continue;
    map.set(progressKey(progress.itemId, progress.skillDimension), progress);
  }
  return map;
}

export function progressKey(itemId: string, skill: SkillProgress['skillDimension']): string {
  return `${itemId}::${skill}`;
}
