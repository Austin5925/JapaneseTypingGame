import { type JSX } from 'react';

import { useImeInputController, type ImeInputControllerOptions } from './useImeInputController';

export interface ImeInputBoxProps extends ImeInputControllerOptions {
  /** placeholder text */
  placeholder?: string;
  /** disabled state */
  disabled?: boolean;
  /** Stable id for testing/labels */
  id?: string;
  /** When true, expose a small "compose" indicator so testers can verify IME is engaged. */
  showComposeIndicator?: boolean;
}

/**
 * A controlled text input wired through `useImeInputController`. Exposes the composition state
 * visually (optional) so testers can confirm the IME is being honoured. Game scenes wrap their
 * own variant of this — Mole/SpeedChase will hide the input visually but keep focus.
 */
export function ImeInputBox(props: ImeInputBoxProps): JSX.Element {
  const { placeholder, disabled, id, showComposeIndicator, ...controllerOptions } = props;
  const ctl = useImeInputController(controllerOptions);
  return (
    <div
      style={{
        display: 'flex',
        gap: '0.5rem',
        alignItems: 'center',
        width: '100%',
      }}
    >
      <input
        {...ctl.inputProps}
        id={id}
        type="text"
        placeholder={placeholder}
        disabled={disabled}
        autoCapitalize="off"
        autoComplete="off"
        spellCheck={false}
        style={{
          flex: 1,
          padding: '0.5rem 0.75rem',
          background: 'rgba(255,255,255,0.05)',
          color: 'var(--fg)',
          border: `1px solid ${ctl.state.isComposing ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: 6,
          font: 'inherit',
        }}
      />
      {showComposeIndicator && (
        <span
          style={{
            color: ctl.state.isComposing ? 'var(--accent)' : 'var(--muted)',
            fontSize: '0.85em',
            minWidth: '8ch',
          }}
        >
          {ctl.state.isComposing ? `composing: ${ctl.state.composingValue}` : 'idle'}
        </span>
      )}
    </div>
  );
}
