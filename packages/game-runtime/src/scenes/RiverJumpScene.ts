import {
  compareKana,
  toKanaCandidates,
  type EvaluationResult,
  type SentenceChunkAttemptEntry,
  type TrainingTask,
  type UserAttempt,
} from '@kana-typing/core';
import Phaser from 'phaser';

import type { ExternalInputEvent, Unsubscribe } from '../bridge/gameEvents';

import type { BaseSceneInit } from './BaseTrainingScene';
import { BaseTrainingScene } from './BaseTrainingScene';

export const RIVER_JUMP_SCENE_KEY = 'RiverJumpScene';

/**
 * `'internal'` (default) routes the Phaser keyboard input pump to a romaji buffer rendered in
 * the canvas — same pattern as MoleScene. `'external'` disables the in-canvas pump and waits
 * for `bridge.emitExternalInput` events fed by an outside-of-canvas <ImeInputBox>.
 */
export type RiverJumpInputSource = 'internal' | 'external';

export interface RiverJumpSceneInit extends BaseSceneInit {
  width?: number;
  height?: number;
  inputSource?: RiverJumpInputSource;
}

interface ChunkUi {
  id: string;
  text: string;
  kana: string;
  container: Phaser.GameObjects.Container;
  baseX: number;
  baseY: number;
  bobTween: Phaser.Tweens.Tween | null;
  consumed: boolean;
}

/**
 * RiverJump training scene (v0.8.0 — sentence-order training).
 *
 * Each task is one sentence. Lily pads are rendered in a row (shuffled), one per chunk; the
 * frog starts on the left bank. The user types the reading of whichever chunk they think comes
 * next. Recognition logic:
 *
 *   - On Enter, compareKana the input against every still-on-water chunk's kana.
 *   - 1 match → recognise the chunk; the frog jumps onto that lily pad (consumed).
 *     - If the chosen chunk is the canonical-next chunk → green flash + advance.
 *     - If wrong order → splash animation + the entire sentence fails (we still emit one
 *       attempt with the so-far chunkOrder so the evaluator can flag word_order_error).
 *   - 0 matches → red flash + retain input on the line so the user can fix the typo.
 *   - >1 matches (rare; e.g. duplicate "ほんを" between two chunks) → take the canonical-next
 *     chunk if it is among them, else the first match in canonical order.
 *
 * Per-chunk inputs are buffered in `chunkInputs` and submitted via `attempt.rawInput` (JSON of
 * `SentenceChunkAttemptEntry[]`) so the core evaluator can replay reading comparisons.
 */
export class RiverJumpScene extends BaseTrainingScene<TrainingTask> {
  private widthPx = 800;
  private heightPx = 480;
  private inputSource: RiverJumpInputSource = 'internal';
  private offExternalInput: Unsubscribe | null = null;

  private bgGraphics: Phaser.GameObjects.Graphics | null = null;
  private promptText: Phaser.GameObjects.Text | null = null;
  private inputBufferText: Phaser.GameObjects.Text | null = null;
  private feedbackText: Phaser.GameObjects.Text | null = null;
  private timerText: Phaser.GameObjects.Text | null = null;
  private frog: Phaser.GameObjects.Container | null = null;
  private chunkUis: ChunkUi[] = [];

  private inputBuffer = '';
  private taskStartedAt = 0;
  private timeLimitMs = 25_000;
  private taskTimer: Phaser.Time.TimerEvent | null = null;
  private locked = false;
  private committedChunkIds: string[] = [];
  private chunkInputs: SentenceChunkAttemptEntry[] = [];
  private canonicalOrder: string[] = [];

  constructor() {
    super(RIVER_JUMP_SCENE_KEY);
  }

  override init(params: RiverJumpSceneInit): void {
    super.init(params);
    if (params.width) this.widthPx = params.width;
    if (params.height) this.heightPx = params.height;
    if (params.inputSource) this.inputSource = params.inputSource;
  }

  protected createBackground(): void {
    const g = this.add.graphics();
    g.fillStyle(0x0e0f12, 1);
    g.fillRect(0, 0, this.widthPx, this.heightPx);
    // Sky band
    g.fillStyle(0x14213d, 1);
    g.fillRect(0, 0, this.widthPx, this.heightPx * 0.45);
    // River band
    g.fillStyle(0x1d3557, 1);
    g.fillRect(0, this.heightPx * 0.5, this.widthPx, this.heightPx * 0.5);
    // Wave lines
    g.lineStyle(2, 0x457b9d, 0.6);
    for (let i = 0; i < 4; i++) {
      const y = this.heightPx * 0.55 + i * 24;
      g.lineBetween(0, y, this.widthPx, y);
    }
    // Banks
    g.fillStyle(0x6a994e, 1);
    g.fillRect(0, this.heightPx * 0.45, 60, this.heightPx * 0.05);
    g.fillRect(this.widthPx - 60, this.heightPx * 0.45, 60, this.heightPx * 0.05);
    this.bgGraphics = g;
  }

