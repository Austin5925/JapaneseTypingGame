import { describe, expect, it } from 'vitest';

import { isImeAcceptEnter, isLikelyImeComposing } from '../../src/japanese/ime';

describe('isLikelyImeComposing', () => {
  it('recognises explicit isComposing=true (Chrome/Edge)', () => {
    expect(isLikelyImeComposing({ isComposing: true })).toBe(true);
  });

  it('recognises keyCode 229 (Safari/WebKit IME signal)', () => {
    expect(isLikelyImeComposing({ keyCode: 229 })).toBe(true);
  });

  it('recognises key="Process" (Firefox IME signal)', () => {
    expect(isLikelyImeComposing({ key: 'Process' })).toBe(true);
  });

  it('returns false for a normal keystroke', () => {
    expect(isLikelyImeComposing({ key: 'a', keyCode: 65, isComposing: false })).toBe(false);
  });

  it('returns false for an empty event', () => {
    expect(isLikelyImeComposing({})).toBe(false);
  });
});

describe('isImeAcceptEnter', () => {
  it('flags Enter while composing (IME accept-candidate, not submit)', () => {
    expect(isImeAcceptEnter({ key: 'Enter', isComposing: true })).toBe(true);
  });

  it('does not flag Enter when not composing', () => {
    expect(isImeAcceptEnter({ key: 'Enter', isComposing: false })).toBe(false);
  });

  it('does not flag non-Enter keys while composing', () => {
    expect(isImeAcceptEnter({ key: 'a', isComposing: true })).toBe(false);
  });
});
