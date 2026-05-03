import { useCallback, useEffect, useState, type CSSProperties, type JSX } from 'react';

export interface SceneErrorToastApi {
  showSceneError(message: string): void;
  sceneErrorToast: JSX.Element | null;
}

interface SceneErrorToastState {
  id: number;
  message: string;
}

export function useSceneErrorToast(timeoutMs = 3000): SceneErrorToastApi {
  const [toast, setToast] = useState<SceneErrorToastState | null>(null);

  const showSceneError = useCallback((message: string): void => {
    setToast({ id: Date.now(), message });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const handle = globalThis.setTimeout(() => setToast(null), timeoutMs);
    return () => globalThis.clearTimeout(handle);
  }, [toast, timeoutMs]);

  return {
    showSceneError,
    sceneErrorToast: toast ? (
      <SceneErrorToast message={toast.message} onDismiss={() => setToast(null)} />
    ) : null,
  };
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