  protected createHudLayer(): void {
    this.timerText = this.add.text(this.widthPx - 16, 12, '', {
      fontSize: '20px',
      color: '#94a0b3',
      fontFamily: 'monospace',
    });
    this.timerText.setOrigin(1, 0);

    this.promptText = this.add.text(this.widthPx / 2, 28, '', {
      fontSize: '20px',
      color: '#e9efe9',
      fontFamily: 'sans-serif',
      align: 'center',
      wordWrap: { width: this.widthPx - 80 },
    });
    this.promptText.setOrigin(0.5, 0);

    this.feedbackText = this.add.text(this.widthPx / 2, this.heightPx - 32, '', {
      fontSize: '16px',
      color: '#94a0b3',
      fontFamily: 'sans-serif',
    });
    this.feedbackText.setOrigin(0.5, 1);

    this.inputBufferText = this.add.text(this.widthPx / 2, this.heightPx - 64, '_', {
      fontSize: '22px',
      color: '#6cb9ff',
      fontFamily: 'monospace',
    });
    this.inputBufferText.setOrigin(0.5, 1);

    if (this.inputSource === 'internal' && this.input.keyboard) {
      this.input.keyboard.on('keydown', (event: KeyboardEvent) => {
        this.onKeyDown(event);
      });
    }
    if (this.inputSource === 'external') {
      this.offExternalInput = this.bridge.onExternalInput((event) => {
        this.onExternalInput(event);
      });
    }
    // Phaser's shutdown is an event on `scene.events`, not an overridable method. Hook here so
    // we can drop the external-input listener when the scene tears down.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.offExternalInput) {
        this.offExternalInput();
        this.offExternalInput = null;
      }
    });
  }

  override update(): void {
    if (this.timerText && this.currentTask) {
      const elapsed = this.now() - this.taskStartedAt;
      const remaining = Math.max(0, this.timeLimitMs - elapsed);
      this.timerText.setText(`${(remaining / 1000).toFixed(1)}s`);
    }
  }

  protected spawnTask(task: TrainingTask): void {
    this.clearLanes();
    this.committedChunkIds = [];
    this.chunkInputs = [];
    this.inputBuffer = '';
    this.refreshInputBufferText();
    const chunks = task.expected.chunks ?? [];
    this.canonicalOrder = task.expected.chunkOrder ?? chunks.map((c) => c.id);
    this.timeLimitMs = task.timeLimitMs ?? 25_000;
    this.taskStartedAt = this.now();

    if (this.promptText) {
      this.promptText.setText(task.prompt.sentenceZh ?? task.prompt.meaningZh ?? '');
    }
    if (this.feedbackText) {
      this.feedbackText.setText('打 chunk 的读音 + Enter — 顺序按中文意思');
      this.feedbackText.setColor('#94a0b3');
    }

    // Lay out lily pads in shuffled order across the river band.
    const positions = this.computeLilyPositions(chunks.length);
    const shuffledIndices = shuffleIndices(chunks.length, this.taskStartedAt);
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[shuffledIndices[i]!]!;
      const pos = positions[i]!;
      const ui = this.makeLilyPad(chunk.id, chunk.text, chunk.kana, pos.x, pos.y);
      this.chunkUis.push(ui);
    }

    // Frog on the left bank.
    this.frog = this.makeFrog(30, this.heightPx * 0.48);

    if (this.taskTimer) this.taskTimer.remove(false);
    this.taskTimer = this.time.delayedCall(this.timeLimitMs, () => void this.onTimeout());
  }

  private computeLilyPositions(count: number): Array<{ x: number; y: number }> {
    const margin = 90;
    const usable = this.widthPx - margin * 2;
    const step = count > 1 ? usable / (count - 1) : 0;
    const y = this.heightPx * 0.62;
    const out: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < count; i++) {
      out.push({ x: margin + step * i, y });
    }
    return out;
  }

  private makeLilyPad(id: string, text: string, kana: string, x: number, y: number): ChunkUi {
    const container = this.add.container(x, y);
    const padW = 140;
    const padH = 60;
    const body = this.add.graphics();
    body.fillStyle(0x4ade80, 1);
    body.fillRoundedRect(-padW / 2, -padH / 2, padW, padH, 14);
    body.lineStyle(2, 0x166534, 1);
    body.strokeRoundedRect(-padW / 2, -padH / 2, padW, padH, 14);
    container.add(body);
    const label = this.add.text(0, 0, text, {
      fontSize: '20px',
      color: '#0e0f12',
      fontFamily: 'sans-serif',
    });
    label.setOrigin(0.5, 0.5);
    container.add(label);
    // Bobbing animation gives the river some life.
    const bobTween = this.tweens.add({
      targets: container,
      y: y + 4,
      duration: 1500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    return {
      id,
      text,
      kana,
      container,
      baseX: x,
      baseY: y,
      bobTween,
      consumed: false,
    };
  }

  private makeFrog(x: number, y: number): Phaser.GameObjects.Container {
    const c = this.add.container(x, y);
    const body = this.add.graphics();
    body.fillStyle(0x6cb9ff, 1);
    body.fillCircle(0, 0, 20);
    body.fillStyle(0x0e0f12, 1);
    body.fillCircle(-7, -5, 3);
    body.fillCircle(7, -5, 3);
    c.add(body);
    const label = this.add.text(0, 0, '🐸', {
      fontSize: '20px',
      fontFamily: 'sans-serif',
    });
    label.setOrigin(0.5, 0.5);
    c.add(label);
    return c;
  }

  private clearLanes(): void {
    if (this.taskTimer) {
      this.taskTimer.remove(false);
      this.taskTimer = null;
    }
    for (const ui of this.chunkUis) {
      ui.bobTween?.stop();
      ui.container.destroy();
    }
    this.chunkUis = [];
    if (this.frog) {
      this.frog.destroy();
      this.frog = null;
    }
  }

  private refreshInputBufferText(): void {
    this.inputBufferText?.setText(this.inputBuffer.length > 0 ? this.inputBuffer : '_');
  }

  protected showFeedback(result: EvaluationResult): void {
    if (!this.feedbackText) return;
    if (result.isCorrect) {
      this.feedbackText.setText(`✓ 通过 — ${result.expectedDisplay}`);
      this.feedbackText.setColor('#4ade80');
    } else {
      const tagSummary = result.errorTags.length > 0 ? ` (${result.errorTags.join(', ')})` : '';
      this.feedbackText.setText(
        `✗ ${result.actualDisplay} ≠ ${result.expectedDisplay}${tagSummary}`,
      );
      this.feedbackText.setColor('#f87171');
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

  private onExternalInput(event: ExternalInputEvent): void {
    if (!this.currentTask || this.locked) return;
    if (event.type === 'external.commit') {
      this.inputBuffer = event.value;
      this.refreshInputBufferText();
      void this.commitInput();
    } else {
      // external.cancel
      this.inputBuffer = '';
      this.refreshInputBufferText();
    }
  }

  /**
   * Find every still-on-water chunk whose kana matches the buffered input. Comparison is
   * `compareKana` for kana inputs and `toKanaCandidates` for romaji buffers — same fallback
   * logic as the per-chunk reading evaluator, kept in sync so the scene's recognition matches
   * what the core evaluator will replay.
   */
  private matchingChunks(input: string): ChunkUi[] {
    if (!this.currentTask) return [];
    const trimmed = input.trim();
    if (trimmed.length === 0) return [];
    const matches: ChunkUi[] = [];
    for (const ui of this.chunkUis) {
      if (ui.consumed) continue;
      const directCmp = compareKana(ui.kana, trimmed, this.currentTask.strictness);
      if (directCmp.isAcceptable) {
        matches.push(ui);
        continue;
      }
      const candidates = toKanaCandidates(trimmed, 'mixed');
      let hit = false;
      for (const c of candidates) {
        if (compareKana(ui.kana, c, this.currentTask.strictness).isAcceptable) {
          hit = true;
          break;
        }
      }
      if (hit) matches.push(ui);
    }
    return matches;
  }

  private async commitInput(): Promise<void> {
    if (!this.currentTask || this.locked) return;
    const value = this.inputBuffer;
    if (!value) return;

    const matches = this.matchingChunks(value);
    if (matches.length === 0) {
      this.flashFeedback('reading not recognised — 检查长音/促音/浊音');
      // Keep buffer so user can edit; do NOT advance.
      return;
    }
    // If multiple chunks match (duplicate readings), prefer the canonical-next one if it is
    // among them; otherwise the first match in canonical order.
    let chosen = matches[0]!;
    if (matches.length > 1) {
      const nextCanonical = this.nextCanonicalChunkId();
      if (nextCanonical) {
        const preferred = matches.find((m) => m.id === nextCanonical);
        if (preferred) chosen = preferred;
        else {
          const ordered = [...matches].sort(
            (a, b) => this.canonicalOrder.indexOf(a.id) - this.canonicalOrder.indexOf(b.id),
          );
          chosen = ordered[0]!;
        }
      }
    }

    // Record the reading regardless of order — evaluator replays it.
    this.chunkInputs.push({ chunkId: chosen.id, input: value });
    this.committedChunkIds.push(chosen.id);

    const expectedNext = this.nextCanonicalChunkIdAt(this.committedChunkIds.length - 1);
    const isCanonicalStep = expectedNext === chosen.id;

    this.consumeChunkUi(chosen, isCanonicalStep);
    this.inputBuffer = '';
    this.refreshInputBufferText();

    if (!isCanonicalStep) {
      // Wrong order → splash, fail the entire sentence here. We still submit so the evaluator
      // can record word_order_error and the attempt log keeps the canonical chunkOrder mismatch.
      await this.submitFinal();
      return;
    }

    if (this.committedChunkIds.length === this.canonicalOrder.length) {
      // Every chunk consumed in canonical order → success.
      await this.submitFinal();
    }
  }

  private nextCanonicalChunkId(): string | undefined {
    return this.canonicalOrder[this.committedChunkIds.length];
  }

  private nextCanonicalChunkIdAt(index: number): string | undefined {
    return this.canonicalOrder[index];
  }

  private consumeChunkUi(ui: ChunkUi, isCanonicalStep: boolean): void {
    ui.consumed = true;
    ui.bobTween?.stop();
    if (this.frog) {
      // Frog hops to the lily pad.
      this.tweens.add({
        targets: this.frog,
        x: ui.baseX,
        y: ui.baseY - 24,
        duration: 320,
        ease: 'Cubic.easeOut',
      });
    }
    if (isCanonicalStep) {
      // Brief green pulse.
      this.tweens.add({
        targets: ui.container,
        scale: { from: 1.0, to: 1.15 },
        yoyo: true,
        duration: 180,
      });
      this.flashFeedback(`✓ ${ui.text}`, '#4ade80');
    } else {
      // Splash + sink animation.
      this.tweens.add({
        targets: ui.container,
        y: ui.baseY + 80,
        alpha: 0,
        duration: 480,
        ease: 'Cubic.easeIn',
      });
      this.flashFeedback(`✗ 顺序错 — ${ui.text}`, '#f87171');
    }
  }

  private flashFeedback(text: string, color = '#94a0b3'): void {
    if (!this.feedbackText) return;
    this.feedbackText.setText(text);
    this.feedbackText.setColor(color);
  }

  private async submitFinal(): Promise<void> {
    if (!this.currentTask || this.locked) return;
    const task = this.currentTask;
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
      rawInput: JSON.stringify(this.chunkInputs),
      committedInput: this.chunkInputs.map((e) => e.input).join(' / '),
      chunkOrder: [...this.committedChunkIds],
      startedAt: new Date(this.taskStartedAt).toISOString(),
      submittedAt: new Date(this.now()).toISOString(),
      reactionTimeMs,
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
      rawInput: JSON.stringify(this.chunkInputs),
      committedInput: this.chunkInputs.map((e) => e.input).join(' / '),
      chunkOrder: [...this.committedChunkIds],
      startedAt: new Date(this.taskStartedAt).toISOString(),
      submittedAt: new Date(this.now()).toISOString(),
      reactionTimeMs: this.timeLimitMs,
      usedHint: false,
      inputMethod: this.inputSource === 'external' ? 'ime' : 'romaji',
    };
    try {
      await this.submitAttemptAndAdvance(attempt);
      await new Promise<void>((resolve) => {
        this.time.delayedCall(1300, resolve);
      });
      await this.loadNextTask();
    } finally {
      this.locked = false;
    }
  }
}

function shuffleIndices(n: number, seed: number): number[] {
  const out = Array.from({ length: n }, (_, i) => i);
  // Mulberry32-style deterministic shuffle so a given task lays the same way per spawn.
  let state = seed | 0 || 1;
  const rand = (): number => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function generateId(prefix: string): string {
  const uuid =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${uuid}`;
}
