import type {
  EvaluationResult,
  TrainingOption,
  TrainingTask,
  UserAttempt,
} from '@kana-typing/core';
import type Phaser from 'phaser';

import type { BaseSceneInit } from './BaseTrainingScene';
import { BaseTrainingScene } from './BaseTrainingScene';

export const SPACE_BATTLE_SCENE_KEY = 'SpaceBattleScene';

export interface SpaceBattleSceneInit extends BaseSceneInit {
  width?: number;
  height?: number;
}

interface ShipUi {
  optionId: string;
  itemId: string | undefined;
  label: string;
  isCorrect: boolean;
  hotkey: string;
  container: Phaser.GameObjects.Container;
  startY: number;
  hit: boolean;
}

const ENEMY_COLORS = [0x7dd3fc, 0x86efac, 0xfde68a, 0xf0abfc];

/**
 * SpaceBattle training scene (v0.8.1 — option-select辨析 training).
 *
 * Each task is one ChoiceTrainingTask. 3-4 enemy frigates spawn at the top of the screen,
 * each labelled with the surface of one of `task.options[]`. Ships descend toward the player
 * frigate at the bottom over the task time limit. The user selects with number keys (1-4) —
 * pressing a hotkey immediately submits that option as the chosen answer.
 *
 *   - Correct hit: green flash + explosion tween + advance.
 *   - Wrong hit:   red flash + screen shake + advance with the option's errorTagIfChosen.
 *   - Timeout:     the still-airborne correct ship "escapes" past the bottom; we submit a
 *                  ['timeout'] attempt and advance.
 *
 * The hotkey labels (1, 2, 3, 4) are rendered above each ship so the user doesn't have to
 * count. We keep the layout fixed left-to-right for stable hotkey assignment.
 */
export class SpaceBattleScene extends BaseTrainingScene<TrainingTask> {
  private widthPx = 800;
  private heightPx = 480;
  private promptText: Phaser.GameObjects.Text | null = null;
  private feedbackText: Phaser.GameObjects.Text | null = null;
  private timerText: Phaser.GameObjects.Text | null = null;
  private playerShip: Phaser.GameObjects.Container | null = null;
  private ships: ShipUi[] = [];
  private taskStartedAt = 0;
  private timeLimitMs = 8000;
  private taskTimer: Phaser.Time.TimerEvent | null = null;
  private descendTween: Phaser.Tweens.Tween | null = null;
  private locked = false;

  constructor() {
    super(SPACE_BATTLE_SCENE_KEY);
  }

  override init(params: SpaceBattleSceneInit): void {
    super.init(params);
    if (params.width) this.widthPx = params.width;
    if (params.height) this.heightPx = params.height;
    this.locked = false;
  }

  protected createBackground(): void {
    const g = this.add.graphics();
    g.fillStyle(0x05060a, 1);
    g.fillRect(0, 0, this.widthPx, this.heightPx);
    // Star field — cheap pseudo-random dots based on a deterministic hash of position so the
    // sky stays fixed across renders without needing a sprite asset.
    g.fillStyle(0xc6d2e0, 1);
    for (let i = 0; i < 80; i++) {
      const x = (i * 1597) % this.widthPx;
      const y = (i * 9277) % this.heightPx;
      const size = i % 3 === 0 ? 2 : 1;
      g.fillRect(x, y, size, size);
    }
    // Faint horizon line at the player's altitude.
    g.fillStyle(0x1d2230, 1);
    g.fillRect(0, this.heightPx * 0.85, this.widthPx, 2);
  }

  protected createHudLayer(): void {
    this.timerText = this.add.text(this.widthPx - 16, 12, '', {
      fontSize: '20px',
      color: '#94a0b3',
      fontFamily: 'monospace',
    });
    this.timerText.setOrigin(1, 0);

    this.promptText = this.add.text(this.widthPx / 2, 24, '', {
      fontSize: '22px',
      color: '#e9efe9',
      fontFamily: 'sans-serif',
      align: 'center',
      wordWrap: { width: this.widthPx - 80 },
    });
    this.promptText.setOrigin(0.5, 0);

    this.feedbackText = this.add.text(this.widthPx / 2, this.heightPx - 12, '', {
      fontSize: '15px',
      color: '#94a0b3',
      fontFamily: 'sans-serif',
    });
    this.feedbackText.setOrigin(0.5, 1);

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
    this.clearShips();
    this.timeLimitMs = task.timeLimitMs ?? 8000;
    this.taskStartedAt = this.now();

    if (this.promptText) {
      const meaning = task.prompt.meaningZh ?? task.prompt.text ?? '?';
      this.promptText.setText(`意思:${meaning}`);
    }
    if (this.feedbackText) {
      this.feedbackText.setText('数字键 1-4 选择目标 — 击中正确者 ✓');
      this.feedbackText.setColor('#94a0b3');
    }

    const options = task.options ?? [];
    this.ships = options.map((opt, i) => this.spawnShip(opt, i, options.length));

    // Render the player ship once per task so it stays anchored even if the bridge restarts
    // a scene mid-session.
    this.spawnPlayerShip();

    // Descend animation: every ship slides from its `startY` to a "death zone" near the bottom
    // over the full task time limit. If the timeout fires before the user picks anything, the
    // ships "escape" and we submit a timeout attempt.
    const targetY = this.heightPx * 0.7;
    this.descendTween = this.tweens.add({
      targets: this.ships.map((s) => s.container),
      y: targetY,
      duration: this.timeLimitMs,
      ease: 'Linear',
    });

    if (this.taskTimer) this.taskTimer.remove(false);
    this.taskTimer = this.time.delayedCall(this.timeLimitMs, () => void this.onTimeout());
  }

