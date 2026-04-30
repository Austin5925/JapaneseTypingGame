import type { EvaluationResult, TrainingTask, UserAttempt } from '@kana-typing/core';
import Phaser from 'phaser';

import type { GameBridge } from '../bridge/GameBridge';
import type { SessionFinishReason } from '../bridge/gameEvents';

export interface BaseSceneInit {
  bridge: GameBridge;
  sessionId: string;
  /** Optional clock for test injection; defaults to Date.now. */
  now?: () => number;
}

/**
 * Common Phaser scene scaffold. Owns the bridge handshake and the task pump. Subclasses
 * implement the per-game UI and input handling, then call `submitAttemptAndAdvance` when the
 * user commits an answer.
 *
 * Lifecycle:
 *   init({bridge, sessionId})  ← Phaser sends our params here
 *   create()                   → loadNextTask
 *   <game-specific render>     ← spawnTask(task) renders the prompt
 *   submitAttemptAndAdvance(attempt)  ← user committed
 *   ↳ bridge.submitAttempt → showFeedback → loadNextTask
 *   loadNextTask returns null → finishSession('completed')
 */
export abstract class BaseTrainingScene<TTask extends TrainingTask = TrainingTask>
  extends Phaser.Scene
{
  protected bridge!: GameBridge;
  protected sessionId!: string;
  protected currentTask: TTask | null = null;
  protected now: () => number = () => Date.now();
  private busy = false;
  private finished = false;

  init(params: BaseSceneInit): void {
    this.bridge = params.bridge;
    this.sessionId = params.sessionId;
    if (params.now) this.now = params.now;
  }

  async create(): Promise<void> {
    this.createBackground();
    this.createHudLayer();
    this.bridge.emit({ type: 'scene.ready', sceneId: this.scene.key });
    await this.loadNextTask();
  }

  protected async loadNextTask(): Promise<void> {
    if (this.finished) return;
    const task = await this.bridge.requestNextTask();
    if (!task) {
      await this.finishSession('completed');
      return;
    }
    this.currentTask = task as TTask;
    this.spawnTask(this.currentTask);
    this.bridge.emit({ type: 'task.spawned', task });
  }

  protected async submitAttemptAndAdvance(attempt: UserAttempt): Promise<EvaluationResult> {
    if (this.busy) throw new Error('attempt already in flight');
    this.busy = true;
    try {
      this.bridge.emit({ type: 'attempt.submitted', attempt });
      const result = await this.bridge.submitAttempt(attempt);
      this.showFeedback(result);
      this.bridge.emit({ type: 'attempt.evaluated', result });
      this.bridge.emit({ type: 'feedback.shown', result });
      return result;
    } finally {
      this.busy = false;
    }
  }

  /** End the session early (timeout / user quit / completed when queue exhausted). */
  protected async finishSession(reason: SessionFinishReason): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    try {
      await this.bridge.finishSession(reason);
    } catch (err) {
      this.bridge.emit({
        type: 'scene.error',
        error: {
          message: (err as Error).message,
          ...((err as Error).stack !== undefined && { stack: (err as Error).stack as string }),
        },
      });
    }
    this.bridge.emit({ type: 'session.finished', reason });
  }

  // ─── subclass hooks ─────────────────────────────────────────────────

  /** Draw any static background. Called once during `create`. */
  protected abstract createBackground(): void;

  /** Render in-scene HUD if any (timer, score). React HUD is rendered separately by Host. */
  protected abstract createHudLayer(): void;

  /** Render the task prompt and input target for the user. */
  protected abstract spawnTask(task: TTask): void;

  /** Visualise the evaluation feedback. */
  protected abstract showFeedback(result: EvaluationResult): void;
}
