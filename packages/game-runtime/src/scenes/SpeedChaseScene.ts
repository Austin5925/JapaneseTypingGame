import type { EvaluationResult, TrainingTask, UserAttempt } from '@kana-typing/core';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- Phaser.Scene used as a runtime base + a namespace.
import Phaser from 'phaser';

import type { ExternalInputEvent } from '../bridge/gameEvents';

import type { BaseSceneInit } from './BaseTrainingScene';
import { BaseTrainingScene } from './BaseTrainingScene';
import { getSpeedChaseDifficulty } from './speedChaseDifficulty';

export const SPEED_CHASE_SCENE_KEY = 'SpeedChaseScene';

// v0.8.11 race redesign: real start/finish line + caught/won outcomes.
// - Pursuer (red) starts at the far left, player (green) at canvas centre.
// - Finish line near the right edge; first to break it wins (player) / loses (pursuer catches up).
// - PURSUER_BASE_TIME_MS is the wall-clock budget for the pursuer to traverse from
//   `PURSUER_START_X` to `PLAYER_START_X` if the player never moves. ~35s feels brisk but
//   playable for a beginner who freezes on the first kanji prompt.
const PLAYER_START_X = 400;
const PURSUER_START_X = 40;
const FINISH_LINE_RATIO = 0.92;
const PURSUER_BASE_TIME_MS = 35_000;
const PLAYER_ADVANCE_PX = 60;
/** How close the pursuer can get on a wrong-answer setback before clamping. 1 keeps the
 *  caught condition gated behind the update-loop catch instead of a feedback-induced jump. */
