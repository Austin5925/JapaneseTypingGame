import { ALL_ERROR_TAGS, type ErrorTag } from '@kana-typing/core';
import { type CSSProperties, type JSX } from 'react';

import { ERROR_TAG_COLOR_VARS, ERROR_TAG_LABEL_ZH } from './errorTagPalette';

export interface ErrorTagChipProps {
  /**
   * Accept a raw string here (not the strict ErrorTag union) because Tauri
   * row payloads are typed as `string[]` until the Zod boundary parsing in
   * P1-1 lands. Unknown tags render as the slate "unknown" colour with the
   * raw string as the label, which keeps the chip safe even if the backend
   * adds a new tag the frontend hasn't been rebuilt against yet.
   */
  tag: string;
  /** Optional CSS overrides (margin, etc.) — colour is driven by the palette. */
  style?: CSSProperties;
}

function isKnownErrorTag(t: string): t is ErrorTag {
  // ALL_ERROR_TAGS is the source-of-truth list exported by @kana-typing/core;
  // checking against it (instead of `in ERROR_TAG_COLOR_VARS`) lets TS narrow
  // `t` to ErrorTag inside the type guard.
  return (ALL_ERROR_TAGS as readonly string[]).includes(t);
}

/**
 * Inline chip that renders an {@link ErrorTag} with its mapped colour and
 * Chinese label. Built on `.kt-tag` from styles.css; the colour and border
 * are pulled from {@link ERROR_TAG_COLOR_VARS}. Unknown tags fall through to
 * the slate "unknown" colour with the raw string as the label.
 */
export function ErrorTagChip(props: ErrorTagChipProps): JSX.Element {
  // Destructure into a local so the type guard narrows the local var (TS
  // doesn't narrow through `props.x` references).
  const { tag } = props;
  let colour: string;
  let label: string;
  if (isKnownErrorTag(tag)) {
    colour = ERROR_TAG_COLOR_VARS[tag];
    label = ERROR_TAG_LABEL_ZH[tag];
  } else {
    colour = 'var(--tag-unknown)';
    label = tag;
  }
  return (
    <span
      className="kt-tag"
      style={{
        color: colour,
        borderColor: colour,
        background: 'transparent',
        ...props.style,
      }}
    >
      {label}
    </span>
  );
}