  private spawnShip(option: TrainingOption, index: number, total: number): ShipUi {
    const margin = 90;
    const usable = this.widthPx - margin * 2;
    const step = total > 1 ? usable / (total - 1) : 0;
    const x = margin + step * index;
    const y = this.heightPx * 0.18 + (index % 2) * 18;

    const container = this.add.container(x, y);
    const body = this.add.graphics();
    drawEnemyShip(body, ENEMY_COLORS[index % ENEMY_COLORS.length]!);
    container.add(body);

    const label = this.add.text(0, -2, option.label, {
      fontSize: '24px',
      color: '#e9efe9',
      fontFamily: 'sans-serif',
    });
    label.setOrigin(0.5, 0.5);
    container.add(label);

    const hotkey = String(index + 1);
    const hotkeyTag = this.add.text(0, -54, `[${hotkey}]`, {
      fontSize: '14px',
      color: '#ffd866',
      fontFamily: 'monospace',
    });
    hotkeyTag.setOrigin(0.5, 0.5);
    container.add(hotkeyTag);

    this.tweens.add({
      targets: container,
      scale: { from: 1, to: 1.035 },
      duration: 900 + index * 120,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1,
    });

    return {
      optionId: option.id,
      itemId: option.itemId,
      label: option.label,
      isCorrect: option.isCorrect,
      hotkey,
      container,
      startY: y,
      hit: false,
    };
  }

  private spawnPlayerShip(): void {
    if (this.playerShip) {
      this.playerShip.destroy();
      this.playerShip = null;
    }
    const c = this.add.container(this.widthPx / 2, this.heightPx * 0.92);
    const g = this.add.graphics();
    drawPlayerShip(g);
    c.add(g);
    this.playerShip = c;
  }

  private clearShips(): void {
    if (this.taskTimer) {
      this.taskTimer.remove(false);
      this.taskTimer = null;
    }
    if (this.descendTween) {
      this.descendTween.stop();
      this.descendTween = null;
    }
    for (const s of this.ships) {
      s.container.destroy();
    }
    this.ships = [];
  }

  protected showFeedback(result: EvaluationResult): void {
    if (!this.feedbackText) return;
    if (result.isCorrect) {
      this.feedbackText.setText(`✓ ${result.expectedDisplay}`);
      this.feedbackText.setColor('#4ade80');
    } else {
      const tagSummary = result.errorTags.length > 0 ? ` (${result.errorTags.join(', ')})` : '';
      this.feedbackText.setText(
        `✗ 选了 ${result.actualDisplay} · 应是 ${result.expectedDisplay}${tagSummary}`,
      );
      this.feedbackText.setColor('#f87171');
    }
  }

  // ─── input ─────────────────────────────────────────────────────────

  private onKeyDown(event: KeyboardEvent): void {
    if (!this.currentTask || this.locked) return;
    // Hotkeys 1-4. We don't bind 5+ — selectChoiceTasks caps distractorCount at 3 in practice.
    if (event.key >= '1' && event.key <= '9') {
      const index = Number(event.key) - 1;
      if (index >= 0 && index < this.ships.length) {
        void this.fireAt(index);
      }
    }
  }

