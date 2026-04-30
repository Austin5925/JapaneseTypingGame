import Phaser from 'phaser';

import type { GameBridge } from './bridge/GameBridge';
import { MoleScene, MOLE_SCENE_KEY } from './scenes/MoleScene';
import { SpeedChaseScene, SPEED_CHASE_SCENE_KEY } from './scenes/SpeedChaseScene';

export interface PhaserGameManagerOptions {
  parent: HTMLElement;
  width?: number;
  height?: number;
  /**
   * Force a specific Phaser renderer. Default `Phaser.AUTO` lets it pick WebGL with a Canvas
   * fallback; tests using jsdom should pass `Phaser.HEADLESS` or destroy the game manually.
   */
  rendererType?: number;
}

export interface StartSessionOptions {
  bridge: GameBridge;
  sessionId: string;
}

/**
 * Owns the single Phaser.Game instance for the desktop app. The manager is created once when
 * the canvas mounts and destroyed on unmount; callers route to specific scenes via
 * `startMoleScene(...)`. Sprint 3 ships only MoleScene; later sprints register more scenes
 * with the same manager.
 */
export class PhaserGameManager {
  private game: Phaser.Game | null = null;
  private readonly options: Required<PhaserGameManagerOptions>;

  constructor(options: PhaserGameManagerOptions) {
    this.options = {
      parent: options.parent,
      width: options.width ?? 800,
      height: options.height ?? 480,
      rendererType: options.rendererType ?? Phaser.AUTO,
    };
  }

  start(): void {
    if (this.game) return;
    this.game = new Phaser.Game({
      type: this.options.rendererType,
      parent: this.options.parent,
      width: this.options.width,
      height: this.options.height,
      backgroundColor: '#0e0f12',
      scene: [MoleScene, SpeedChaseScene],
      scale: {
        mode: Phaser.Scale.NONE,
      },
      // Disable banner clutter in dev console; production build won't print it anyway.
      banner: false,
    });
  }

  startMoleScene(opts: StartSessionOptions): void {
    this.startScene(MOLE_SCENE_KEY, opts);
  }

  startSpeedChaseScene(opts: StartSessionOptions): void {
    this.startScene(SPEED_CHASE_SCENE_KEY, opts);
  }

  /**
   * Generic scene-start hook. The scene `key` must already be registered with the underlying
   * Phaser.Game (see the `scene: [...]` array in the `start()` config). Phaser silently
   * no-ops if the key is not registered, which is a footgun — the registration array above
   * is the source of truth.
   */
  startScene(key: string, opts: StartSessionOptions): void {
    if (!this.game) throw new Error('PhaserGameManager.start() must be called before scene start');
    this.game.scene.start(key, opts);
  }

  destroy(): void {
    if (!this.game) return;
    // `true` removes the canvas. Phaser leaves it parented to options.parent otherwise, which
    // the React unmount path is about to delete anyway, but explicit is better here.
    this.game.destroy(true);
    this.game = null;
  }

  get isRunning(): boolean {
    return this.game !== null;
  }
}
