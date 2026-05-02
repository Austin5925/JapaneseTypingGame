import type { EvaluationResult, TrainingTask, UserAttempt } from '@kana-typing/core';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- Phaser.Scene used as a runtime base + a namespace.
import Phaser from 'phaser';

import type { ExternalInputEvent } from '../bridge/gameEvents';

import type { BaseSceneInit } from './BaseTrainingScene';
import { BaseTrainingScene } from './BaseTrainingScene';
import { getSpeedChaseDifficulty } from './speedChaseDifficulty';

export const SPEED_CHASE_SCENE_KEY = 'SpeedChaseScene';

/**
 * Where SpeedChaseScene reads user input from.
 *
 * - `phaser_keys` — the original path: Phaser's keyboard plugin captures window-level keystrokes
 *   and we accumulate ASCII into `inputBuffer`. Romaji-only.
 * - `external` — the React layer owns input (typically `<ImeInputBox>` running an OS IME) and
 *   pushes finalised values via `bridge.emitExternalInput`. Lets us train with a real Japanese
 *   IME because Phaser's canvas no longer steals focus.
 */
export type SpeedChaseInputSource = 'phaser_keys' | 'external';

export interface SpeedChaseSceneInit extends BaseSceneInit {
  width?: number;
  height?: number;
  /** Defaults to `phaser_keys` for backward compatibility with existing romaji routes. */
  inputSource?: SpeedChaseInputSource;
}

/**
 * Speed-chase training scene. The player avatar runs forward; a pursuer trails behind. Each
 * task displays a kanji prompt; the user types its kana reading + Enter. Correct answers
 * push the player forward (visually), wrong answers let the pursuer close in.
 *
 * The scene runs for the full session duration and the round summary lives on ResultPage.
 * Boss-style win/lose conditions + audio cues land in v0.8+.
 *
 * Input has two modes (see {@link SpeedChaseInputSource}): the original `phaser_keys` ASCII
 * pump for romaji-only training, and an `external` mode where the React layer's
 * `<ImeInputBox>` handles a real OS IME and pushes finalised values through the bridge.
 */
export class SpeedChaseScene extends BaseTrainingScene<TrainingTask> {
  private widthPx = 800;
  private heightPx = 480;
  private promptText: Phaser.GameObjects.Text | null = null;
  private hintText: Phaser.GameObjects.Text | null = null;
  private inputBufferText: Phaser.GameObjects.Text | null = null;
  private feedbackText: Phaser.GameObjects.Text | null = null;
  private timerText: Phaser.GameObjects.Text | null = null;
  private playerSprite: Phaser.GameObjects.Container | null = null;
  private pursuerSprite: Phaser.GameObjects.Container | null = null;
  private playerX = 200;
  private pursuerX = 80;
  private inputBuffer = '';
  private taskStartedAt = 0;
  private sessionStartedAt = 0;
  private timeLimitMs = 7000;
  private taskTimer: Phaser.Time.TimerEvent | null = null;
  private accuracyAttempts = 0;
  private accuracyCorrect = 0;
  private locked = false;
  private inputSource: SpeedChaseInputSource = 'phaser_keys';
  private offExternalInput: (() => void) | null = null;

  constructor() {
    super(SPEED_CHASE_SCENE_KEY);
  }

  override init(params: SpeedChaseSceneInit): void {
    super.init(params);
    if (params.width) this.widthPx = params.width;
    if (params.height) this.heightPx = params.height;
    if (params.inputSource) this.inputSource = params.inputSource;
    this.sessionStartedAt = this.now();
    // Reset between Phaser scene restarts (the instance is reused, class fields don't re-init).
    this.offExternalInput = null;
    this.locked = false;
  }

