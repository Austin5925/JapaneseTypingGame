import type {
  EvaluationResult,
  TrainingOption,
  TrainingTask,
  UserAttempt,
} from '@kana-typing/core';
import type Phaser from 'phaser';

import {
  createBrowserJapaneseTts,
  createNoopJapaneseTts,
  type JapaneseTts,
} from '../audio/japaneseTts';

import type { BaseSceneInit } from './BaseTrainingScene';
import { BaseTrainingScene } from './BaseTrainingScene';

export const APPLE_RESCUE_SCENE_KEY = 'AppleRescueScene';

export interface AppleRescueSceneInit extends BaseSceneInit {
  width?: number;
  height?: number;
  /** Optional TTS injection for tests. Defaults to the browser SpeechSynthesis impl. */
  tts?: JapaneseTts;
}

interface AppleUi {
  optionId: string;
  itemId: string | undefined;
  label: string;
  isCorrect: boolean;
  container: Phaser.GameObjects.Container;
  /** Last known x — sampled in update() because Phaser tween targets bypass JS getters. */
  caught: boolean;
  escaped: boolean;
}

const BASKET_SPEED_PX_PER_FRAME = 7;
const APPLE_FALL_DURATION_MS = 8000;
const CATCH_BASKET_HALF_WIDTH = 60;
const CATCH_TOLERANCE_Y = 24;

/**
 * AppleRescue training scene (v0.8.2 — listening discrimination).
 *
 * Each task is one ChoiceTrainingTask with `prompt.kind === 'audio'`. We play the prompt's
 * kana through SpeechSynthesis (the JapaneseTts wrapper) and let the user catch the matching
 * apple with a basket. Apples fall in fixed lanes from a tree at the top of the screen; the
 * basket slides left/right via arrow keys.
 *
 * Controls:
 *   ←/→  move basket
 *   R    replay audio at normal speed
 *   S    replay audio at slow speed (rate 0.7)
 *
 * Outcomes:
 *   - Catch correct apple → green flash + advance.
 *   - Catch wrong apple   → red shatter + advance with errorTagIfChosen.
 *   - All apples escape   → ['timeout'] attempt, advance.
 *
 * The TTS layer is injected via `init.tts` so tests can swap a no-op implementation; the
 * production path uses `createBrowserJapaneseTts()` and is silent on platforms without
 * SpeechSynthesis (the kana label on each apple still gives the user something to read).
 */
export class AppleRescueScene extends BaseTrainingScene<TrainingTask> {
  private widthPx = 800;
  private heightPx = 480;
  private promptText: Phaser.GameObjects.Text | null = null;
  private feedbackText: Phaser.GameObjects.Text | null = null;
  private timerText: Phaser.GameObjects.Text | null = null;
  private hintText: Phaser.GameObjects.Text | null = null;
  private basket: Phaser.GameObjects.Container | null = null;
  private basketX = 400;
  private apples: AppleUi[] = [];
  private taskStartedAt = 0;
  private timeLimitMs = APPLE_FALL_DURATION_MS;
  private taskTimer: Phaser.Time.TimerEvent | null = null;
  private fallTween: Phaser.Tweens.Tween | null = null;
  private cursors: Phaser.Types.Input.Keyboard.CursorKeys | null = null;
  private locked = false;
  private tts: JapaneseTts = createNoopJapaneseTts();
  private currentKana = '';

  constructor() {
    super(APPLE_RESCUE_SCENE_KEY);
  }

  override init(params: AppleRescueSceneInit): void {
    super.init(params);
    if (params.width) this.widthPx = params.width;
    if (params.height) this.heightPx = params.height;
    this.tts = params.tts ?? createBrowserJapaneseTts();
    this.locked = false;
    this.basketX = this.widthPx / 2;
  }

