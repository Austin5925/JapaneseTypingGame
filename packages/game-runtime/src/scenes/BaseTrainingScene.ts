import type { EvaluationResult, TrainingTask, UserAttempt } from '@kana-typing/core';
import Phaser from 'phaser';

import { createNoopSfx, type Sfx } from '../audio/sfx';
import type { GameBridge } from '../bridge/GameBridge';
import type { SessionFinishReason } from '../bridge/gameEvents';
import { createComboBus, type ComboBus, type ComboEvent } from '../feedback/comboBus';

export interface BaseSceneInit {
  bridge: GameBridge;
  sessionId: string;
  /** Optional clock for test injection; defaults to Date.now. */
  now?: () => number;
  /**
   * Combo bus instance shared across the session. If omitted, a fresh `createComboBus()` is
   * minted per scene init (which also resets the streak — appropriate for fresh sessions).
   * Tests pass a controllable instance; multi-scene sessions (Boss round, v0.8.6) will pass
   * a shared bus so the streak survives scene swaps.
   */
  combo?: ComboBus;
  /**
   * Sfx engine. Defaults to `createNoopSfx()` so production scenes that haven't opted in stay
   * silent and tests don't need to stub Web Audio. Production callers (the React layer) pass
   * `createBrowserSfx()`.
   */
  sfx?: Sfx;
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
  protected combo!: ComboBus;
  protected sfx!: Sfx;
  private busy = false;
  private finished = false;

  init(params: BaseSceneInit): void {
    this.bridge = params.bridge;
    this.sessionId = params.sessionId;
    if (params.now) this.now = params.now;
    this.combo = params.combo ?? createComboBus();
    this.sfx = params.sfx ?? createNoopSfx();
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
      try {
        this.showFeedback(result);
      } catch (err) {
        this.reportNonCriticalFeedbackError('showFeedback', err);
      }
      this.bridge.emit({ type: 'attempt.evaluated', result });
      this.bridge.emit({ type: 'feedback.shown', result });
      try {
        this.notifyCombo(result);
      } catch (err) {
        this.reportNonCriticalFeedbackError('notifyCombo', err);
      }
      return result;
    } finally {
      this.busy = false;
    }
  }

  private reportNonCriticalFeedbackError(source: string, err: unknown): void {
    const error = err instanceof Error ? err : new Error(String(err));
    console.warn(`[${this.scene.key}] ${source} failed`, err);
    this.bridge.emit({
      type: 'scene.error',
      error: {
        message: `${source} failed: ${error.message}`,
        ...(error.stack !== undefined && { stack: error.stack }),
      },
    });
  }

  /**
   * Centralised post-evaluation reaction: feed the combo bus, fire the matching sfx, and
   * surface the result on the bridge so the React HUD (or a sibling scene in a Boss round)
   * can react. Subclasses may override `showComboBubble` for in-canvas combo visuals.
   */
  private notifyCombo(result: EvaluationResult): void {
    const event: ComboEvent = this.combo.record(result.isCorrect, this.now());
    if (event.type === 'increment') {
      this.sfx.play('correct');
      if (event.surge) {
        this.sfx.play('combo', { level: event.level });
        this.showComboBubble(event.count, event.level);
      }
    } else {
      this.sfx.play('wrong');
    }
    this.bridge.emit({
      type: 'combo.changed',
      count: this.combo.state.count,
      peak: this.combo.state.peak,
      level: event.type === 'increment' ? event.level : Math.floor(this.combo.state.count / 5),
      surge: event.type === 'increment' && event.surge,
    });
  }

  /**
   * Default in-canvas combo bubble. Subclasses can override for game-specific styling, but the
   * base implementation gives every scene a visible "COMBO ×N" tween for free. We keep it
   * tween-only so headless tests don't choke on missing render contexts (the tween becomes a
   * no-op when `this.tweens` is unavailable).
   */
  protected showComboBubble(count: number, _level: number): void {
    if (!this.add || !this.tweens) return;
    const cam = this.cameras?.main;
    const cx = cam ? cam.width / 2 : 400;
    const cy = cam ? cam.height * 0.35 : 160;
    const text = this.add.text(cx, cy, `COMBO ×${String(count)}`, {
      fontSize: '36px',
      color: '#ffd866',
      fontFamily: 'sans-serif',
      stroke: '#0e0f12',
      strokeThickness: 4,
    });
    text.setOrigin(0.5, 0.5);
    text.setDepth(1000);
    this.tweens.add({
      targets: text,
      alpha: { from: 1, to: 0 },
      y: cy - 40,
      duration: 800,
      ease: 'Cubic.easeOut',
      onComplete: () => text.destroy(),
    });
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
