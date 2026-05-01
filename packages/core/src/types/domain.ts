import type {
  AnswerMode,
  ErrorTag,
  GameType,
  Jlpt,
  LearningItemQuality,
  LearningItemType,
  MasteryState,
  SkillDimension,
} from './enums';

// ──────────────────────────────────────────────────────────────────────────
// Content
// ──────────────────────────────────────────────────────────────────────────

export interface AudioRef {
  id: string;
  kind: 'word' | 'sentence' | 'cue' | 'sfx';
  path: string;
  durationMs?: number;
  speaker?: string;
  speed?: 'normal' | 'slow';
}

export interface ExampleSentence {
  id: string;
  ja: string;
  kana?: string;
  zh: string;
  targetSurface?: string;
  targetKana?: string;
  audioRef?: string;
  tags?: string[];
}

export interface LearningItem {
  id: string;
  type: LearningItemType;
  surface: string;
  kana: string;
  romaji: string[];
  meaningsZh: string[];
  meaningsEn?: string[];
  pos?: string;
  jlpt?: Jlpt;
  tags: string[];
  skillTags: SkillDimension[];
  errorTags?: ErrorTag[];
  acceptedSurfaces?: string[];
  acceptedKana?: string[];
  examples: ExampleSentence[];
  audioRefs: AudioRef[];
  confusableItemIds: string[];
  sourcePackId: string;
  quality: LearningItemQuality;
  createdAt: string;
  updatedAt: string;
}

// ──────────────────────────────────────────────────────────────────────────
// Tasks
// ──────────────────────────────────────────────────────────────────────────

export interface EvaluationStrictness {
  longVowel: 'strict' | 'warn' | 'ignore';
  sokuon: 'strict' | 'warn' | 'ignore';
  dakuten: 'strict' | 'warn' | 'ignore';
  handakuten: 'strict' | 'warn' | 'ignore';
  youon: 'strict' | 'warn' | 'ignore';
  kanjiSurface: 'strict' | 'accepted_variants';
  particleReading: 'surface' | 'pronunciation' | 'both';
}

export interface TrainingPrompt {
  kind: 'text' | 'audio' | 'image' | 'sentence_gap' | 'meaning';
  text?: string;
  audioRef?: string;
  meaningZh?: string;
  sentenceJa?: string;
  sentenceZh?: string;
  highlightRange?: [number, number];
}

export interface ChunkExpectation {
  id: string;
  /** Surface text shown on the lily-pad (kanji / kana / mixed). */
  text: string;
  /** Canonical kana reading the user must type when this chunk is selected. */
  kana: string;
  /** Romaji forms accepted for the kana reading. */
  romaji: string[];
  /** Optional alt-surface variants (e.g. kanji vs hiragana) accepted for the chunk. */
  acceptedSurfaces?: string[];
}

export interface ExpectedAnswer {
  surface?: string;
  kana?: string;
  romaji?: string[];
  meaningZh?: string;
  optionId?: string;
  /** Canonical chunk order (the answer the user is "supposed to" produce). */
  chunkOrder?: string[];
  /** Per-chunk reading metadata for sentence-order tasks. */
  chunks?: ChunkExpectation[];
  /**
   * Additional accepted chunk orderings beyond `chunkOrder`. Empty / undefined means only the
   * canonical order is accepted. Each entry must be a permutation of the chunk-id set.
   */
  acceptedChunkOrders?: string[][];
  acceptedSurfaces?: string[];
  acceptedKana?: string[];
}

/**
 * Wire format for `UserAttempt.rawInput` on sentence-order attempts. The Scene serialises one
 * of these per chunk (in user-selection order) so the evaluator can replay per-chunk reading
 * comparisons without sharing scene state. Stays in `rawInput` (a free-form TEXT column) so we
 * don't need to touch the attempt_events DTO for v0.8.
 */
export interface SentenceChunkAttemptEntry {
  chunkId: string;
  /** What the user typed for this chunk (raw, before kana normalisation). */
  input: string;
}

export interface TrainingOption {
  id: string;
  label: string;
  kana?: string;
  meaningZh?: string;
  itemId?: string;
  isCorrect: boolean;
  errorTagIfChosen?: ErrorTag;
}

export interface AttemptSummary {
  isCorrect: boolean;
  reactionTimeMs: number;
  errorTags: ErrorTag[];
  at: string;
}

