import type { EvaluationResult, TrainingTask, UserAttempt } from '@kana-typing/core';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- Phaser.Scene is used both as a runtime base class (extends) and for nested namespace types.
import Phaser from 'phaser';

import type { BaseSceneInit } from './BaseTrainingScene';
import { BaseTrainingScene } from './BaseTrainingScene';

export const MOLE_SCENE_KEY = 'MoleScene';

export interface MoleSceneInit extends BaseSceneInit {
  /** Game width/height; defaults to current canvas size. */
  width?: number;
  height?: number;
}

/**
 * Whack-a-mole training scene.
 *
 * Each task displays a single kana on a "mole" pillar. The user types the romaji to whack it.
 * - Correct input → flash green, despawn, advance.
 * - Wrong input → flash red, brief pause, then advance (no game over).
 * - Timeout → flash yellow, log a `timeout` attempt, advance.
 *
 * Sprint 3 keeps the visuals deliberately minimal (rectangles + text) — Phaser sprites and
 * audio cues land in Sprint 4+. This scene is what proves the bridge architecture works
 * end-to-end; polish ships later.
 */
export class MoleScene extends BaseTrainingScene<TrainingTask> {
  private widthPx = 800;
  private heightPx = 480;
  private moleContainer: Phaser.GameObjects.Container | null = null;
  private kanaText: Phaser.GameObjects.Text | null = null;
  private inputBufferText: Phaser.GameObjects.Text | null = null;
  private feedbackText: Phaser.GameObjects.Text | null = null;
  private timerText: Phaser.GameObjects.Text | null = null;
  private inputBuffer = '';
  private taskStartedAt = 0;
  private timeLimitMs = 6000;
  private taskTimer: Phaser.Time.TimerEvent | null = null;

  constructor() {
    super(MOLE_SCENE_KEY);
  }

  override init(params: MoleSceneInit): void {
    super.init(params);
    if (params.width) this.widthPx = params.width;
    if (params.height) this.heightPx = params.height;
  }

  protected createBackground(): void {
    const g = this.add.graphics();
    g.fillStyle(0x0e0f12, 1);
    g.fillRect(0, 0, this.widthPx, this.heightPx);
    // Ground line
    g.fillStyle(0x232733, 1);
    g.fillRect(0, this.heightPx * 0.7, this.widthPx, 4);
  }

  protected createHudLayer(): void {
    this.timerText = this.add.text(this.widthPx - 16, 16, '', {
      fontSize: '20px',
      color: '#94a0b3',
      fontFamily: 'monospace',
    });
    this.timerText.setOrigin(1, 0);
    this.feedbackText = this.add.text(this.widthPx / 2, this.heightPx - 32, '', {
      fontSize: '18px',
      color: '#94a0b3',
      fontFamily: 'sans-serif',
    });
    this.feedbackText.setOrigin(0.5, 1);
    this.inputBufferText = this.add.text(this.widthPx / 2, this.heightPx - 70, '', {
      fontSize: '24px',
      color: '#6cb9ff',
      fontFamily: 'monospace',
    });
    this.inputBufferText.setOrigin(0.5, 1);

    if (this.input.keyboard) {
      this.input.keyboard.on('keydown', (event: KeyboardEvent) => {
        this.onKeyDown(event);
      });
    }
  }

  override update(): void {
    if (this.timerText && this.currentTask) {
      const elapsed = this.now() - this.taskStartedAt;
      const remaining = Math.max(0, this.timeLimitMs - elapsed);
      this.timerText.setText(`${(remaining / 1000).toFixed(1)}s`);
    }
  }

  protected spawnTask(task: TrainingTask): void {
    this.clearMole();
    const kana = task.expected.kana ?? task.expected.surface ?? '?';
    this.timeLimitMs = task.timeLimitMs ?? 6000;
    this.taskStartedAt = this.now();
    this.inputBuffer = '';
    this.refreshInputBufferText();

    // Mole pillar geometry: a simple rectangle pop-up. We center horizontally and place above
    // the ground line, with the kana text as the head.
    const cx = this.widthPx / 2;
    const cy = this.heightPx * 0.55;
    const pillarW = 110;
    const pillarH = 140;

    this.moleContainer = this.add.container(cx, cy);
    const body = this.add.graphics();
    body.fillStyle(0x6cb9ff, 1);
    body.fillRoundedRect(-pillarW / 2, -pillarH / 2, pillarW, pillarH, 16);
    this.moleContainer.add(body);
    this.kanaText = this.add.text(0, 0, kana, {
      fontSize: '64px',
      color: '#0e0f12',
      fontFamily: 'sans-serif',
    });
    this.kanaText.setOrigin(0.5, 0.5);
    this.moleContainer.add(this.kanaText);

    // Time-out timer
    if (this.taskTimer) {
      this.taskTimer.remove(false);
    }
    this.taskTimer = this.time.delayedCall(this.timeLimitMs, () => void this.onTimeout());

    if (this.feedbackText) {
      this.feedbackText.setText('type the romaji + Enter');
      this.feedbackText.setColor('#94a0b3');
    }
  }

