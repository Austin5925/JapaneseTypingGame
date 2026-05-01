import type {
  EvaluationStrictness,
  LearningItem,
  SkillProgress,
  TrainingOption,
  TrainingTask,
} from '../types/domain';
import type { ErrorTag, GameType, SkillDimension } from '../types/enums';

/**
 * Prompt strategy for ChoiceTrainingTasks. v0.8.1 only ships `meaning_zh` (the user reads the
 * Chinese meaning and picks the matching Japanese surface). `reading` (kana → surface) and
 * `example_sentence` (gap-fill in JA sentence) are stubs that fall back to meaning_zh until
 * scene support lands.
 */
export type ChoicePromptKind = 'meaning_zh' | 'reading' | 'example_sentence';

export interface SelectChoiceTasksInput {
  /** Eligible items in the user's enabled content packs. */
  items: LearningItem[];
  progress?: Map<string, SkillProgress>;
  count: number;
  sessionId: string;
  gameType: GameType;
  skillDimension: SkillDimension;
  strictness: EvaluationStrictness;
  promptKind?: ChoicePromptKind;
  /** How many distractor options to generate per task. Total options = 1 + distractorCount. */
  distractorCount?: number;
  /** Optional bias towards items whose tags include any of these (e.g. ['confusable']). */
  preferTags?: string[];
  /** Per-task time limit in ms. SpaceBattle's MVP uses 8000ms. */
  timeLimitMs?: number;
  /** Default error tag the wrong distractors carry when their item lacks an explicit one. */
  defaultErrorTag?: ErrorTag;
  /** RNG injection for tests. Defaults to Math.random. */
  random?: () => number;
}

export interface SelectedChoiceTaskQueue {
  next(): TrainingTask | null;
  remaining(): number;
  pushFront(task: TrainingTask): void;
}

/**
 * Build a fixed-length task queue for a single space-battle session.
 *
 * Ranking buckets mirror `selectKanaTasks`: overdue → fragile/learning → seen/new → stable;
 * within each bucket, items whose tags match `preferTags` are duplicated to bias selection.
 *
 * Distractors come from the correct item's `confusableItemIds` first (this is what makes the
 * task an actual *辨析*, not a random multiple-choice). If the confusable list is short, we
 * top up from the rest of the pool, biased away from items that are obviously off-topic
 * (different jlpt level / no shared tag).
 */
export function selectChoiceTasks(input: SelectChoiceTasksInput): SelectedChoiceTaskQueue {
  const random = input.random ?? Math.random;
  const distractorCount = Math.max(1, input.distractorCount ?? 3);
  const promptKind = input.promptKind ?? 'meaning_zh';
  const defaultErrorTag = input.defaultErrorTag ?? 'meaning_confusion';

  // We need the full item index later to look up confusables / fill distractors.
  const itemIndex = new Map(input.items.map((item) => [item.id, item]));
  const eligibleItems = input.items.filter(
    (item) =>
      isEligibleForChoiceMode(item) && hasViableDistractors(item, itemIndex, distractorCount),
  );

  if (eligibleItems.length === 0) {
    return makeQueue([]);
  }

  const buckets: LearningItem[][] = [[], [], [], []];
  const now = Date.now();
  for (const item of eligibleItems) {
    const key = progressKey(item.id, input.skillDimension);
    const p = input.progress?.get(key);
    const bucket = bucketFor(p, now);
    buckets[bucket]!.push(item);
  }

  const ranked: LearningItem[] = [];
  for (const b of buckets) {
    const candidates: LearningItem[] = [];
    for (const item of b) {
      candidates.push(item);
      if (input.preferTags && input.preferTags.some((t) => item.tags.includes(t))) {
        candidates.push(item);
      }
    }
    fisherYates(candidates, random);
    ranked.push(...candidates);
  }

  const tasks: TrainingTask[] = [];
  for (let i = 0; tasks.length < input.count; i++) {
    const item = ranked[i % ranked.length]!;
    tasks.push(
      buildChoiceTask({
        correct: item,
        itemIndex,
        distractorCount,
        defaultErrorTag,
        promptKind,
        input,
        random,
      }),
    );
  }
  return makeQueue(tasks);
}

function isEligibleForChoiceMode(item: LearningItem): boolean {
  // ChoiceTask needs a Chinese meaning to render the prompt + a surface to render the option.
  return item.meaningsZh.length > 0 && item.surface.length > 0;
}

function hasViableDistractors(
  correct: LearningItem,
  itemIndex: Map<string, LearningItem>,
  distractorCount: number,
): boolean {
  // We accept an item as eligible if either:
  //   - it has explicit confusableItemIds that resolve, or
  //   - the global pool has enough other choice-eligible items to act as fallback distractors.
  const explicit = correct.confusableItemIds.filter((id) => itemIndex.has(id) && id !== correct.id);
  if (explicit.length >= distractorCount) return true;
  let poolSize = 0;
  for (const item of itemIndex.values()) {
    if (item.id === correct.id) continue;
    if (!isEligibleForChoiceMode(item)) continue;
    poolSize++;
    if (poolSize >= distractorCount) return true;
  }
  return false;
}

