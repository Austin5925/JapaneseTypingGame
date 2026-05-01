import {
  evaluate,
  updateProgress,
  type EvaluationResult,
  type SkillProgress,
  type TrainingTask,
  type UserAttempt,
} from '@kana-typing/core';

import {
  createSession as rpcCreateSession,
  finishSession as rpcFinishSession,
  getProgress as rpcGetProgress,
  recordAttemptResult as rpcRecordAttemptResult,
  type ProgressDto,
  type SessionRecord,
} from '../../tauri/invoke';

export interface GameSessionServiceOptions {
  /** Buffer attempts in memory and flush them in a single batch. Default true. */
  bufferAttempts?: boolean;
  /** Default 'default-user' until accounts arrive. */
  userId?: string;
}

interface PendingAttempt {
  task: TrainingTask;
  attempt: UserAttempt;
  evaluation: EvaluationResult;
  newProgress: SkillProgress;
}

/**
 * Owns one game session end-to-end: open it, accept attempts, evaluate them in-process,
 * persist (attempt event + updated progress) on flush, then close. Pure orchestration —
 * judging logic lives in @kana-typing/core; SQLite I/O lives in Rust commands.
 *
 * Sprint 2 keeps this single-session: callers `await create()` once per game, then `await
 * submitAttempt(...)` per task, then `await finish()`. The buffer flushes on every submit by
 * default; setting bufferAttempts=true keeps writes in-memory until finish() (used by Sprint
 * 3 game scenes that don't want DB chatter at 60fps).
 */
export class GameSessionService {
  private session: SessionRecord | null = null;
  private buffer: PendingAttempt[] = [];
  private finished = false;
  private finishing = false;
  /** In-flight submitAttempt promises. finish() awaits these so cleanup can't race. */
  private readonly inflight = new Set<Promise<unknown>>();
  private readonly userId: string;
  private readonly buffered: boolean;

  constructor(options: GameSessionServiceOptions = {}) {
    this.userId = options.userId ?? 'default-user';
    this.buffered = options.bufferAttempts ?? false;
  }

  /** Create and persist a fresh session. */
  async create(input: {
    gameType: TrainingTask['gameType'];
    targetDurationMs?: number;
  }): Promise<SessionRecord> {
    if (this.session) throw new Error('GameSessionService.create called twice on same instance');
    const id = generateId('sess');
    this.session = await rpcCreateSession({
      id,
      userId: this.userId,
      gameType: input.gameType,
      ...(input.targetDurationMs !== undefined && { targetDurationMs: input.targetDurationMs }),
    });
    return this.session;
  }

  get sessionId(): string {
    if (!this.session) throw new Error('session not yet created');
    return this.session.id;
  }

  /**
   * Evaluate an attempt, update progress, and persist (immediately or on flush). Returns the
   * computed EvaluationResult so the UI can react instantly.
   */
  async submitAttempt(task: TrainingTask, attempt: UserAttempt): Promise<EvaluationResult> {
    if (!this.session) throw new Error('session not yet created');
    if (this.finishing || this.finished) throw new Error('session already finishing/finished');

    const work = this.runSubmit(task, attempt);
    this.inflight.add(work);
    try {
      return await work;
    } finally {
      this.inflight.delete(work);
    }
  }

  private async runSubmit(task: TrainingTask, attempt: UserAttempt): Promise<EvaluationResult> {
    const evaluation = evaluate(task, attempt);
    const old = await this.fetchProgress(task.itemId, task.skillDimension);
    const newProgress = updateProgress(toDomainProgress(old), evaluation, { userId: this.userId });

    this.buffer.push({ task, attempt, evaluation, newProgress });
    if (!this.buffered) {
      await this.flush();
    }
    return evaluation;
  }

