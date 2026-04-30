import { type JSX } from 'react';

export interface GameHudProps {
  remainingMs: number;
  attemptsCount: number;
  correctCount: number;
}

/**
 * React-side overlay HUD. Phaser draws its own in-canvas timer; this component shows session-
 * level numbers (attempts so far, accuracy) so the user can track progress without Phaser
 * having to pump those values into the Scene's text objects on every render.
 */
export function GameHud(props: GameHudProps): JSX.Element {
  const accuracy = props.attemptsCount === 0 ? 0 : (props.correctCount / props.attemptsCount) * 100;
  return (
    <div
      style={{
        display: 'flex',
        gap: '1.5rem',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0.5rem 1rem',
        margin: '0.5rem auto',
        maxWidth: 800,
        color: 'var(--muted)',
        fontFamily: 'monospace',
      }}
    >
      <span>
        time: <code>{(props.remainingMs / 1000).toFixed(1)}s</code>
      </span>
      <span>
        attempts: <code>{props.attemptsCount}</code>
      </span>
      <span>
        correct: <code>{props.correctCount}</code>
      </span>
      <span>
        accuracy: <code>{accuracy.toFixed(0)}%</code>
      </span>
    </div>
  );
}
