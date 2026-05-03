import type { ErrorTag, GameType, LearningItemType, SkillDimension } from '@kana-typing/core';
import { invoke } from '@tauri-apps/api/core';

export const FULL_ITEM_SCAN_LIMIT = 5000;

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

export function ensureSeed(): Promise<SeedTestPackResult> {
  return invoke<SeedTestPackResult>('ensure_seed');
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
  gameType: GameType;
  skillDimension: SkillDimension;
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

// v0.9.0 Study mode --------------------------------------------------------
//
// Study mode is the non-game card-based learning surface. study_progress is orthogonal to the
// game-side item_skill_progress: it only tracks "this user has been shown this card".
// `(jlpt, count)` tuples come back as `[string, number]` because serde tuple-serialises into
// a JSON array.

export interface StudyPackSummary {
  packId: string;
  name: string;
  description: string | null;
  totalCount: number;
  studiedCount: number;
  jlptBreakdown: [string, number][];
}

export function listStudyPacks(userId: string): Promise<StudyPackSummary[]> {
  return invoke<StudyPackSummary[]>('list_study_packs', { userId });
}

export interface StudyExample {
  id: string;
  ja: string;
  kana: string | null;
  zh: string;
}

export interface StudyItemRow {
  id: string;
  type: LearningItemType;
  surface: string;
  kana: string;
  romaji: string[];
  pos: string | null;
  jlpt: string | null;
  tags: string[];
  meaningsZh: string[];
  examples: StudyExample[];
  viewCount: number;
  marked: boolean;
  lastViewedAt: string | null;
}

export type StudyFilter = 'all' | 'new' | 'reviewed';

export interface ListStudyItemsInput {
  packId: string;
  userId: string;
  filter?: StudyFilter;
}

export function listStudyItems(input: ListStudyItemsInput): Promise<StudyItemRow[]> {
  return invoke<StudyItemRow[]>('list_study_items', { input });
}

export function recordStudyView(input: { userId: string; itemId: string }): Promise<void> {
  return invoke<void>('record_study_view', { input });
}

export function toggleStudyMarked(input: {
  userId: string;
  itemId: string;
  marked: boolean;
}): Promise<void> {
  return invoke<void>('toggle_study_marked', { input });
}