  private clearMole(): void {
    if (this.taskTimer) {
      this.taskTimer.remove(false);
      this.taskTimer = null;
    }
    if (this.moleContainer) {
      this.moleContainer.destroy();
      this.moleContainer = null;
    }
    this.kanaText = null;
  }

  private refreshInputBufferText(): void {
    this.inputBufferText?.setText(this.inputBuffer.length > 0 ? this.inputBuffer : '_');
  }

  protected showFeedback(result: EvaluationResult): void {
    if (!this.feedbackText) return;
    if (result.isCorrect) {
      this.feedbackText.setText(`✓ ${result.expectedDisplay}`);
      this.feedbackText.setColor('#4ade80');
    } else {
      const tagSummary = result.errorTags.length > 0 ? ` (${result.errorTags.join(', ')})` : '';
      this.feedbackText.setText(`✗ expected ${result.expectedDisplay}${tagSummary}`);
      this.feedbackText.setColor('#f87171');
    }
  }

  // ─── input ─────────────────────────────────────────────────────────

  private onKeyDown(event: KeyboardEvent): void {
    if (!this.currentTask) return;
    if (event.key === 'Enter') {
      void this.commitInput();
      return;
    }
    if (event.key === 'Backspace') {
      this.inputBuffer = this.inputBuffer.slice(0, -1);
      this.refreshInputBufferText();
      return;
    }
    if (event.key.length === 1 && /[a-zA-Z'-]/.test(event.key)) {
      this.inputBuffer += event.key.toLowerCase();
      this.refreshInputBufferText();
    }
  }

  private async commitInput(): Promise<void> {
    if (!this.currentTask) return;
    const task = this.currentTask;
    const value = this.inputBuffer;
    if (!value) return;
    const reactionTimeMs = Math.max(300, this.now() - this.taskStartedAt);
    const attempt: UserAttempt = {
      id: generateId('att'),
      sessionId: this.sessionId,
      taskId: task.id,
      itemId: task.itemId,
      gameType: task.gameType,
      rawInput: value,
      committedInput: value,
      startedAt: new Date(this.taskStartedAt).toISOString(),
      submittedAt: new Date(this.now()).toISOString(),
      reactionTimeMs,
      usedHint: false,
      inputMethod: task.answerMode === 'romaji_to_kana' ? 'romaji' : 'keyboard_select',
    };
    this.inputBuffer = '';
    this.refreshInputBufferText();
    await this.submitAttemptAndAdvance(attempt);
    // Pause briefly so the user can read feedback, then advance.
    await new Promise<void>((resolve) => {
      this.time.delayedCall(800, resolve);
    });
    await this.loadNextTask();
  }

  private async onTimeout(): Promise<void> {
    if (!this.currentTask) return;
    const task = this.currentTask;
    const attempt: UserAttempt = {
      id: generateId('att'),
      sessionId: this.sessionId,
      taskId: task.id,
      itemId: task.itemId,
      gameType: task.gameType,
      rawInput: '',
      committedInput: '',
      startedAt: new Date(this.taskStartedAt).toISOString(),
      submittedAt: new Date(this.now()).toISOString(),
      reactionTimeMs: this.timeLimitMs,
      usedHint: false,
      inputMethod: task.answerMode === 'romaji_to_kana' ? 'romaji' : 'keyboard_select',
    };
    await this.submitAttemptAndAdvance(attempt);
    await new Promise<void>((resolve) => {
      this.time.delayedCall(1200, resolve);
    });
    await this.loadNextTask();
  }
}

function generateId(prefix: string): string {
  const uuid =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${uuid}`;
}