  protected createBackground(): void {
    const g = this.add.graphics();
    g.fillStyle(0x14213d, 1);
    g.fillRect(0, 0, this.widthPx, this.heightPx);
    // Sky gradient stripes
    g.fillStyle(0x1d3557, 1);
    g.fillRect(0, this.heightPx * 0.35, this.widthPx, this.heightPx * 0.65);
    // Ground
    g.fillStyle(0x6a994e, 1);
    g.fillRect(0, this.heightPx * 0.92, this.widthPx, this.heightPx * 0.08);
    // Tree crown — a few overlapping circles + a trunk on each side.
    g.fillStyle(0x1f3a1f, 1);
    g.fillCircle(this.widthPx * 0.18, 80, 70);
    g.fillCircle(this.widthPx * 0.5, 60, 90);
    g.fillCircle(this.widthPx * 0.82, 80, 70);
    g.fillStyle(0x2f5f2f, 1);
    g.fillCircle(this.widthPx * 0.18, 80, 50);
    g.fillCircle(this.widthPx * 0.5, 60, 70);
    g.fillCircle(this.widthPx * 0.82, 80, 50);
    g.fillStyle(0x6b3f1d, 1);
    g.fillRect(this.widthPx * 0.06, 100, 12, 80);
    g.fillRect(this.widthPx * 0.93 - 12, 100, 12, 80);
  }

