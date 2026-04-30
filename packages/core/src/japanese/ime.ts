// Helpers that assist input-method-editor (IME) handling. These are framework-agnostic so the
// React hook (`useImeInputController` in apps/desktop) and any future Electron/Phaser variant
// can share the same predicates.

/**
 * Returns true when the event indicates the user is mid-composition (still picking kana/kanji
 * before committing).
 *
 * We can't rely on a single signal across browsers/WebViews:
 *   - Chrome/Edge fire `compositionstart` / `compositionend` cleanly and set
 *     `isComposing` on KeyboardEvent.
 *   - Safari/WebKit (and macOS Tauri WebView) sometimes fire keydown with `keyCode === 229`
 *     during composition without setting `isComposing` reliably.
 *   - Firefox often ships `key === 'Process'` while composing.
 *
 * A defensive check uses all three. We treat unknown/missing fields as "not composing" so that
 * regular keyboard events without a real IME never get swallowed.
 */
export function isLikelyImeComposing(event: ImeProbeEvent): boolean {
  if (event.isComposing === true) return true;
  if (event.keyCode === 229) return true;
  if (event.key === 'Process') return true;
  return false;
}

// Minimal shape we need; the real DOM types extend this. Keep this duck-typed so domain code
// can be unit-tested without `lib.dom`.
export interface ImeProbeEvent {
  isComposing?: boolean;
  keyCode?: number;
  key?: string;
}

/**
 * In IME mode (typing kanji), Enter usually means "accept the current candidate", not "submit".
 * A submit-on-Enter handler must guard with this.
 */
export function isImeAcceptEnter(event: ImeProbeEvent & { key?: string }): boolean {
  return event.key === 'Enter' && isLikelyImeComposing(event);
}