  protected createBackground(): void {
    const g = this.add.graphics();
    g.fillStyle(0x0e0f12, 1);
    g.fillRect(0, 0, this.widthPx, this.heightPx);
    // Track lane
    g.fillStyle(0x1a1d24, 1);
    g.fillRect(0, this.heightPx * 0.62, this.widthPx, 60);
    g.fillStyle(0x232733, 1);
    g.fillRect(0, this.heightPx * 0.62, this.widthPx, 2);
    g.fillRect(0, this.heightPx * 0.62 + 58, this.widthPx, 2);
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

    // Player + pursuer indicators on the track.
    this.playerSprite = this.add.container(this.playerX, this.heightPx * 0.62 + 30);
    const playerBody = this.add.graphics();
    playerBody.fillStyle(0x4ade80, 1);
    playerBody.fillCircle(0, 0, 16);
    this.playerSprite.add(playerBody);

    this.pursuerSprite = this.add.container(this.pursuerX, this.heightPx * 0.62 + 30);
    const pursuerBody = this.add.graphics();
    pursuerBody.fillStyle(0xf87171, 1);
    pursuerBody.fillCircle(0, 0, 16);
    this.pursuerSprite.add(pursuerBody);

    if (this.inputSource === 'phaser_keys') {
      if (this.input.keyboard) {
        this.input.keyboard.on('keydown', (event: KeyboardEvent) => {
          this.onKeyDown(event);
        });
      }
    } else {
      this.offExternalInput = this.bridge.onExternalInput((event) => {
        this.handleExternalInput(event);
      });
      this.events.once('shutdown', () => {
        this.offExternalInput?.();
        this.offExternalInput = null;
      });
    }
  }

  override update(time: number, delta: number): void {
    if (this.timerText && this.currentTask) {
      const elapsed = this.now() - this.taskStartedAt;
      const remaining = Math.max(0, this.timeLimitMs - elapsed);
      this.timerText.setText(`${(remaining / 1000).toFixed(1)}s`);
    }
    // Pursuer creep based on elapsed session time. Cap delta at 50ms so a backgrounded tab
    // or power-save throttle can't produce a single-frame catch-up that looks like a game-
    // breaking lurch (Phaser's delta is in ms; 60fps ≈ 16.7ms; 50ms ≈ 3 frames).
    if (this.pursuerSprite) {
      const accuracy = this.accuracyAttempts > 0 ? this.accuracyCorrect / this.accuracyAttempts : 1;
      const diff = getSpeedChaseDifficulty(this.now() - this.sessionStartedAt, accuracy);
      const cappedDelta = Math.min(delta, 50);
      this.pursuerX = Math.min(
        this.playerX - 24,
        this.pursuerX + (diff.pursuerSpeedPx * cappedDelta) / 16,
      );
      this.pursuerSprite.setX(this.pursuerX);
    }
    void time;
  }

  protected spawnTask(task: TrainingTask): void {
    this.clearPrompt();
    const promptKanji = task.prompt.text ?? task.expected.surface ?? task.expected.kana ?? '?';
    const accuracy = this.accuracyAttempts > 0 ? this.accuracyCorrect / this.accuracyAttempts : 1;
    const diff = getSpeedChaseDifficulty(this.now() - this.sessionStartedAt, accuracy);
    this.timeLimitMs = task.timeLimitMs ?? diff.timeLimitMs;
    // Keep the adapter's task reference in sync so scoring uses the same dynamic window the
    // scene presented to the user.
    task.timeLimitMs = this.timeLimitMs;
    this.taskStartedAt = this.now();
    this.inputBuffer = '';
    this.refreshInputBufferText();

    this.promptText = this.add.text(this.widthPx / 2, this.heightPx * 0.35, promptKanji, {
      fontSize: '72px',
      color: '#e6e8ec',
      fontFamily: 'sans-serif',
    });
    this.promptText.setOrigin(0.5, 0.5);
    if (task.allowHints && task.expected.kana) {
      this.hintText = this.add.text(
        this.widthPx / 2,
        this.heightPx * 0.35 + 56,
        task.expected.kana,
        {
          fontSize: '20px',
          color: '#94a0b3',
          fontFamily: 'sans-serif',
        },
      );
      this.hintText.setOrigin(0.5, 0);
    }

    if (this.taskTimer) this.taskTimer.remove(false);
    this.taskTimer = this.time.delayedCall(this.timeLimitMs, () => void this.onTimeout());

    if (this.feedbackText) {
      this.feedbackText.setText('type the reading + Enter');
      this.feedbackText.setColor('#94a0b3');
    }
  }