  /**
   * Persist any buffered attempts to SQLite. Each (attempt, progress) pair is written in a
   * single Rust-side transaction (see record_attempt_result) so a partial failure can't leave
   * the event log out of sync with progress. On error, the failed entry is restored to the
   * head of the buffer for the caller to retry.
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const pending = this.buffer.splice(0, this.buffer.length);
    for (let i = 0; i < pending.length; i++) {
      const p = pending[i]!;
      try {
        await rpcRecordAttemptResult({
          attempt: {
            id: p.attempt.id,
            sessionId: p.attempt.sessionId,
            userId: this.userId,
            taskId: p.attempt.taskId,
            itemId: p.attempt.itemId,
            gameType: p.attempt.gameType,
            skillDimension: p.task.skillDimension,
            answerMode: p.task.answerMode,
            ...(p.attempt.rawInput !== undefined && { rawInput: p.attempt.rawInput }),
            ...(p.attempt.committedInput !== undefined && {
              committedInput: p.attempt.committedInput,
            }),
            ...(p.attempt.selectedOptionId !== undefined && {
              selectedOptionId: p.attempt.selectedOptionId,
            }),
            ...(p.attempt.chunkOrder !== undefined && { chunkOrder: p.attempt.chunkOrder }),
            isCorrect: p.evaluation.isCorrect,
            score: p.evaluation.score,
            reactionTimeMs: p.evaluation.reactionTimeMs,
            usedHint: p.attempt.usedHint,
            errorTags: p.evaluation.errorTags,
            ...(p.evaluation.explanation !== undefined && {
              explanation: p.evaluation.explanation,
            }),
          },
          progress: toProgressDto(p.newProgress),
        });
      } catch (err) {
        // Restore the unprocessed remainder so the caller can retry; preserve order.
        const remaining = pending.slice(i);
        this.buffer.unshift(...remaining);
        throw err;
      }
    }
  }

  async finish(status: 'finished' | 'aborted' | 'timeout' = 'finished'): Promise<void> {
    if (!this.session) throw new Error('session not yet created');
    // Idempotent: finish() can be called both by the React layer's session timer
    // and by the Phaser scene's auto-finish-when-queue-empty path. The first
    // caller wins; later calls (including concurrent ones still mid-await) are
    // no-ops so callers can fire-and-forget without try/catch boilerplate.
    if (this.finished || this.finishing) return;
    this.finishing = true;
    try {
      // Drain any submitAttempt calls that already passed the entry guard before this
      // finish() locked the door. allSettled because we still want to record the session
      // close even if one of the in-flight writes fails — the immutable attempt log is the
      // safety net.
      if (this.inflight.size > 0) {
        await Promise.allSettled([...this.inflight]);
      }
      await this.flush();
      await rpcFinishSession({ sessionId: this.session.id, status });
      this.finished = true;
    } finally {
      this.finishing = false;
    }
  }

  private async fetchProgress(
    itemId: string,
    skill: TrainingTask['skillDimension'],
  ): Promise<ProgressDto | null> {
    return rpcGetProgress({ userId: this.userId, itemId, skillDimension: skill });
  }
}

// ─── helpers (DTO ↔ domain) ──────────────────────────────────────────────

export function toDomainProgress(dto: ProgressDto | null): SkillProgress | null {
  if (!dto) return null;
  return {
    userId: dto.userId,
    itemId: dto.itemId,
    skillDimension: dto.skillDimension,
    state: dto.state as SkillProgress['state'],
    masteryScore: dto.masteryScore,
    stability: dto.stability,
    difficulty: dto.difficulty,
    exposureCount: dto.exposureCount,
    correctCount: dto.correctCount,
    wrongCount: dto.wrongCount,
    streak: dto.streak,
    lapseCount: dto.lapseCount,
    ...(dto.averageReactionTimeMs !== null && { averageReactionTimeMs: dto.averageReactionTimeMs }),
    ...(dto.lastAttemptAt !== null && { lastAttemptAt: dto.lastAttemptAt }),
    ...(dto.nextDueAt !== null && { nextDueAt: dto.nextDueAt }),
    lastErrorTags: dto.lastErrorTags as SkillProgress['lastErrorTags'],
    updatedAt: dto.updatedAt,
  };
}

export function toProgressDto(progress: SkillProgress): ProgressDto {
  return {
    userId: progress.userId,
    itemId: progress.itemId,
    skillDimension: progress.skillDimension,
    state: progress.state,
    masteryScore: progress.masteryScore,
    stability: progress.stability,
    difficulty: progress.difficulty,
    exposureCount: progress.exposureCount,
    correctCount: progress.correctCount,
    wrongCount: progress.wrongCount,
    streak: progress.streak,
    lapseCount: progress.lapseCount,
    averageReactionTimeMs: progress.averageReactionTimeMs ?? null,
    lastAttemptAt: progress.lastAttemptAt ?? null,
    nextDueAt: progress.nextDueAt ?? null,
    lastErrorTags: progress.lastErrorTags,
    updatedAt: progress.updatedAt,
  };
}

export function generateId(prefix: string): string {
  // crypto.randomUUID is available in Tauri WebView (modern WKWebView/Edge WebView2). The
  // prefix lets us tell session/attempt/task IDs apart at a glance in DB queries.
  const uuid =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${uuid}`;
}