function bucketFor(progress: SkillProgress | undefined, now: number): 0 | 1 | 2 | 3 {
  if (!progress) return 2;
  if (progress.nextDueAt && Date.parse(progress.nextDueAt) <= now) return 0;
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

interface BuildChoiceTaskInput {
  correct: LearningItem;
  itemIndex: Map<string, LearningItem>;
  distractorCount: number;
  defaultErrorTag: ErrorTag;
  promptKind: ChoicePromptKind;
  input: SelectChoiceTasksInput;
  random: () => number;
}

function buildChoiceTask(args: BuildChoiceTaskInput): TrainingTask {
  const { correct, itemIndex, distractorCount, defaultErrorTag, promptKind, input, random } = args;
  const distractors = pickDistractors(correct, itemIndex, distractorCount, random);

  const correctOption: TrainingOption = {
    id: optionIdFor(correct.id),
    label: correct.surface,
    kana: correct.kana,
    meaningZh: correct.meaningsZh[0] ?? '',
    itemId: correct.id,
    isCorrect: true,
  };
  const distractorOptions: TrainingOption[] = distractors.map((d) => {
    const tag = d.errorTags?.[0] ?? defaultErrorTag;
    return {
      id: optionIdFor(d.id),
      label: d.surface,
      kana: d.kana,
      meaningZh: d.meaningsZh[0] ?? '',
      itemId: d.id,
      isCorrect: false,
      errorTagIfChosen: tag,
    };
  });
  const options: TrainingOption[] = shuffleOptions([correctOption, ...distractorOptions], random);

  const task: TrainingTask = {
    id: makeTaskId(),
    sessionId: input.sessionId,
    itemId: correct.id,
    gameType: input.gameType,
    answerMode: 'option_select',
    skillDimension: input.skillDimension,
    prompt: buildPrompt(correct, promptKind),
    expected: { optionId: correctOption.id, surface: correct.surface, kana: correct.kana },
    options,
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

function buildPrompt(item: LearningItem, kind: ChoicePromptKind): TrainingTask['prompt'] {
  switch (kind) {
    case 'reading':
      return { kind: 'text', text: item.kana };
    case 'example_sentence': {
      const ex = item.examples[0];
      if (ex) {
        return {
          kind: 'sentence_gap',
          sentenceJa: ex.ja,
          sentenceZh: ex.zh,
          meaningZh: item.meaningsZh[0] ?? '',
        };
      }
      return { kind: 'meaning', meaningZh: item.meaningsZh[0] ?? '' };
    }
    case 'meaning_zh':
    default:
      return { kind: 'meaning', meaningZh: item.meaningsZh[0] ?? '' };
  }
}

function pickDistractors(
  correct: LearningItem,
  itemIndex: Map<string, LearningItem>,
  distractorCount: number,
  random: () => number,
): LearningItem[] {
  const seen = new Set<string>([correct.id]);
  const out: LearningItem[] = [];

  // 1. From confusableItemIds (in order — pack author's intent matters).
  for (const id of correct.confusableItemIds) {
    if (out.length >= distractorCount) break;
    if (seen.has(id)) continue;
    const item = itemIndex.get(id);
    if (!item) continue;
    if (!isEligibleForChoiceMode(item)) continue;
    out.push(item);
    seen.add(item.id);
  }

  if (out.length >= distractorCount) return out;

  // 2. Fill remaining slots from the global pool, shuffled. Prefer items sharing a tag with
  // `correct` (mild topical coherence) but fall back to anything eligible if that's exhausted.
  const eligibleOthers: LearningItem[] = [];
  const eligibleTagged: LearningItem[] = [];
  const correctTagSet = new Set(correct.tags);
  for (const item of itemIndex.values()) {
    if (seen.has(item.id)) continue;
    if (!isEligibleForChoiceMode(item)) continue;
    if (item.tags.some((t) => correctTagSet.has(t))) {
      eligibleTagged.push(item);
    } else {
      eligibleOthers.push(item);
    }
  }
  fisherYates(eligibleTagged, random);
  fisherYates(eligibleOthers, random);
  for (const item of [...eligibleTagged, ...eligibleOthers]) {
    if (out.length >= distractorCount) break;
    out.push(item);
    seen.add(item.id);
  }
  return out;
}

function shuffleOptions(options: TrainingOption[], random: () => number): TrainingOption[] {
  const copy = [...options];
  fisherYates(copy, random);
  return copy;
}

function optionIdFor(itemId: string): string {
  return `opt_${itemId}`;
}

function makeQueue(initial: TrainingTask[]): SelectedChoiceTaskQueue {
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
