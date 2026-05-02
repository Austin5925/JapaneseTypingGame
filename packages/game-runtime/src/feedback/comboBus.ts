/**
 * Combo state machine — pure data + tiny event emitter, no Phaser deps. Each game session
 * owns one instance; scenes call `record(isCorrect)` after the bridge returns an evaluation
 * result and subscribers (sfx layer + in-canvas combo bubble) react.
 *
 * Why split this out: the rule "5 in a row = combo level 1, 10 = level 2, …" should not live
 * inside any one scene; if it did, MoleScene's combo would drift from RiverJump's. By centring
 * the state here and threading the bus through `BaseTrainingScene.init`, every game inherits
 * the same combo semantics and a single test suite locks them down.
 *
 * Combo resets to 0 on the first wrong answer of a streak. `peak` is monotonic for the life
 * of the bus — useful for ResultPage's "session peak combo" stat.
 */

export interface ComboState {
  /** Current consecutive-correct streak (resets on any wrong answer). */
  count: number;
  /** Highest streak seen so far on this bus instance. */
  peak: number;
  /** Wall-clock ms of the last `record` call. 0 if never recorded. */
  lastEventAt: number;
}

export type ComboEvent =
  | {
      type: 'increment';
      count: number;
      level: number;
      /** True when the level just crossed an upward threshold — sfx + bubble use this. */
      surge: boolean;
    }
  | {
      type: 'reset';
      previousCount: number;
      peak: number;
    };

export interface ComboBus {
  readonly state: ComboState;
  record(isCorrect: boolean, now?: number): ComboEvent;
  subscribe(handler: (event: ComboEvent) => void): () => void;
  /** Hard-reset between sessions (or between Phaser scene restarts). */
  reset(): void;
}

/**
 * One level is reached every {@link LEVEL_THRESHOLD} consecutive corrects. So count=5 →
 * level 1, count=10 → level 2, etc. `surge` fires only on the boundary that crosses a level.
 */
export const LEVEL_THRESHOLD = 5;

export function comboLevel(count: number): number {
  return Math.floor(count / LEVEL_THRESHOLD);
}

export function createComboBus(): ComboBus {
  const state: ComboState = { count: 0, peak: 0, lastEventAt: 0 };
  const handlers = new Set<(event: ComboEvent) => void>();

  function emit(event: ComboEvent): void {
    // Snapshot so a handler that unsubscribes mid-iteration doesn't break the loop.
    for (const handler of [...handlers]) {
      try {
        handler(event);
      } catch (err) {
        console.warn('ComboBus handler failed', err);
      }
    }
  }

  return {
    get state() {
      return { ...state };
    },
    record(isCorrect, now = Date.now()): ComboEvent {
      state.lastEventAt = now;
      if (isCorrect) {
        const previousLevel = comboLevel(state.count);
        state.count += 1;
        if (state.count > state.peak) state.peak = state.count;
        const nextLevel = comboLevel(state.count);
        const event: ComboEvent = {
          type: 'increment',
          count: state.count,
          level: nextLevel,
          surge: nextLevel > previousLevel,
        };
        emit(event);
        return event;
      }
      const previousCount = state.count;
      state.count = 0;
      const event: ComboEvent = {
        type: 'reset',
        previousCount,
        peak: state.peak,
      };
      emit(event);
      return event;
    },
    subscribe(handler): () => void {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    reset(): void {
      state.count = 0;
      state.peak = 0;
      state.lastEventAt = 0;
    },
  };
}
