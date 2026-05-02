import type {
  EvaluationStrictness,
  LearningItem,
  SkillProgress,
  TrainingTask,
} from '../types/domain';
import type { AnswerMode, GameType, SkillDimension } from '../types/enums';

export interface SelectKanaTasksInput {
  /** Items in the user's chosen content packs that the selector may pick from. */
  items: LearningItem[];
  /**
   * Optional progress map keyed by `${itemId}::${skillDimension}` so weak items can be
   * weighted higher. Sprint 3 supports this lookup but doesn't strictly require it; if no
   * progress is available, the selector falls back to a uniform shuffle.
   */
  progress?: Map<string, SkillProgress>;
  /** Number of TrainingTasks to return. */
  count: number;
  sessionId: string;
  gameType: GameType;
  answerMode: AnswerMode;
  skillDimension: SkillDimension;
  /**
   * Per-task time limit in ms. Mole's MVP uses 6000ms; harder kana (拗音 / 片假名 minimal
   * pairs) get a slightly longer slot if you raise this.
   */
  timeLimitMs?: number;
  strictness: EvaluationStrictness;
  /**
   * Optional bias towards items whose `tags` contain a specific value (e.g. 'katakana' or
   * 'long_vowel'). Items matching all biases are duplicated in the candidate pool, raising
   * their selection probability without excluding the rest.
   */
  preferTags?: string[];
  /** RNG injection for tests. Defaults to Math.random. */
  random?: () => number;
}

export interface SelectedTaskQueue {
  next(): TrainingTask | null;
  remaining(): number;
  /** Move an unfinished task to the front of the queue (used after wrong answers). */
  pushFront(task: TrainingTask): void;
}

/**
 * Build a fixed-length task queue for a single mole/speed-chase session.
 *
 * Selection ranking (in priority order):
 *   1. Items whose progress is overdue (next_due_at < now) — the scheduler-due bucket.
 *   2. Items whose state is `fragile` or `learning` — pending mastery.
 *   3. Items in the `seen` / `new` bucket — fresh exposure.
 *   4. Items already `stable` / `fluent` — only when above are exhausted.
 * Within each bucket, `preferTags` items are weighted ~2x by duplicating them in the pool.
 *
 * The returned queue is a thin object so callers can `next()` and `pushFront()` for severe-
 * error retries without tracking indices themselves. Sprint 3 hands the queue to a
 * GameBridge adapter; later sprints reuse the same selector for SpeedChase / SpaceBattle.
 */
export function selectKanaTasks(input: SelectKanaTasksInput): SelectedTaskQueue {
  const random = input.random ?? Math.random;
  const now = Date.now();
  const buckets: LearningItem[][] = [[], [], [], []];
  const eligibleItems = input.items.filter((item) =>
    isEligibleForSkill(item, input.skillDimension),
  );
  for (const item of eligibleItems) {
    const key = progressKey(item.id, input.skillDimension);
    const p = input.progress?.get(key);
    const bucket = bucketFor(p, now);
    buckets[bucket]!.push(item);
  }

  const rankedCandidates: LearningItem[] = [];
  for (const b of buckets) {
    const bucketCandidates: LearningItem[] = [];
    for (const item of b) {
      bucketCandidates.push(item);
      if (input.preferTags && input.preferTags.some((t) => item.tags.includes(t))) {
        // Duplicate to bias selection. Cheap and deterministic given the rng.
        bucketCandidates.push(item);
      }
    }
    fisherYates(bucketCandidates, random);
    rankedCandidates.push(...bucketCandidates);
  }

  if (rankedCandidates.length === 0) {
    return makeQueue([]);
  }

  const tasks: TrainingTask[] = [];
  for (let i = 0; tasks.length < input.count; i++) {
    const item = rankedCandidates[i % rankedCandidates.length]!;
    tasks.push(buildTask(item, input));
  }

  return makeQueue(tasks);
}

function bucketFor(progress: SkillProgress | undefined, now: number): 0 | 1 | 2 | 3 {
  if (!progress) return 2; // never seen → exposure bucket
  if (progress.nextDueAt && Date.parse(progress.nextDueAt) <= now) return 0;
  if (progress.lastErrorTags.length > 0) return 1;
  if (progress.state === 'fragile' || progress.state === 'learning') return 1;
  if (progress.state === 'new' || progress.state === 'seen') return 2;
  return 3;
}

function fisherYates<T>(arr: T[], random: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

function buildTask(item: LearningItem, input: SelectKanaTasksInput): TrainingTask {
  const task: TrainingTask = {
    id: makeTaskId(),
    sessionId: input.sessionId,
    itemId: item.id,
    gameType: input.gameType,
    answerMode: input.answerMode,
    skillDimension: input.skillDimension,
    prompt: { kind: 'text', text: item.surface },
    expected: {
      kana: item.kana,
      ...(item.acceptedKana && item.acceptedKana.length > 0
        ? { acceptedKana: item.acceptedKana }
        : {}),
      surface: item.surface,
    },
    difficulty: 0.4,
    allowHints: false,
    strictness: input.strictness,
    createdAt: new Date().toISOString(),
  };
  if (input.timeLimitMs !== undefined) {
    task.timeLimitMs = input.timeLimitMs;
  }
  return task;
}

function isEligibleForSkill(item: LearningItem, skill: SkillDimension): boolean {
  if (isKanaDrillSkill(skill) && !isKanaDrillItem(item)) return false;
  if (item.skillTags.includes(skill)) return true;
  switch (skill) {
    case 'kana_typing':
      return isKanaDrillItem(item) && item.kana.length > 0;
    case 'kana_recognition':
      return isKanaDrillItem(item) && item.kana.length > 0 && !item.tags.includes('katakana');
    case 'katakana_recognition':
      return isKanaDrillItem(item) && item.tags.includes('katakana');
    case 'kanji_reading':
    case 'meaning_recall':
    case 'ime_conversion':
    case 'listening_discrimination':
    case 'particle_usage':
    case 'sentence_order':
    case 'active_output':
      return false;
  }
}

function isKanaDrillItem(item: LearningItem): boolean {
  return item.type !== 'sentence' && item.type !== 'grammar_pattern';
}

function isKanaDrillSkill(skill: SkillDimension): boolean {
  return (
    skill === 'kana_typing' || skill === 'kana_recognition' || skill === 'katakana_recognition'
  );
}

function makeQueue(initial: TrainingTask[]): SelectedTaskQueue {
  const queue = [...initial];
  return {
    next: () => queue.shift() ?? null,
    remaining: () => queue.length,
    pushFront: (task) => {
      queue.unshift(task);
    },
  };
}

function progressKey(itemId: string, skill: SkillDimension): string {
  return `${itemId}::${skill}`;
}

function makeTaskId(): string {
  const uuid =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString()}-${Math.random().toString(16).slice(2)}`;
  return `task_${uuid}`;
}