  private async fireAt(index: number): Promise<void> {
    if (!this.currentTask || this.locked) return;
    const ship = this.ships[index];
    if (!ship || ship.hit) return;
    ship.hit = true;
    this.locked = true;
    this.tweens.killTweensOf(ship.container);

    if (this.taskTimer) {
      this.taskTimer.remove(false);
      this.taskTimer = null;
    }
    if (this.descendTween) {
      this.descendTween.stop();
      this.descendTween = null;
    }

    await this.animateShot(ship);

    // Visual: green explosion on the chosen ship if correct, red shake if not.
    if (ship.isCorrect) {
      this.tweens.add({
        targets: ship.container,
        scale: { from: 1, to: 1.6 },
        alpha: { from: 1, to: 0 },
        duration: 380,
        ease: 'Cubic.easeOut',
      });
    } else {
      this.cameras.main.shake(220, 0.005);
      this.pulseCorrectShip();
      this.tweens.add({
        targets: ship.container,
        scale: { from: 1, to: 0.6 },
        alpha: { from: 1, to: 0 },
        duration: 380,
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
      selectedOptionId: ship.optionId,
      startedAt: new Date(this.taskStartedAt).toISOString(),
      submittedAt: new Date(this.now()).toISOString(),
      reactionTimeMs,
      usedHint: false,
      inputMethod: 'keyboard_select',
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

  private async animateShot(ship: ShipUi): Promise<void> {
    if (!this.playerShip) return;
    const fromX = this.playerShip.x;
    const fromY = this.playerShip.y - 26;
    const toX = ship.container.x;
    const toY = ship.container.y + 28;

    const flash = this.add.graphics();
    flash.fillStyle(0x9be7ff, 1);
    flash.fillCircle(0, -26, 11);
    this.playerShip.add(flash);
    this.tweens.add({
      targets: flash,
      scale: 1.9,
      alpha: 0,
      duration: 140,
      ease: 'Cubic.easeOut',
      onComplete: () => flash.destroy(),
    });

    const bullet = this.add.container(fromX, fromY);
    const bolt = this.add.graphics();
    bolt.fillStyle(0x9be7ff, 0.32);
    bolt.fillRoundedRect(-5, 8, 10, 26, 4);
    bolt.fillStyle(0xe0f2fe, 1);
    bolt.fillRoundedRect(-3, -14, 6, 26, 3);
    bolt.fillStyle(0xffffff, 1);
    bolt.fillCircle(0, -16, 4);
    bullet.add(bolt);

    await new Promise<void>((resolve) => {
      this.tweens.add({
        targets: bullet,
        x: toX,
        y: toY,
        scale: { from: 1, to: 1.12 },
        duration: 230,
        ease: 'Quad.easeOut',
        onComplete: () => {
          bullet.destroy();
          this.spawnHitBurst(toX, toY, ship.isCorrect);
          resolve();
        },
      });
    });
  }

  private spawnHitBurst(x: number, y: number, correct: boolean): void {
    const burst = this.add.graphics();
    burst.lineStyle(3, correct ? 0x4ade80 : 0xf87171, 1);
    burst.strokeCircle(x, y, 10);
    burst.lineStyle(1, 0xe9efe9, 0.9);
    burst.strokeCircle(x, y, 4);
    this.tweens.add({
      targets: burst,
      scale: 3.4,
      alpha: 0,
      duration: 280,
      ease: 'Cubic.easeOut',
      onComplete: () => burst.destroy(),
    });
  }

  private pulseCorrectShip(): void {
    const correct = this.ships.find((s) => s.isCorrect && !s.hit);
    if (!correct) return;
    const ring = this.add.graphics();
    ring.lineStyle(3, 0x4ade80, 0.95);
    ring.strokeCircle(0, 0, 62);
    correct.container.add(ring);
    this.tweens.add({
      targets: ring,
      alpha: 0,
      scale: 1.25,
      duration: 720,
      ease: 'Sine.easeOut',
      onComplete: () => ring.destroy(),
    });
  }

  private async onTimeout(): Promise<void> {
    if (!this.currentTask || this.locked) return;
    const task = this.currentTask;
    this.locked = true;
    this.taskTimer = null;
    if (this.descendTween) {
      this.descendTween.stop();
      this.descendTween = null;
    }
    const attempt: UserAttempt = {
      id: generateId('att'),
      sessionId: this.sessionId,
      taskId: task.id,
      itemId: task.itemId,
      gameType: task.gameType,
      // selectedOptionId omitted — evaluator yields ['timeout'].
      startedAt: new Date(this.taskStartedAt).toISOString(),
      submittedAt: new Date(this.now()).toISOString(),
      reactionTimeMs: this.timeLimitMs,
      usedHint: false,
      inputMethod: 'keyboard_select',
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

function drawEnemyShip(g: Phaser.GameObjects.Graphics, accent: number): void {
  g.fillStyle(0x0b1320, 0.95);
  g.fillTriangle(-66, 24, -38, -26, -6, 18);
  g.fillTriangle(66, 24, 38, -26, 6, 18);
  g.fillStyle(accent, 0.22);
  g.fillRoundedRect(-58, -30, 116, 60, 8);
  g.lineStyle(2, accent, 0.95);
  g.strokeRoundedRect(-58, -30, 116, 60, 8);
  g.fillStyle(0x111827, 1);
  g.fillRoundedRect(-42, -18, 84, 38, 6);
  g.fillStyle(accent, 0.72);
  g.fillTriangle(-26, -30, 0, -54, 26, -30);
  g.fillStyle(0xe0f2fe, 0.82);
  g.fillEllipse(0, -10, 30, 14);
  g.fillStyle(accent, 0.9);
  g.fillRect(-48, 24, 18, 8);
  g.fillRect(30, 24, 18, 8);
}

function drawPlayerShip(g: Phaser.GameObjects.Graphics): void {
  g.fillStyle(0x0f172a, 1);
  g.fillTriangle(-42, 20, 0, -36, 42, 20);
  g.fillStyle(0x38bdf8, 1);
  g.fillTriangle(-26, 16, 0, -28, 26, 16);
  g.fillStyle(0x1d4ed8, 1);
  g.fillRoundedRect(-13, -8, 26, 30, 5);
  g.fillStyle(0xe0f2fe, 0.9);
  g.fillEllipse(0, -14, 18, 12);
  g.fillStyle(0xf97316, 0.9);
  g.fillTriangle(-18, 20, -8, 40, -2, 20);
  g.fillTriangle(18, 20, 8, 40, 2, 20);
}
