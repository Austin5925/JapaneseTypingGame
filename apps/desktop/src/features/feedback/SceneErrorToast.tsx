import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type JSX,
  type ReactNode,
} from 'react';

/**
 * v0.8.10: SceneErrorToast lives at the App layer instead of being plumbed through every game
 * page. The `<SceneErrorToastProvider>` mounts once near the root; `<SceneErrorToastSlot>`
 * renders the actual banner; any component (notably `GameCanvasHost`) calls
 * `useReportSceneError()` to push a message — the slot picks it up via context.
 *
 * Previously each game page repeated `useSceneErrorToast()` + threaded `onSceneError` into
 * GameCanvasHost. That duplication ran into "did I add the toast to this new page" bugs every
 * time a game shipped. This hoist flattens the wiring to one provider + one slot.
 */

interface SceneErrorToastState {
  id: number;
  message: string;
}

interface SceneErrorContextValue {
  /** Standalone function (not a method) so detaching it from the context object is safe. */
  show: (message: string) => void;
}

const SceneErrorContext = createContext<SceneErrorContextValue | null>(null);

export interface SceneErrorToastProviderProps {
  /** Auto-dismiss delay in ms. Defaults to 3000. */
  timeoutMs?: number;
  children: ReactNode;
}

export function SceneErrorToastProvider({
  timeoutMs = 3000,
  children,
}: SceneErrorToastProviderProps): JSX.Element {
  const [toast, setToast] = useState<SceneErrorToastState | null>(null);

  const show = useCallback((message: string): void => {
    setToast({ id: Date.now(), message });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const handle = globalThis.setTimeout(() => setToast(null), timeoutMs);
    return () => globalThis.clearTimeout(handle);
  }, [toast, timeoutMs]);

  // Memoise context value so unrelated re-renders don't reset hooks downstream.
  const value = useMemo<SceneErrorContextValue>(() => ({ show }), [show]);

  return (
    <SceneErrorContext.Provider value={value}>
      {children}
      {toast ? <SceneErrorToast message={toast.message} onDismiss={() => setToast(null)} /> : null}
    </SceneErrorContext.Provider>
  );
}

/**
 * Hook used by GameCanvasHost (and any other component that observes scene runtime errors).
 * Returns a stable `showSceneError(message)` callback. Returns a noop when no provider is in
 * the tree — useful for unit tests that mount components in isolation.
 */
export function useReportSceneError(): (message: string) => void {
  const ctx = useContext(SceneErrorContext);
  if (!ctx) return noop;
  return ctx.show;
}

function noop(): void {
  // intentional: no-provider fallback
}

export function SceneErrorToast({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}): JSX.Element {
  return (
    <div role="status" aria-live="polite" style={toastStyle}>
      <span
        style={{ fontFamily: 'var(--pix-display)', fontSize: 11, color: 'var(--kt2-accent-2)' }}
      >
        SCENE WARN
      </span>
      <span style={{ flex: 1 }}>{message}</span>
      <button className="r-btn" type="button" onClick={onDismiss} style={{ padding: '1px 7px' }}>
        ×
      </button>
    </div>
  );
}

const toastStyle: CSSProperties = {
  position: 'fixed',
  right: 18,
  bottom: 18,
  zIndex: 1000,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  maxWidth: 420,
  padding: '8px 10px',
  color: 'var(--kt2-fg-bright)',
  background: 'rgba(47, 35, 15, 0.96)',
  border: '1px solid var(--kt2-accent-2)',
  boxShadow: '0 0 16px rgba(255, 196, 87, 0.2)',
  fontFamily: 'var(--pix-font)',
  fontSize: 12,
};
