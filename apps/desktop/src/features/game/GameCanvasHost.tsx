import {
  GameBridgeImpl,
  PhaserGameManager,
  type GameBridgeAdapter,
} from '@kana-typing/game-runtime';
import { useEffect, useRef, type JSX } from 'react';

// Scene keys are string literals defined inside game-runtime; we mirror them here as a union
// type so callers stay typed without importing the runtime constants (which the lint
// type-only-imports rule then complains about).
export type GameSceneKey = 'MoleScene' | 'SpeedChaseScene';

export interface GameCanvasHostProps {
  sessionId: string;
  /** Which Phaser scene to start. */
  sceneKey: GameSceneKey;
  adapter: GameBridgeAdapter;
  /** Phaser game width / height. Defaults to 800x480. */
  width?: number;
  height?: number;
  /** Fired when the scene reports session.finished. */
  onSessionFinished?: () => void;
}

/**
 * React mount point for the Phaser game. Lives in apps/desktop because it knows about Tauri
 * + the GameSessionService; the actual Phaser scenes live in `@kana-typing/game-runtime` and
 * stay browser-portable.
 *
 * The host owns one PhaserGameManager + one GameBridge per mount. Unmount destroys the game,
 * so React StrictMode double-mount in dev creates two consecutive game instances — that's
 * intentional and matches Phaser's expected lifecycle.
 */
export function GameCanvasHost(props: GameCanvasHostProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const managerRef = useRef<PhaserGameManager | null>(null);
  const bridgeRef = useRef<GameBridgeImpl | null>(null);
  const adapterRef = useRef(props.adapter);
  // Keep adapter ref in sync without re-mounting Phaser.
  adapterRef.current = props.adapter;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Wrap the adapter so the bridge always reads the latest props.adapter without tearing
    // the game down on every prop change.
    const stableAdapter: GameBridgeAdapter = {
      requestNextTask: () => adapterRef.current.requestNextTask(),
      submitAttempt: (a) => adapterRef.current.submitAttempt(a),
      finishSession: (r) => adapterRef.current.finishSession(r),
    };
    const bridge = new GameBridgeImpl(stableAdapter);
    bridgeRef.current = bridge;

    const offFinish = bridge.on('session.finished', () => {
      props.onSessionFinished?.();
    });

    const manager = new PhaserGameManager({
      parent: container,
      ...(props.width !== undefined && { width: props.width }),
      ...(props.height !== undefined && { height: props.height }),
    });
    manager.start();
    manager.startScene(props.sceneKey, { bridge, sessionId: props.sessionId });
    managerRef.current = manager;

    return () => {
      offFinish();
      manager.destroy();
      managerRef.current = null;
      bridgeRef.current = null;
    };
    // We only want this to run on initial mount + (sessionId, sceneKey) change. The adapter
    // prop is observed via the ref above so swapping it doesn't re-mount the game.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.sessionId, props.sceneKey]);

  return (
    <div
      ref={containerRef}
      style={{
        width: props.width ?? 800,
        height: props.height ?? 480,
        margin: '0 auto',
        background: '#0e0f12',
        border: '1px solid var(--border)',
        borderRadius: 8,
      }}
    />
  );
}
