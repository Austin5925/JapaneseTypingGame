// @vitest-environment jsdom

import { act, type JSX } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useSceneErrorToast } from './SceneErrorToast';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function Harness(): JSX.Element {
  const sceneError = useSceneErrorToast();
  return (
    <div>
      <button type="button" onClick={() => sceneError.showSceneError('feedback failed')}>
        show
      </button>
      {sceneError.sceneErrorToast}
    </div>
  );
}

describe('SceneErrorToast', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('shows a scene error and auto-dismisses after 3 seconds', () => {
    vi.useFakeTimers();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    act(() => {
      root.render(<Harness />);
    });
    const button = document.querySelector('button');
    expect(button).not.toBeNull();

    act(() => {
      button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(document.body.textContent).toContain('feedback failed');

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(document.body.textContent).not.toContain('feedback failed');

    act(() => {
      root.unmount();
    });
  });
});
