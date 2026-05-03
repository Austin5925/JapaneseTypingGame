// @vitest-environment jsdom

import { act, type JSX } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SceneErrorToastProvider, useReportSceneError } from './SceneErrorToast';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function Reporter(): JSX.Element {
  const report = useReportSceneError();
  return (
    <button type="button" onClick={() => report('feedback failed')}>
      show
    </button>
  );
}

describe('SceneErrorToast', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('provider surfaces a reporter that triggers the toast and auto-dismisses', () => {
    vi.useFakeTimers();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    act(() => {
      root.render(
        <SceneErrorToastProvider>
          <Reporter />
        </SceneErrorToastProvider>,
      );
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

  it('useReportSceneError without a provider is a noop (does not throw)', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(<Reporter />);
    });
    const button = document.querySelector('button');
    expect(button).not.toBeNull();
    act(() => {
      button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    // No provider → no toast rendered, but the click handler must not throw.
    expect(document.body.textContent).not.toContain('feedback failed');
    act(() => {
      root.unmount();
    });
  });
});