const MIN_PURSUER_GAP_PX = 1;

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
  private playerX = PLAYER_START_X;
  private pursuerX = PURSUER_START_X;
  private finishLineX = 0;
  private finishLineGraphic: Phaser.GameObjects.Graphics | null = null;
  private outcomeOverlay: Phaser.GameObjects.Container | null = null;
  /** 'pending' = race in progress; 'won' / 'caught' freeze input + show splash + finish. */
  private outcome: 'pending' | 'won' | 'caught' = 'pending';
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
  private keydownHandler: ((event: KeyboardEvent) => void) | null = null;

  constructor() {
    super(SPEED_CHASE_SCENE_KEY);
  }

  override init(params: SpeedChaseSceneInit): void {
    super.init(params);
    if (params.width) this.widthPx = params.width;
    if (params.height) this.heightPx = params.height;
    this.inputSource = params.inputSource ?? 'phaser_keys';
    this.sessionStartedAt = this.now();
    // Reset between Phaser scene restarts (the instance is reused, class fields don't re-init).
    this.offExternalInput?.();
    this.offExternalInput = null;
    this.unbindKeyboard();
    this.locked = false;
    this.playerX = PLAYER_START_X;
    this.pursuerX = PURSUER_START_X;
    this.finishLineX = this.widthPx * FINISH_LINE_RATIO;
    this.outcome = 'pending';
    this.outcomeOverlay = null;
    this.inputBuffer = '';
    this.taskStartedAt = 0;
    this.timeLimitMs = 7000;
    this.taskTimer = null;
    this.accuracyAttempts = 0;
    this.accuracyCorrect = 0;
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
    // v0.8.11: finish-line ribbon at the right edge — checkered pattern + "FINISH" tag.
    this.finishLineGraphic = this.add.graphics();
    this.drawFinishLine();
  }

  private drawFinishLine(): void {
    if (!this.finishLineGraphic) return;
    const g = this.finishLineGraphic;
    g.clear();
    const trackTop = this.heightPx * 0.62;
    const trackHeight = 60;
    const x = this.finishLineX;
    g.fillStyle(0xffffff, 1);
    for (let row = 0; row < 6; row++) {
      g.fillRect(x - 6, trackTop + row * 10, 6, 5);
      g.fillRect(x, trackTop + row * 10 + 5, 6, 5);
    }
    g.lineStyle(2, 0xffd866, 1);
    g.lineBetween(x, trackTop - 6, x, trackTop + trackHeight + 6);
    this.add
      .text(x, trackTop - 12, 'FINISH', {
        fontSize: '12px',
        color: '#ffd866',
        fontFamily: 'monospace',
      })
      .setOrigin(0.5, 1);
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
    this.playerSprite = this.add.container(this.playerX, this.trackCenterY());
    const playerBody = this.add.graphics();
    playerBody.fillStyle(0x4ade80, 1);
    playerBody.fillCircle(0, 0, 16);
    this.playerSprite.add(playerBody);

    this.pursuerSprite = this.add.container(this.pursuerX, this.trackCenterY());
    const pursuerBody = this.add.graphics();
    pursuerBody.fillStyle(0xf87171, 1);
    pursuerBody.fillCircle(0, 0, 16);
    this.pursuerSprite.add(pursuerBody);

    if (this.inputSource === 'phaser_keys') {
      if (this.input.keyboard) {
        this.keydownHandler = (event: KeyboardEvent) => this.onKeyDown(event);
        this.input.keyboard.on('keydown', this.keydownHandler);
        this.events.once('shutdown', () => {
          this.unbindKeyboard();
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
    if (this.outcome !== 'pending') return;
    // v0.8.11 race: pursuer marches forward at a constant speed regardless of player x.
    // Cap delta at 50ms so a backgrounded tab can't produce a single-frame catch-up.
    if (this.pursuerSprite) {
      const cappedDelta = Math.min(delta, 50);
      const pursuerSpeedPxPerMs = (PLAYER_START_X - PURSUER_START_X) / PURSUER_BASE_TIME_MS;
      this.pursuerX += pursuerSpeedPxPerMs * cappedDelta;
      const gap = this.playerX - this.pursuerX;
      const isAtPressure = gap <= 80;
      this.pursuerSprite.setPosition(
        this.pursuerX,
        this.trackCenterY() + (isAtPressure ? Math.sin(time / 90) * 3 : 0),
      );
      this.playerSprite?.setY(this.trackCenterY() + Math.sin(time / 140) * 1.5);

      // Outcome detection: caught wins resolution race when both fire on the same frame.
      if (this.pursuerX >= this.playerX) {
        void this.endRace('caught');
      } else if (this.playerX >= this.finishLineX) {
        void this.endRace('won');
      }
    }
  }

  /**
   * Freeze input + render the outcome splash, then close the session via the bridge after
   * a short tween. ResultPage takes over from there. We don't await the sfx promise — the
   * scene just needs to be visibly "over" before the React layer navigates away.
   */
  private async endRace(outcome: 'won' | 'caught'): Promise<void> {
    if (this.outcome !== 'pending') return;
    this.outcome = outcome;
    this.locked = true;
    if (this.taskTimer) {
      this.taskTimer.remove(false);
      this.taskTimer = null;
    }
    // Visual freeze: snap pursuer to the catch position so the user sees what happened.
    if (outcome === 'caught' && this.pursuerSprite) {
      this.pursuerX = this.playerX;
      this.pursuerSprite.setX(this.pursuerX);
      this.cameras.main?.shake(360, 0.012);
      this.sfx.play('wrong');
    } else if (outcome === 'won' && this.playerSprite) {
      this.playerX = this.finishLineX;
      this.playerSprite.setX(this.playerX);
      this.sfx.play('perfect');
    }
    this.showOutcomeSplash(outcome);
    // Give the splash ~1.2s to read before closing the session.
    await new Promise<void>((resolve) => {
      this.time.delayedCall(1200, resolve);
    });
    await this.finishSession(outcome === 'won' ? 'completed' : 'timeout');
  }

  private showOutcomeSplash(outcome: 'won' | 'caught'): void {
    const cx = this.widthPx / 2;
    const cy = this.heightPx / 2;
    const bg = this.add.graphics();
    bg.fillStyle(outcome === 'won' ? 0x0d3a1a : 0x3a0d0d, 0.78);
    bg.fillRect(0, 0, this.widthPx, this.heightPx);
    const title = this.add.text(cx, cy - 18, outcome === 'won' ? 'GOAL!' : 'GAME OVER', {
      fontSize: '64px',
      color: outcome === 'won' ? '#4ade80' : '#f87171',
      fontFamily: 'sans-serif',
      stroke: '#0e0f12',
      strokeThickness: 6,
    });
    title.setOrigin(0.5, 0.5);
    const subtitle = this.add.text(
      cx,
      cy + 32,
      outcome === 'won' ? '冲到终点 — 漂亮' : '被追上了 — 再来一次',
      {
        fontSize: '20px',
        color: '#e6e8ec',
        fontFamily: 'sans-serif',
      },
    );
    subtitle.setOrigin(0.5, 0.5);
    const container = this.add.container(0, 0, [bg, title, subtitle]);
    container.setDepth(2000);
    this.outcomeOverlay = container;
    this.tweens.add({
      targets: title,
      scale: { from: 0.6, to: 1.1 },
      duration: 280,
      ease: 'Cubic.easeOut',
    });
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

  private trackCenterY(): number {
    return this.heightPx * 0.62 + 30;
  }

  private unbindKeyboard(): void {
    if (this.keydownHandler && this.input.keyboard) {
      this.input.keyboard.off('keydown', this.keydownHandler);
    }
    this.keydownHandler = null;
  }

  private advancePlayer(): void {
    // v0.8.11: clamp at the finish line so the win condition fires exactly when crossed.
    this.playerX = Math.min(this.finishLineX, this.playerX + PLAYER_ADVANCE_PX);
    if (this.playerSprite) {
      this.playerSprite.setX(this.playerX);
      this.playerSprite.setScale(1.16);
      this.tweens.add({
        targets: this.playerSprite,
        scale: 1,
        duration: 180,
        ease: 'Cubic.easeOut',
      });
    }
  }

  protected showFeedback(result: EvaluationResult): void {
    this.accuracyAttempts++;
    if (result.isCorrect) this.accuracyCorrect++;

    if (!this.feedbackText) return;
    if (result.isCorrect) {
      this.feedbackText.setText(`✓ ${result.expectedDisplay}`);
      this.feedbackText.setColor('#4ade80');
      // Reward visual: nudge player forward so pursuer falls back.
      this.advancePlayer();
    } else {
      const tagSummary = result.errorTags.length > 0 ? ` (${result.errorTags.join(', ')})` : '';
      this.feedbackText.setText(`✗ expected ${result.expectedDisplay}${tagSummary}`);
      this.feedbackText.setColor('#f87171');
      // v0.8.11: pursuer jumps closer on a wrong answer. We let it advance up to (player - 1)
      // so the next update tick can detect a catch — no more silent clamp at -60px.
      const accuracy = this.accuracyAttempts > 0 ? this.accuracyCorrect / this.accuracyAttempts : 1;
      const diff = getSpeedChaseDifficulty(this.now() - this.sessionStartedAt, accuracy);
      this.pursuerX = Math.min(
        this.playerX - MIN_PURSUER_GAP_PX,
        this.pursuerX + diff.wrongAnswerSetbackPx,
      );
      if (this.pursuerSprite) {
        this.pursuerSprite.setX(this.pursuerX);
        this.pursuerSprite.setScale(1.2);
        this.tweens.add({
          targets: this.pursuerSprite,
          scale: 1,
          duration: 200,
          ease: 'Cubic.easeOut',
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
    if (!this.currentTask || this.locked || this.outcome !== 'pending') return;
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
    if (!this.currentTask || this.locked || this.outcome !== 'pending') return;
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