export interface TrainingContext {
  exampleSentence?: ExampleSentence;
  previousAttempts?: AttemptSummary[];
  contrastSet?: string[];
  explanation?: string;
}

export interface TrainingTask {
  id: string;
  sessionId: string;
  itemId: string;
  gameType: GameType;
  answerMode: AnswerMode;
  skillDimension: SkillDimension;
  prompt: TrainingPrompt;
  expected: ExpectedAnswer;
  options?: TrainingOption[];
  context?: TrainingContext;
  difficulty: number; // 0-1
  timeLimitMs?: number;
  allowHints: boolean;
  strictness: EvaluationStrictness;
  createdAt: string;
}

// ──────────────────────────────────────────────────────────────────────────
// Attempts & evaluation
// ──────────────────────────────────────────────────────────────────────────

export interface UserAttempt {
  id: string;
  sessionId: string;
  taskId: string;
  itemId: string;
  gameType: GameType;
  rawInput?: string;
  committedInput?: string;
  selectedOptionId?: string;
  chunkOrder?: string[];
  startedAt: string;
  submittedAt: string;
  reactionTimeMs: number;
  usedHint: boolean;
  inputMethod: 'romaji' | 'ime' | 'click' | 'keyboard_select' | 'audio_only';
}

export interface CrossGameEffect {
  targetGameType: GameType;
  skillDimension: SkillDimension;
  priorityBoost: number; // 0-1
  reason: ErrorTag;
}

export interface EvaluationResult {
  attemptId: string;
  taskId: string;
  itemId: string;
  skillDimension: SkillDimension;
  isCorrect: boolean;
  score: number; // 0-100
  accuracyScore: number; // 0-1
  speedScore: number; // 0-1
  confidenceScore: number; // 0-1
  errorTags: ErrorTag[];
  expectedDisplay: string;
  actualDisplay: string;
  reactionTimeMs: number;
  explanation?: string;
  shouldRepeatImmediately: boolean;
  crossGameEffects: CrossGameEffect[];
}

// ──────────────────────────────────────────────────────────────────────────
// Progress & mastery
// ──────────────────────────────────────────────────────────────────────────

export interface SkillProgress {
  userId: string;
  itemId: string;
  skillDimension: SkillDimension;
  state: MasteryState;
  masteryScore: number; // 0-100
  stability: number;
  difficulty: number; // 0-1
  exposureCount: number;
  correctCount: number;
  wrongCount: number;
  streak: number;
  lapseCount: number;
  averageReactionTimeMs?: number;
  lastAttemptAt?: string;
  nextDueAt?: string;
  lastErrorTags: ErrorTag[];
  updatedAt: string;
}

// ──────────────────────────────────────────────────────────────────────────
// Sessions
// ──────────────────────────────────────────────────────────────────────────

export type SessionStatus = 'active' | 'paused' | 'finished' | 'aborted';

export interface GameSession {
  id: string;
  userId: string;
  gameType: GameType;
  planId?: string;
  startedAt: string;
  endedAt?: string;
  status: SessionStatus;
  targetDurationMs?: number;
  finalScore?: number;
}

export interface SessionSummary {
  sessionId: string;
  totalAttempts: number;
  correctAttempts: number;
  accuracy: number;
  averageReactionTimeMs: number;
  errorTagCounts: Partial<Record<ErrorTag, number>>;
  newlyMasteredItemIds: string[];
  fragileItemIds: string[];
  topMistakes: Array<{ itemId: string; tag: ErrorTag; count: number }>;
}

// ──────────────────────────────────────────────────────────────────────────
// Daily plan
// ──────────────────────────────────────────────────────────────────────────

export interface WeaknessVector {
  kanaRecognition: number;
  katakanaRecognition: number;
  kanjiReading: number;
  meaningRecall: number;
  imeConversion: number;
  listeningDiscrimination: number;
  particleUsage: number;
  sentenceOrder: number;
  activeOutput: number;
  topErrorTags: Array<{ tag: ErrorTag; weight: number }>;
  weakestItems: Array<{ itemId: string; weight: number }>;
}

export interface DailyPlan {
  id: string;
  userId: string;
  date: string;
  targetDurationMs: number;
  generatedAt: string;
  completedAt?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'abandoned';
  weaknessVector: WeaknessVector;
  blocks: GameBlock[];
}

export interface GameBlock {
  gameType: GameType;
  skillDimension: SkillDimension;
  durationMs: number;
  priority: number;
  reason: string;
}
