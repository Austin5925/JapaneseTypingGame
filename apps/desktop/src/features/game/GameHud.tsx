import { type CSSProperties, type JSX } from 'react';

export interface GameHudProps {
  remainingMs: number;
  attemptsCount: number;
  correctCount: number;
}

/**
 * React-side overlay HUD for the game page. Phaser draws its own in-canvas
 * timer; this row mirrors the session-level numbers (time / attempts /
 * correct / accuracy) above the CRT frame so the user can read them without
 * the scene having to pump them into Phaser text objects every frame.
 *
 * Styled as a retro statusbar (borrowing .r-statusbar segment vocabulary)
 * so it sits comfortably inside the .r-group surrounding the game canvas.
 */
export function GameHud(props: GameHudProps): JSX.Element {
  const accuracy = props.attemptsCount === 0 ? 0 : (props.correctCount / props.attemptsCount) * 100;
  const seconds = props.remainingMs / 1000;
  const timeColor =
    seconds <= 5
      ? 'var(--kt2-danger)'
      : seconds <= 15
        ? 'var(--kt2-accent-2)'
        : 'var(--kt2-accent)';
  const accColor =
    accuracy >= 80
      ? 'var(--kt2-accent)'
      : accuracy >= 60
        ? 'var(--kt2-accent-2)'
        : 'var(--kt2-danger)';

  return (
    <div style={hudWrap}>
      <Seg label="T" value={`${seconds.toFixed(1)}s`} color={timeColor} wide />
      <Seg label="ATT" value={String(props.attemptsCount)} />
      <Seg label="OK" value={String(props.correctCount)} color="var(--kt2-accent)" />
      <Seg label="ACC" value={`${accuracy.toFixed(0)}%`} color={accColor} />
    </div>
  );
}

const hudWrap: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 0,
  padding: '4px 6px',
  background: 'var(--kt2-panel-2)',
  borderStyle: 'solid',
  borderWidth: '1px',
  // Sunken bevel (Win9x): dark on top/left, light on bottom/right
  borderColor: '#050a09 #2e4a44 #2e4a44 #050a09',
};

function Seg({
  label,
  value,
  color,
  wide,
}: {
  label: string;
  value: string;
  color?: string;
  wide?: boolean;
}): JSX.Element {
  return (
    <span
      style={{
        padding: '0 10px',
        height: 22,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        borderLeft: '1px solid #000',
        borderRight: '1px solid #1f2a28',
        fontFamily: 'var(--pix-font)',
        fontSize: 14,
        color: 'var(--kt2-fg-dim)',
        letterSpacing: '0.04em',
        minWidth: wide ? 100 : 70,
      }}
    >
      <span
        style={{
          fontFamily: 'var(--pix-display)',
          fontSize: 8,
          color: 'var(--kt2-fg-dim)',
          letterSpacing: '0.1em',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: 'var(--pix-display)',
          fontSize: 11,
          color: color ?? 'var(--kt2-fg-bright)',
          textShadow: color ? `0 0 4px ${color}` : 'none',
          marginLeft: 'auto',
        }}
      >
        {value}
      </span>
    </span>
  );
}