  private clearPrompt(): void {
    if (this.taskTimer) {
      this.taskTimer.remove(false);
      this.taskTimer = null;
    }
    this.promptText?.destroy();
    this.promptText = null;
    this.hintText?.destroy();
    this.hintText = null;
  }

  private refreshInputBufferText(): void {
    this.inputBufferText?.setText(this.inputBuffer.length > 0 ? this.inputBuffer : '_');
  }

  protected showFeedback(result: EvaluationResult): void {
    this.accuracyAttempts++;
    if (result.isCorrect) this.accuracyCorrect++;

    if (!this.feedbackText) return;
    if (result.isCorrect) {
      this.feedbackText.setText(`✓ ${result.expectedDisplay}`);
      this.feedbackText.setColor('#4ade80');
      // Reward visual: nudge player forward so pursuer falls back.
      this.playerX += 18;
      this.playerSprite?.setX(this.playerX);
    } else {
      const tagSummary = result.errorTags.length > 0 ? ` (${result.errorTags.join(', ')})` : '';
      this.feedbackText.setText(`✗ expected ${result.expectedDisplay}${tagSummary}`);
      this.feedbackText.setColor('#f87171');
      // Penalty visual: pursuer jumps closer. v0.8.6 makes the jump cinematic — a tween
      // instead of a setX snap, plus a brief camera shake, so the user feels the threat.
      const accuracy = this.accuracyAttempts > 0 ? this.accuracyCorrect / this.accuracyAttempts : 1;
      const diff = getSpeedChaseDifficulty(this.now() - this.sessionStartedAt, accuracy);
      const fromX = this.pursuerX;
      this.pursuerX = Math.min(this.playerX - 8, this.pursuerX + diff.wrongAnswerSetbackPx);
      if (this.pursuerSprite) {
        this.tweens.add({
          targets: { x: fromX },
          x: this.pursuerX,
          duration: 200,
          ease: 'Cubic.easeOut',
          onUpdate: (tween) => {
            const x = tween.getValue();
            if (typeof x === 'number') this.pursuerSprite?.setX(x);
          },
        });
      }
      this.cameras.main?.shake(160, 0.006);
    }
  }

  // ─── input ─────────────────────────────────────────────────────────

  private onKeyDown(event: KeyboardEvent): void {
    if (!this.currentTask || this.locked) return;
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

  private handleExternalInput(event: ExternalInputEvent): void {
    if (!this.currentTask || this.locked) return;
    if (event.type === 'external.cancel') {
      this.inputBuffer = '';
      this.refreshInputBufferText();
      return;
    }
    // 'external.commit' — accept the IME-finalised value as-is. Empty values are noops so a
    // stray Enter on an empty IME box doesn't burn a task.
    if (event.value.length === 0) return;
    this.inputBuffer = event.value;
    this.refreshInputBufferText();
    void this.commitInput();
  }

  private async commitInput(): Promise<void> {
    if (!this.currentTask || this.locked) return;
    const task = this.currentTask;
    const value = this.inputBuffer;
    if (!value) return;
    this.locked = true;
    if (this.taskTimer) {
      this.taskTimer.remove(false);
      this.taskTimer = null;
    }
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
      inputMethod: this.inputSource === 'external' ? 'ime' : 'romaji',
    };
    this.inputBuffer = '';
    this.refreshInputBufferText();
    try {
      await this.submitAttemptAndAdvance(attempt);
      await new Promise<void>((resolve) => {
        this.time.delayedCall(700, resolve);
      });
      await this.loadNextTask();
    } finally {
      this.locked = false;
    }
  }

  private async onTimeout(): Promise<void> {
    if (!this.currentTask || this.locked) return;
    const task = this.currentTask;
    this.locked = true;
    this.taskTimer = null;
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
      inputMethod: this.inputSource === 'external' ? 'ime' : 'romaji',
    };
    try {
      await this.submitAttemptAndAdvance(attempt);
      await new Promise<void>((resolve) => {
        this.time.delayedCall(1100, resolve);
      });
      await this.loadNextTask();
    } finally {
      this.locked = false;
    }
  }
}

function generateId(prefix: string): string {
  const uuid =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${uuid}`;
}
