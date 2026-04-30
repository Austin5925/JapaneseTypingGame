import { isLikelyImeComposing } from '@kana-typing/core';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CompositionEvent,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';

export interface ImeInputState {
  rawValue: string;
  composingValue: string;
  isComposing: boolean;
  lastCommittedValue?: string;
}

export interface ImeInputControllerOptions {
  /** romaji = strict romaji input (composing should never set), ime_surface = full IME */
  mode: 'romaji' | 'ime_surface';
  /** Auto-fire `onCommit` when the user presses Enter (and is not mid-composition). */
  autoSubmitOnEnter?: boolean;
  /** Called when the user explicitly commits (Enter or programmatic). Receives the raw value. */
  onCommit: (value: string) => void;
  /** Called on every input/composition state change. Useful for live HUD. */
  onChange?: (state: ImeInputState) => void;
  /** Initial value, e.g. when resuming a session. */
  initialValue?: string;
}

export interface ImeInputControllerHandle {
  /** Bind these to a controlled `<input>` element. */
  inputProps: {
    ref: RefObject<HTMLInputElement | null>;
    value: string;
    onChange: (e: FormEvent<HTMLInputElement>) => void;
    onCompositionStart: (e: CompositionEvent<HTMLInputElement>) => void;
    onCompositionUpdate: (e: CompositionEvent<HTMLInputElement>) => void;
    onCompositionEnd: (e: CompositionEvent<HTMLInputElement>) => void;
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  };
  state: ImeInputState;
  /** Programmatic commit. The handler calls `options.onCommit` and clears the field. */
  commit: () => void;
  reset: () => void;
  focus: () => void;
}

/**
 * IME-safe input controller.
 *
 * Why not just use a controlled input + onKeyDown:
 *   - During Japanese IME composition, every keystroke fires keydown but the typed kanji is
 *     not yet in `value`. Submitting on Enter mid-composition would commit the wrong text.
 *   - `compositionend` fires once the candidate is accepted; only then is `value` final.
 *   - Some WebViews (Tauri WebView on macOS, in particular) re-fire keydown with `keyCode 229`
 *     during composition without setting `event.isComposing`. We use the shared
 *     `isLikelyImeComposing` heuristic from @kana-typing/core to cover all three browsers.
 *   - Enter mid-composition is the IME's "accept candidate" gesture, not "submit form".
 *     We swallow it by guarding `onCommit` with `state.isComposing`.
 *
 * Tested: this hook itself is exercised through the apps/desktop /dev/input page; deeper unit
 * tests sit in @kana-typing/core (the Japanese helpers) and Sprint 1 keeps the React layer
 * minimal so the hook is mostly orchestration.
 */
export function useImeInputController(
  options: ImeInputControllerOptions,
): ImeInputControllerHandle {
  const { autoSubmitOnEnter = true, mode, initialValue = '', onChange, onCommit } = options;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [state, setState] = useState<ImeInputState>({
    rawValue: initialValue,
    composingValue: '',
    isComposing: false,
  });
  // We keep a mutable mirror of `state.isComposing` so the keydown handler can observe the
  // latest composition state without re-creating the callback every render — both Phaser and
  // some keyboard libraries dislike rapidly-changing handlers.
  const composingRef = useRef(false);

  useEffect(() => {
    onChange?.(state);
  }, [state, onChange]);

  const updateValue = useCallback((value: string) => {
    setState((s) => ({ ...s, rawValue: value }));
  }, []);

  const onChangeInput = useCallback(
    (e: FormEvent<HTMLInputElement>) => {
      updateValue(e.currentTarget.value);
    },
    [updateValue],
  );

  const onCompositionStart = useCallback((e: CompositionEvent<HTMLInputElement>) => {
    composingRef.current = true;
    setState((s) => ({ ...s, isComposing: true, composingValue: e.data ?? '' }));
  }, []);

  const onCompositionUpdate = useCallback((e: CompositionEvent<HTMLInputElement>) => {
    setState((s) => ({ ...s, composingValue: e.data ?? '' }));
  }, []);

  const onCompositionEnd = useCallback((e: CompositionEvent<HTMLInputElement>) => {
    composingRef.current = false;
    const value = e.currentTarget.value;
    setState((s) => ({
      ...s,
      isComposing: false,
      composingValue: '',
      rawValue: value,
      lastCommittedValue: value,
    }));
  }, []);

  const commit = useCallback(() => {
    setState((s) => {
      onCommit(s.rawValue);
      return { ...s, rawValue: '', composingValue: '', isComposing: false };
    });
  }, [onCommit]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      // Romaji mode: never honour mid-composition signals; the user is supposed to be typing
      // ASCII and any IME interference is operator error. Treat like a normal text input.
      if (mode === 'ime_surface') {
        if (composingRef.current) return;
        if (
          isLikelyImeComposing({
            isComposing: e.nativeEvent.isComposing,
            keyCode: e.keyCode,
            key: e.key,
          })
        ) {
          return;
        }
      }
      if (autoSubmitOnEnter && e.key === 'Enter') {
        e.preventDefault();
        commit();
      }
    },
    [mode, autoSubmitOnEnter, commit],
  );

  const reset = useCallback(() => {
    setState({ rawValue: '', composingValue: '', isComposing: false });
    composingRef.current = false;
  }, []);

  const focus = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  return {
    state,
    commit,
    reset,
    focus,
    inputProps: {
      ref: inputRef,
      value: state.rawValue,
      onChange: onChangeInput,
      onCompositionStart,
      onCompositionUpdate,
      onCompositionEnd,
      onKeyDown,
    },
  };
}
