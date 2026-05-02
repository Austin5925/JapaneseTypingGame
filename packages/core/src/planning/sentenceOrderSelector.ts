import type {
  ChunkExpectation,
  EvaluationStrictness,
  SkillProgress,
  TrainingTask,
} from '../types/domain';
import type { GameType, Jlpt, SkillDimension } from '../types/enums';

/**
 * Sentence-order training data — independent of LearningItem because v0.8.0 ships sentences as
 * static JSON (no SQLite persistence yet). The shape mirrors content-schema's SentenceItem so
 * a future migration can ingest the same files unchanged.
 */
export interface SentenceItem {
  id: string;
  surface: string;
  /** Per-chunk reading metadata. The array order is the canonical answer order. */
  chunks: ChunkExpectation[];
  zhPrompt: string;
  /** Additional accepted permutations of chunk ids. Empty = canonical only. */
  acceptedOrders: string[][];
  jlpt?: Jlpt;
  tags: string[];
  skillTags: SkillDimension[];
}

export interface SelectSentenceOrderTasksInput {
  sentences: SentenceItem[];
  /** Optional progress map keyed by `${itemId}::${skillDimension}` for the same bucket strategy
   * the kana selector uses. May be empty in v0.8.0 (sentence progress isn't persisted yet). */
  progress?: Map<string, SkillProgress>;
  count: number;
  sessionId: string;
  gameType: GameType;
  skillDimension: SkillDimension;
  strictness: EvaluationStrictness;
  /** Bias selection towards sentences whose `tags` include any of these (e.g. ['particle']). */
  preferTags?: string[];
  /** Per-task time limit in ms. RiverJump's MVP uses 20000ms (20s for an entire sentence). */
  timeLimitMs?: number;
  /** RNG injection for tests. Defaults to Math.random. */
  random?: () => number;
}

export interface SelectedSentenceTaskQueue {
  next(): TrainingTask | null;
  remaining(): number;
  pushFront(task: TrainingTask): void;
}

/**
 * Build a fixed-length task queue for a single river-jump session.
 *
 * Selection ranking mirrors `selectKanaTasks` (overdue → fragile/learning → seen/new → stable),
 * but operates on SentenceItem[] rather than LearningItem[]. v0.8.0 typically calls this with
 * an empty `progress` map — every sentence lands in the "new exposure" bucket and shuffle is
 * uniform.
 */
export function selectSentenceOrderTasks(
  input: SelectSentenceOrderTasksInput,
): SelectedSentenceTaskQueue {
  const random = input.random ?? Math.random;
  const now = Date.now();
  const buckets: SentenceItem[][] = [[], [], [], []];
  for (const sentence of input.sentences) {
    const key = progressKey(sentence.id, input.skillDimension);
    const p = input.progress?.get(key);
    const bucket = bucketFor(p, now);
    buckets[bucket]!.push(sentence);
  }

  const ranked: SentenceItem[] = [];
  for (const b of buckets) {
    const candidates: SentenceItem[] = [];
    for (const s of b) {
      candidates.push(s);
      if (input.preferTags && input.preferTags.some((t) => s.tags.includes(t))) {
        candidates.push(s); // duplicate to bias selection
      }
    }
    fisherYates(candidates, random);
    ranked.push(...candidates);
  }

  if (ranked.length === 0) {
    return makeQueue([]);
  }

  const tasks: TrainingTask[] = [];
  for (let i = 0; tasks.length < input.count; i++) {
    const sentence = ranked[i % ranked.length]!;
    tasks.push(buildSentenceTask(sentence, input));
  }
  return makeQueue(tasks);
}

function bucketFor(progress: SkillProgress | undefined, now: number): 0 | 1 | 2 | 3 {
  if (!progress) return 2;
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

function buildSentenceTask(
  sentence: SentenceItem,
  input: SelectSentenceOrderTasksInput,
): TrainingTask {
  const canonicalOrder = sentence.chunks.map((c) => c.id);
  const task: TrainingTask = {
    id: makeTaskId(),
    sessionId: input.sessionId,
    itemId: sentence.id,
    gameType: input.gameType,
    answerMode: 'sentence_chunk_order',
    skillDimension: input.skillDimension,
    prompt: {
      kind: 'sentence_gap',
      sentenceJa: sentence.surface,
      sentenceZh: sentence.zhPrompt,
      meaningZh: sentence.zhPrompt,
    },
    expected: {
      surface: sentence.surface,
      chunkOrder: canonicalOrder,
      chunks: sentence.chunks,
      ...(sentence.acceptedOrders.length > 0 && {
        acceptedChunkOrders: sentence.acceptedOrders,
      }),
    },
    difficulty: 0.5,
    allowHints: false,
    strictness: input.strictness,
    createdAt: new Date().toISOString(),
  };
  if (input.timeLimitMs !== undefined) {
    task.timeLimitMs = input.timeLimitMs;
  }
  return task;
}

function makeQueue(initial: TrainingTask[]): SelectedSentenceTaskQueue {
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