  protected createHudLayer(): void {
    this.timerText = this.add.text(this.widthPx - 16, 12, '', {
      fontSize: '20px',
      color: '#94a0b3',
      fontFamily: 'monospace',
    });
    this.timerText.setOrigin(1, 0);

    this.promptText = this.add.text(this.widthPx / 2, 24, '', {
      fontSize: '20px',
      color: '#ffd866',
      fontFamily: 'sans-serif',
      align: 'center',
    });
    this.promptText.setOrigin(0.5, 0);

    this.hintText = this.add.text(16, 12, '', {
      fontSize: '13px',
      color: '#94a0b3',
      fontFamily: 'monospace',
    });
    this.hintText.setText('R 重听 · S 慢速 · ←/→ 接苹果');

    this.feedbackText = this.add.text(this.widthPx / 2, this.heightPx - 12, '', {
      fontSize: '15px',
      color: '#94a0b3',
      fontFamily: 'sans-serif',
    });
    this.feedbackText.setOrigin(0.5, 1);

    if (this.input.keyboard) {
      this.cursors = this.input.keyboard.createCursorKeys();
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
    // Basket movement.
    if (this.cursors && this.basket) {
      if (this.cursors.left.isDown) {
        this.basketX = Math.max(60, this.basketX - BASKET_SPEED_PX_PER_FRAME);
      }
      if (this.cursors.right.isDown) {
        this.basketX = Math.min(this.widthPx - 60, this.basketX + BASKET_SPEED_PX_PER_FRAME);
      }
      this.basket.x = this.basketX;
    }
    // Catch detection: any apple whose container Y is in the basket's Y band AND whose X is
    // within tolerance of the basket centre is caught. We exit on the first catch — the
    // submit + advance loop in `catchApple` re-locks for the rest of the frame.
    if (!this.locked) {
      for (const apple of this.apples) {
        if (apple.caught || apple.escaped) continue;
        const ay = apple.container.y;
        const ax = apple.container.x;
        if (ay >= this.heightPx * 0.78 - CATCH_TOLERANCE_Y && ay <= this.heightPx * 0.78) {
          if (Math.abs(ax - this.basketX) <= CATCH_BASKET_HALF_WIDTH) {
            void this.catchApple(apple);
            break;
          }
        }
        if (ay >= this.heightPx * 0.92) {
          apple.escaped = true;
          // Sink the missed apple visually.
          this.tweens.add({
            targets: apple.container,
            alpha: 0,
            duration: 280,
          });
        }
      }
      // If every apple escaped without a catch, the round timed out implicitly — handle here
      // so the user doesn't sit through the rest of the timer.
      if (this.apples.length > 0 && this.apples.every((a) => a.escaped || a.caught)) {
        if (this.apples.some((a) => !a.caught)) {
          // At least one un-caught apple → escape-only path.
          if (!this.apples.some((a) => a.caught)) {
            void this.onTimeout();
          }
        }
      }
    }
  }

  protected spawnTask(task: TrainingTask): void {
    this.clearApples();
    this.timeLimitMs = task.timeLimitMs ?? APPLE_FALL_DURATION_MS;
    this.taskStartedAt = this.now();

    this.currentKana = task.prompt.text ?? '';
    const canPlayAudio = this.tts.isAvailable() && this.currentKana.length > 0;
    if (this.promptText) {
      this.promptText.setText(
        canPlayAudio ? '听音，选择匹配的词' : `无音频:${this.currentKana || '(无)'}`,
      );
    }
    if (this.feedbackText) {
      this.feedbackText.setText('听音 → 用 ←/→ 接对应的苹果');
      this.feedbackText.setColor('#94a0b3');
    }

    const options = task.options ?? [];
    this.apples = options.map((opt, i) => this.spawnApple(opt, i, options.length));
    this.spawnBasket();

    // Fall tween: every apple slides from `startY` (top) to ground line over the time limit.
    this.fallTween = this.tweens.add({
      targets: this.apples.map((a) => a.container),
      y: this.heightPx * 0.94,
      duration: this.timeLimitMs,
      ease: 'Sine.easeIn',
    });

    if (this.taskTimer) this.taskTimer.remove(false);
    this.taskTimer = this.time.delayedCall(this.timeLimitMs + 200, () => void this.onTimeout());

    // Auto-play the audio cue once on spawn. We don't await it — speech is "fire and forget"
    // so a slow voice load doesn't stall the descent animation.
    if (canPlayAudio) {
      void this.tts.playKana(this.currentKana).catch((err: unknown) => {
        // Surface to console; not a session-fatal error (the user can still read the prompt).
        console.warn('[AppleRescue] tts play failed', err);
      });
    }
  }

  private spawnApple(option: TrainingOption, index: number, total: number): AppleUi {
    const margin = 100;
    const usable = this.widthPx - margin * 2;
    const step = total > 1 ? usable / (total - 1) : 0;
    const x = margin + step * index;
    const y = this.heightPx * 0.18 + (index % 2) * 22;

    const container = this.add.container(x, y);
    const body = this.add.graphics();
    body.fillStyle(0xff7a7a, 1);
    body.fillCircle(0, 0, 28);
    body.fillStyle(0x9a3a3a, 1);
    body.fillCircle(-7, -6, 5);
    body.fillStyle(0x4ade80, 1);
    body.fillEllipse(8, -22, 18, 8);
    container.add(body);

    const label = this.add.text(0, 0, option.label, {
      fontSize: '20px',
      color: '#0e0f12',
      fontFamily: 'sans-serif',
    });
    label.setOrigin(0.5, 0.5);
    container.add(label);

    return {
      optionId: option.id,
      itemId: option.itemId,
      label: option.label,
      isCorrect: option.isCorrect,
      container,
      caught: false,
      escaped: false,
    };
  }

  private spawnBasket(): void {
    if (this.basket) {
      this.basket.destroy();
      this.basket = null;
    }
    const c = this.add.container(this.basketX, this.heightPx * 0.88);
    const g = this.add.graphics();
    g.fillStyle(0xc6885b, 1);
    g.fillRoundedRect(-60, -16, 120, 30, 6);
    g.lineStyle(2, 0x6a3f17, 1);
    g.strokeRoundedRect(-60, -16, 120, 30, 6);
    // Weave lines for the basket
    g.lineStyle(1, 0x6a3f17, 0.6);
    for (let i = -50; i <= 50; i += 12) {
      g.lineBetween(i, -14, i, 12);
    }
    c.add(g);
    this.basket = c;
  }

  private clearApples(): void {
    if (this.taskTimer) {
      this.taskTimer.remove(false);
      this.taskTimer = null;
    }
    if (this.fallTween) {
      this.fallTween.stop();
      this.fallTween = null;
    }
    for (const a of this.apples) {
      a.container.destroy();
    }
    this.apples = [];
  }

  protected showFeedback(result: EvaluationResult): void {
    if (!this.feedbackText) return;
    if (result.isCorrect) {
      this.feedbackText.setText(`✓ ${result.expectedDisplay}`);
      this.feedbackText.setColor('#4ade80');
    } else {
      const tagSummary = result.errorTags.length > 0 ? ` (${result.errorTags.join(', ')})` : '';
      this.feedbackText.setText(
        `✗ 接到 ${result.actualDisplay} · 应是 ${result.expectedDisplay}${tagSummary}`,
      );
      this.feedbackText.setColor('#f87171');
    }
  }

  // ─── input ─────────────────────────────────────────────────────────

  private onKeyDown(event: KeyboardEvent): void {
    if (!this.currentTask || this.locked) return;
    const key = event.key.toLowerCase();
    if (key === 'r') {
      this.replayAudio('normal');
    } else if (key === 's') {
      this.replayAudio('slow');
    }
  }

  private replayAudio(speed: 'normal' | 'slow'): void {
    if (!this.tts.isAvailable() || !this.currentKana) return;
    void this.tts.playKana(this.currentKana, { speed }).catch((err: unknown) => {
      console.warn('[AppleRescue] tts replay failed', err);
    });
  }

  private async catchApple(apple: AppleUi): Promise<void> {
    if (!this.currentTask || this.locked || apple.caught) return;
    apple.caught = true;
    this.locked = true;
    this.tts.cancel();

    if (this.taskTimer) {
      this.taskTimer.remove(false);
      this.taskTimer = null;
    }
    if (this.fallTween) {
      this.fallTween.stop();
      this.fallTween = null;
    }

    if (apple.isCorrect) {
      this.tweens.add({
        targets: apple.container,
        scale: { from: 1, to: 1.4 },
        alpha: { from: 1, to: 0 },
        duration: 400,
        ease: 'Cubic.easeOut',
      });
    } else {
      this.cameras.main.shake(220, 0.005);
      this.tweens.add({
        targets: apple.container,
        scale: { from: 1, to: 0.5 },
        alpha: { from: 1, to: 0 },
        rotation: 0.6,
        duration: 400,
        ease: 'Cubic.easeIn',
      });
    }

    const reactionTimeMs = Math.max(300, this.now() - this.taskStartedAt);
    const task = this.currentTask;
    const attempt: UserAttempt = {
      id: generateId('att'),
      sessionId: this.sessionId,
      taskId: task.id,
      itemId: task.itemId,
      gameType: task.gameType,
      selectedOptionId: apple.optionId,
      startedAt: new Date(this.taskStartedAt).toISOString(),
      submittedAt: new Date(this.now()).toISOString(),
      reactionTimeMs,
      usedHint: false,
      inputMethod: 'audio_only',
    };
    try {
      await this.submitAttemptAndAdvance(attempt);
      await new Promise<void>((resolve) => {
        this.time.delayedCall(900, resolve);
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
    this.tts.cancel();
    if (this.fallTween) {
      this.fallTween.stop();
      this.fallTween = null;
    }
    const attempt: UserAttempt = {
      id: generateId('att'),
      sessionId: this.sessionId,
      taskId: task.id,
      itemId: task.itemId,
      gameType: task.gameType,
      // selectedOptionId omitted → evaluator yields ['timeout'].
      startedAt: new Date(this.taskStartedAt).toISOString(),
      submittedAt: new Date(this.now()).toISOString(),
      reactionTimeMs: this.timeLimitMs,
      usedHint: false,
      inputMethod: 'audio_only',
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
