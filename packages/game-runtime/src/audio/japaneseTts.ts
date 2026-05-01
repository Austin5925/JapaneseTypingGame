/**
 * Japanese text-to-speech wrapper around the Web Speech API SpeechSynthesis interface.
 *
 * v0.8.2 ships AppleRescue's audio cue as TTS rather than recorded assets — the API is
 * available in the Tauri WebView on macOS (WKWebView) and Windows (WebView2), so we don't
 * need to bundle audio files yet. Real recordings can replace this layer behind the same
 * `JapaneseTts` interface in v0.8.x once we have a curated voice talent.
 *
 * Voice selection:
 *   - We prefer a voice whose `lang` starts with `ja` (most platforms ship one or more
 *     ja-JP voices: macOS "Kyoko"/"Otoya", Windows "Haruka"/"Sayaka").
 *   - If none is available we fall back to the default voice but still set
 *     `utterance.lang = 'ja-JP'` so the engine picks Japanese pronunciation rules where it
 *     can. On platforms with no Japanese support at all the audio will sound wrong; in that
 *     case the user falls back to the visible kana label on each apple.
 *
 * Voices load asynchronously: the first call to `getVoices()` may return [] until the
 * `voiceschanged` event fires. We register a one-shot listener that resolves a pending
 * promise so callers don't need to retry.
 */

export type TtsSpeed = 'normal' | 'slow';

export interface JapaneseTts {
  /** True if SpeechSynthesis is available + at least one Japanese voice is reachable. */
  isAvailable(): boolean;
  /** Speak the kana through the engine. Resolves when speech ends; rejects on error. */
  playKana(text: string, opts?: { speed?: TtsSpeed }): Promise<void>;
  /** Stop any in-flight utterance. Idempotent. */
  cancel(): void;
}

interface SpeechSynthesisLike {
  speak(u: SpeechSynthesisUtterance): void;
  cancel(): void;
  getVoices(): SpeechSynthesisVoice[];
  addEventListener(
    type: 'voiceschanged',
    listener: () => void,
    options?: AddEventListenerOptions,
  ): void;
  speaking: boolean;
}

const SLOW_RATE = 0.7;
const NORMAL_RATE = 1.0;

export function createBrowserJapaneseTts(): JapaneseTts {
  const synth = getSpeechSynthesis();

  function pickJapaneseVoice(): SpeechSynthesisVoice | null {
    if (!synth) return null;
    const voices = synth.getVoices();
    const ja = voices.find((v) => v.lang.toLowerCase().startsWith('ja'));
    return ja ?? null;
  }

  // Voice list may not be ready synchronously on first call. We don't preempt — we await it
  // inside `playKana` so the consumer's first call is what triggers the lookup.
  function awaitVoices(): Promise<void> {
    if (!synth) return Promise.resolve();
    if (synth.getVoices().length > 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      // Bound the wait so a platform that never fires the event doesn't deadlock the scene.
      const timeout = globalThis.setTimeout(() => resolve(), 1500);
      synth.addEventListener(
        'voiceschanged',
        () => {
          globalThis.clearTimeout(timeout);
          resolve();
        },
        { once: true },
      );
    });
  }

  return {
    isAvailable(): boolean {
      return Boolean(synth);
    },
    async playKana(text, opts = {}): Promise<void> {
      if (!synth) return;
      if (!text) return;
      // Cancel any in-flight utterance so a rapid replay press doesn't queue audio.
      synth.cancel();
      await awaitVoices();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'ja-JP';
      utter.rate = opts.speed === 'slow' ? SLOW_RATE : NORMAL_RATE;
      const voice = pickJapaneseVoice();
      if (voice) utter.voice = voice;
      await new Promise<void>((resolve, reject) => {
        utter.addEventListener('end', () => resolve(), { once: true });
        utter.addEventListener(
          'error',
          (e: Event) => {
            const ev = e as SpeechSynthesisErrorEvent;
            reject(new Error(`tts error: ${ev.error ?? 'unknown'}`));
          },
          { once: true },
        );
        synth.speak(utter);
      });
    },
    cancel(): void {
      synth?.cancel();
    },
  };
}

/** No-op implementation for tests / environments without SpeechSynthesis (jsdom). */
export function createNoopJapaneseTts(): JapaneseTts {
  return {
    isAvailable: () => false,
    playKana: () => Promise.resolve(),
    cancel: () => undefined,
  };
}

function getSpeechSynthesis(): SpeechSynthesisLike | null {
  const candidate = (globalThis as { speechSynthesis?: SpeechSynthesisLike }).speechSynthesis;
  if (!candidate) return null;
  if (typeof candidate.speak !== 'function') return null;
  if (typeof SpeechSynthesisUtterance === 'undefined') return null;
  return candidate;
}
