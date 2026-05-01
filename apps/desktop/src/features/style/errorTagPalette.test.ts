import { ALL_ERROR_TAGS } from '@kana-typing/core';
import { describe, expect, it } from 'vitest';

import { ERROR_TAG_COLOR_VARS, ERROR_TAG_LABEL_ZH } from './errorTagPalette';

describe('errorTagPalette', () => {
  it('covers every ErrorTag in ALL_ERROR_TAGS', () => {
    for (const tag of ALL_ERROR_TAGS) {
      expect(ERROR_TAG_COLOR_VARS[tag], `colour for ${tag}`).toBeTruthy();
      expect(ERROR_TAG_LABEL_ZH[tag], `label for ${tag}`).toBeTruthy();
    }
  });

  it('points every colour at a CSS variable defined in styles.css', () => {
    for (const value of Object.values(ERROR_TAG_COLOR_VARS)) {
      expect(value).toMatch(/^var\(--tag-/);
    }
  });

  it('keeps every label short enough for an inline chip (≤ 6 chars)', () => {
    for (const label of Object.values(ERROR_TAG_LABEL_ZH)) {
      // Mixed CJK + ASCII; 6 chars is comfortable in a 22px-tall chip without
      // breaking lines on common widths.
      expect(label.length).toBeLessThanOrEqual(6);
    }
  });
});
