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
    // Enemy frigate: trapezoid hull + glow outline.
    body.fillStyle(0x4ade80, 0.18);
    body.fillRoundedRect(-72, -36, 144, 72, 10);
    body.lineStyle(2, 0x4ade80, 0.9);
    body.strokeRoundedRect(-72, -36, 144, 72, 10);
    body.fillStyle(0x4ade80, 0.45);
    body.fillTriangle(-30, -36, 0, -52, 30, -36);
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
    g.fillStyle(0x6cb9ff, 1);
    g.fillTriangle(-22, 14, 0, -18, 22, 14);
    g.fillStyle(0x14213d, 1);
    g.fillRect(-10, -2, 20, 8);
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

    if (this.taskTimer) {
      this.taskTimer.remove(false);
      this.taskTimer = null;
    }
    if (this.descendTween) {
      this.descendTween.stop();
      this.descendTween = null;
    }

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
