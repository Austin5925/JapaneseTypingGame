import type { EvaluationResult, TrainingTask, UserAttempt } from '@kana-typing/core';

import type {
  ExternalInputEvent,
  ExternalInputHandler,
  GameEventHandler,
  GameRuntimeEvent,
  SessionFinishReason,
  Unsubscribe,
} from './gameEvents';

/**
 * Contract between a Phaser Scene and the application layer. The Scene asks for tasks,
 * submits attempts, and emits events; the application supplies tasks (via the task selector),
 * judges attempts (via @kana-typing/core), persists everything (via GameSessionService), and
 * relays events to the React HUD.
 *
 * Critical: this is the *only* surface a Scene calls into. No imports of the desktop
 * app or DB code from inside scenes — they must stay portable to a future web build.
 */
export interface GameBridge {
  emit(event: GameRuntimeEvent): void;
  on<T extends GameRuntimeEvent['type']>(type: T, handler: GameEventHandler<T>): Unsubscribe;
  /** Pull the next task from the task queue. Returns null when the queue is exhausted. */
  requestNextTask(): Promise<TrainingTask | null>;
  /** Submit an attempt; the application evaluates + persists + returns the result. */
  submitAttempt(attempt: UserAttempt): Promise<EvaluationResult>;
  /** Close the session. The application flushes buffered attempts and writes the final row. */
  finishSession(reason: SessionFinishReason): Promise<void>;
  /**
   * App→Scene reverse channel. The React layer calls `emitExternalInput` to push an
   * externally-sourced input value (e.g. an IME-finalised string from `<ImeInputBox>`) into
   * the active Scene; the Scene subscribes via `onExternalInput`. Lets us run an OS-level IME
   * outside the Phaser canvas without the Scene knowing where the bytes came from.
   */
  emitExternalInput(event: ExternalInputEvent): void;
  onExternalInput(handler: ExternalInputHandler): Unsubscribe;
}

/**
 * Adapter callbacks the application provides. Keeping them as a record (instead of importing
 * GameSessionService directly) means game-runtime stays decoupled from the desktop app — the
 * same scene code will work in a browser-only build.
 */
export interface GameBridgeAdapter {
  requestNextTask: () => Promise<TrainingTask | null>;
  submitAttempt: (attempt: UserAttempt) => Promise<EvaluationResult>;
  finishSession: (reason: SessionFinishReason) => Promise<void>;
}

interface Listener<T extends GameRuntimeEvent['type']> {
  type: T;
  handler: GameEventHandler<T>;
}

/**
 * Default in-process implementation. Maintains a Set of listeners per event type and forwards
 * task / attempt / finish requests to the supplied adapter. The application creates one
 * GameBridgeImpl per session.
 */
export class GameBridgeImpl implements GameBridge {
  // Internal stores: typed `unknown` because TS can't express the per-key handler shape on a
  // single Map<string, Set<...>>; each `on()` call narrows the handler appropriately and the
  // public `on/emit` API hides the cast.
  private readonly listeners = new Map<
    GameRuntimeEvent['type'],
    Set<Listener<GameRuntimeEvent['type']>>
  >();
  private readonly externalListeners = new Set<ExternalInputHandler>();

  constructor(private readonly adapter: GameBridgeAdapter) {}

  emit(event: GameRuntimeEvent): void {
    const set = this.listeners.get(event.type);
    if (!set) return;
    // Snapshot so a listener that unsubscribes mid-iteration doesn't break us.
    const snapshot = [...set];
    for (const l of snapshot) {
      // Cast: the listener was registered against this type; emit() narrows by `event.type`.
      try {
        (l.handler as (e: GameRuntimeEvent) => void)(event);
      } catch (err) {
        console.warn('GameBridge listener failed', err);
      }
    }
  }

  on<T extends GameRuntimeEvent['type']>(type: T, handler: GameEventHandler<T>): Unsubscribe {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    const listener = { type, handler } as unknown as Listener<GameRuntimeEvent['type']>;
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  requestNextTask(): Promise<TrainingTask | null> {
    return this.adapter.requestNextTask();
  }

  submitAttempt(attempt: UserAttempt): Promise<EvaluationResult> {
    return this.adapter.submitAttempt(attempt);
  }

  finishSession(reason: SessionFinishReason): Promise<void> {
    return this.adapter.finishSession(reason);
  }

  emitExternalInput(event: ExternalInputEvent): void {
    // Snapshot so a listener that unsubscribes mid-iteration doesn't break us — same pattern
    // as the regular event channel above.
    const snapshot = [...this.externalListeners];
    for (const handler of snapshot) {
      try {
        handler(event);
      } catch (err) {
        console.warn('GameBridge external listener failed', err);
      }
    }
  }

  onExternalInput(handler: ExternalInputHandler): Unsubscribe {
    this.externalListeners.add(handler);
    return () => {
      this.externalListeners.delete(handler);
    };
  }
}
