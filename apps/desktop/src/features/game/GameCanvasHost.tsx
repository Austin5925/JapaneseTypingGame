import {
  GameBridgeImpl,
  PhaserGameManager,
  type GameBridgeAdapter,
} from '@kana-typing/game-runtime';
import { useEffect, useRef, type JSX, type RefObject } from 'react';

// Scene keys are string literals defined inside game-runtime; we mirror them here as a union
// type so callers stay typed without importing the runtime constants (which the lint
// type-only-imports rule then complains about).
export type GameSceneKey = 'MoleScene' | 'SpeedChaseScene' | 'RiverJumpScene';

/**
 * Handle the host wires into a parent-supplied ref so the React layer can push externally
 * sourced input (e.g. an IME-finalised string from `<ImeInputBox>`) into the scene without
 * the parent having to know about GameBridge or the Phaser instance.
 */
export interface GameCanvasExternalInputControl {
  commit(value: string): void;
  cancel(): void;
}

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
  /**
   * Extra scene init parameters merged into the standard `{ bridge, sessionId }` payload.
   * Use this to pass scene-specific knobs like `{ inputSource: 'external' }` for
   * SpeedChaseScene's IME mode.
   */
  sceneInit?: Record<string, unknown>;
  /**
   * If supplied, the host populates `current` with `{ commit, cancel }` once the scene starts
   * and clears it on unmount. The parent calls `current?.commit(value)` from its IME input
   * handler to drive the active scene.
   */
  externalInputRef?: RefObject<GameCanvasExternalInputControl | null>;
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
    manager.startScene(
      props.sceneKey,
      { bridge, sessionId: props.sessionId },
      props.sceneInit ?? {},
    );
    managerRef.current = manager;

    // Expose external-input controls now that the bridge exists. We keep the ref param stable
    // across renders (parent passes a useRef'd object), so it's safe to write directly.
    const externalRef = props.externalInputRef;
    if (externalRef) {
      externalRef.current = {
        commit: (value: string): void => {
          bridge.emitExternalInput({ type: 'external.commit', value });
        },
        cancel: (): void => {
          bridge.emitExternalInput({ type: 'external.cancel' });
        },
      };
    }

    return () => {
      offFinish();
      manager.destroy();
      managerRef.current = null;
      bridgeRef.current = null;
      if (externalRef) {
        externalRef.current = null;
      }
    };
    // We only want this to run on initial mount + (sessionId, sceneKey) change. The adapter
    // prop is observed via the ref above so swapping it doesn't re-mount the game. sceneInit
    // changes are intentionally not tracked — re-mounting on every init tweak would tear the
    // session down; if the caller needs different sceneInit values they should change the
    // sessionId/sceneKey or remount via a `key=` prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.sessionId, props.sceneKey]);

  return (
    <div
      ref={containerRef}
      style={{
        // Explicit min-size as well as size — without min-* a flex parent
        // (notably .r-crt) can shrink the container below its declared
        // dimensions, which Phaser then mirrors to the <canvas> CSS box and
        // the prompt text + sprite renders look squashed/clipped.
        width: props.width ?? 800,
        height: props.height ?? 480,
        minWidth: props.width ?? 800,
        minHeight: props.height ?? 480,
        background: '#0e0f12',
        flexShrink: 0,
        flexGrow: 0,
      }}
    />
  );
}
