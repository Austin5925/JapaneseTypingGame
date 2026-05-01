import type { ErrorTag, GameType, LearningItemType, SkillDimension } from '@kana-typing/core';
import { invoke } from '@tauri-apps/api/core';

// Sprint 0 DTOs --------------------------------------------------------------
//
// `DevItemRow` mirrors the Rust struct of the same name in commands.rs. v0.8.3 grew the
// projection (type / errorTags / confusableItemIds / extrasJson) so SpaceBattle / AppleRescue /
// RiverJump can drive their selectors directly from listItems instead of build-time-bundled
// JSON. Word-typed rows leave `extrasJson` null; sentence rows carry a JSON-serialised
// `{chunks, acceptedOrders, zhPrompt}` blob there.

export interface DevItemRow {
  id: string;
  type: LearningItemType;
  surface: string;
  kana: string;
  romaji: string[];
  jlpt: string | null;
  tags: string[];
  skillTags: SkillDimension[];
  errorTags: ErrorTag[];
  acceptedKana: string[];
  meaningsZh: string[];
  confusableItemIds: string[];
  sourcePackId: string;
  extrasJson: string | null;
}

export interface SeedTestPackResult {
  packId: string;
  itemsUpserted: number;
  packsUpserted?: number;
}

export function seedTestPack(): Promise<SeedTestPackResult> {
  return invoke<SeedTestPackResult>('seed_test_pack');
}

export function listItems(args: { limit?: number } = {}): Promise<DevItemRow[]> {
  return invoke<DevItemRow[]>('list_items', { limit: args.limit ?? 50 });
}

export interface DbInfo {
  path: string;
  appliedMigrations: string[];
  itemCount: number;
}

export function getDbInfo(): Promise<DbInfo> {
  return invoke<DbInfo>('get_db_info');
}

// P0-4 ContentPacksPage --------------------------------------------------

export interface ContentPackRow {
  id: string;
  name: string;
  version: string;
  author: string | null;
  locale: string;
  quality: string;
  description: string | null;
  importedAt: string;
  enabled: boolean;
  itemCount: number;
}

export function listContentPacks(): Promise<ContentPackRow[]> {
  return invoke<ContentPackRow[]>('list_content_packs');
}

export function setPackEnabled(input: { packId: string; enabled: boolean }): Promise<void> {
  return invoke<void>('set_pack_enabled', { input });
}

// Sprint 2 DTOs ------------------------------------------------------------

export interface CreateSessionInput {
  id: string;
  userId: string;
  gameType: GameType;
  planId?: string;
  targetDurationMs?: number;
}

export interface SessionRecord {
  id: string;
  userId: string;
  gameType: string;
  planId: string | null;
  startedAt: string;
  endedAt: string | null;
  status: string;
  targetDurationMs: number | null;
}

export function createSession(input: CreateSessionInput): Promise<SessionRecord> {
  return invoke<SessionRecord>('create_session', { input });
}

export interface FinishSessionInput {
  sessionId: string;
  status: 'finished' | 'aborted' | 'timeout';
  finalScore?: number;
  summaryJson?: string;
}

export function finishSession(input: FinishSessionInput): Promise<void> {
  return invoke('finish_session', { input });
}

export interface AttemptEventInsert {
  id: string;
  sessionId: string;
  userId: string;
  taskId: string;
  itemId: string;
  gameType: GameType;
  skillDimension: SkillDimension;
  answerMode: string;
  rawInput?: string;
  committedInput?: string;
  selectedOptionId?: string;
  chunkOrder?: string[];
  isCorrect: boolean;
  score: number;
  reactionTimeMs: number;
  usedHint: boolean;
  errorTags: string[];
  explanation?: string;
}

export function insertAttemptEvent(input: AttemptEventInsert): Promise<void> {
  return invoke('insert_attempt_event', { input });
}

export interface ProgressDto {
  userId: string;
  itemId: string;
  skillDimension: SkillDimension;
  state: string;
  masteryScore: number;
  stability: number;
  difficulty: number;
  exposureCount: number;
  correctCount: number;
  wrongCount: number;
  streak: number;
  lapseCount: number;
  averageReactionTimeMs: number | null;
  lastAttemptAt: string | null;
  nextDueAt: string | null;
  lastErrorTags: string[];
  updatedAt: string;
}

export interface GetProgressInput {
  userId: string;
  itemId: string;
  skillDimension: SkillDimension;
}

export function getProgress(input: GetProgressInput): Promise<ProgressDto | null> {
  return invoke<ProgressDto | null>('get_progress', { input });
}

export function upsertProgress(input: ProgressDto): Promise<void> {
  return invoke('upsert_progress', { input });
}

export interface AttemptListInput {
  userId: string;
  itemId?: string;
  limit?: number;
}

export interface AttemptEventRow {
  id: string;
  sessionId: string;
  itemId: string;
  answerMode: string;
  isCorrect: boolean;
  score: number;
  reactionTimeMs: number;
  errorTags: string[];
  createdAt: string;
}

export function listRecentAttempts(input: AttemptListInput): Promise<AttemptEventRow[]> {
  return invoke<AttemptEventRow[]>('list_recent_attempts', { input });
}

export interface AttemptsBySessionInput {
  sessionId: string;
}

/**
 * Server-side filtered attempt log for one session. Use this on ResultPage instead of
 * filtering listRecentAttempts client-side, which silently drops rows past its limit once
 * the user has accumulated history.
 */
export function listAttemptsBySession(input: AttemptsBySessionInput): Promise<AttemptEventRow[]> {
  return invoke<AttemptEventRow[]>('list_attempts_by_session', { input });
}

export interface RecordAttemptResultInput {
  attempt: AttemptEventInsert;
  progress: ProgressDto;
}

/**
 * Atomic counterpart to insertAttemptEvent + upsertProgress: both writes happen inside a
 * single SQLite transaction so a partial failure can't leave attempt_events out of sync with
 * item_skill_progress. GameSessionService uses this on flush.
 */
export function recordAttemptResult(input: RecordAttemptResultInput): Promise<void> {
  return invoke('record_attempt_result', { input });
}

export interface ListProgressInput {
  userId: string;
  skillDimension?: SkillDimension;
  limit?: number;
}

export function listProgress(input: ListProgressInput): Promise<ProgressDto[]> {
  return invoke<ProgressDto[]>('list_progress', { input });
}

export interface AggregateErrorTagsInput {
  userId: string;
  days?: number;
  limit?: number;
}

export interface ErrorTagAggregateRow {
  tag: string;
  count: number;
}

export function aggregateRecentErrorTags(
  input: AggregateErrorTagsInput,
): Promise<ErrorTagAggregateRow[]> {
  return invoke<ErrorTagAggregateRow[]>('aggregate_recent_error_tags', { input });
}
