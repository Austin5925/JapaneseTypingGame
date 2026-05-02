/**
 * 8-bit-flavoured sound effects synthesised via Web Audio. No asset bundle — every cue is a
 * tiny oscillator + gain envelope built on demand. v0.8.5 ships the minimum set the
 * BaseTrainingScene combo + countdown hooks need; richer chip-tune palettes can layer on
 * later behind the same `Sfx` interface.
 *
 * Web Audio policy quirk: AudioContext starts `suspended` until the first user gesture in
 * the page. That's why we lazy-create the context inside `play()` rather than at module load,
 * and call `ctx.resume()` (no-op when already running). On Tauri's WebView the first arrow
 * key / number key in any scene satisfies the gesture requirement.
 */

export type SfxCue = 'correct' | 'wrong' | 'tick' | 'combo' | 'perfect';

export interface Sfx {
  /** True when the underlying engine could be reached. */
  isAvailable(): boolean;
  /** Fire-and-forget cue. `level` only meaningful for `'combo'` (default 1). */
  play(cue: SfxCue, opts?: { level?: number }): void;
  /** Forcibly stop / suspend any in-flight envelopes. Idempotent. */
  cancel(): void;
}

interface AudioContextLike {
  readonly currentTime: number;
  readonly destination: AudioNode;
  state: AudioContextState;
  createOscillator(): OscillatorNode;
  createGain(): GainNode;
  resume(): Promise<void>;
}

const MASTER_GAIN = 0.05; // keep cues quiet — they're feedback, not music
const PERFECT_NOTES_HZ = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6

export function createBrowserSfx(): Sfx {
  // Lazily resolve AudioContext. We hold a single instance across calls so successive cues
  // don't thrash the engine (each `new AudioContext` allocates an audio graph).
  let ctx: AudioContextLike | null = null;
  let unavailable = false;

  function ensureContext(): AudioContextLike | null {
    if (ctx) return ctx;
    if (unavailable) return null;
    const Ctor = resolveAudioContextCtor();
    if (!Ctor) {
      unavailable = true;
      return null;
    }
    try {
      ctx = new Ctor();
      return ctx;
    } catch (err) {
      console.warn('[sfx] AudioContext init failed', err);
      unavailable = true;
      return null;
    }
  }

  function tone(
    c: AudioContextLike,
    freqHz: number,
    durationS: number,
    type: OscillatorType,
    startAt: number,
    gainPeak = MASTER_GAIN,
  ): void {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqHz, startAt);
    // Quick attack, exponential decay — gives that staccato 8-bit pluck.
    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(gainPeak, startAt + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + durationS);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(startAt);
    osc.stop(startAt + durationS + 0.02);
  }

  function sweep(
    c: AudioContextLike,
    fromHz: number,
    toHz: number,
    durationS: number,
    type: OscillatorType,
    startAt: number,
  ): void {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(fromHz, startAt);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, toHz), startAt + durationS);
    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(MASTER_GAIN, startAt + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + durationS);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(startAt);
    osc.stop(startAt + durationS + 0.02);
  }

  function play(cue: SfxCue, opts: { level?: number } = {}): void {
    const c = ensureContext();
    if (!c) return;
    if (c.state === 'suspended') {
      void c.resume().catch(() => undefined);
    }
    const t0 = c.currentTime;
    switch (cue) {
      case 'correct':
        tone(c, 880, 0.06, 'square', t0);
        tone(c, 1175, 0.07, 'square', t0 + 0.05);
        return;
      case 'wrong':
        sweep(c, 220, 110, 0.22, 'sawtooth', t0);
        return;
      case 'tick':
        tone(c, 1320, 0.05, 'square', t0, MASTER_GAIN * 1.4);
        return;
      case 'combo': {
        const level = Math.max(1, opts.level ?? 1);
        // Upward arpeggio whose pitch base scales with level. 3 notes per surge.
        const base = 660 * Math.pow(1.122, level); // ~1 semitone per level
        const interval = 0.06;
        tone(c, base, 0.07, 'square', t0);
        tone(c, base * 1.25, 0.07, 'square', t0 + interval);
        tone(c, base * 1.5, 0.09, 'square', t0 + interval * 2);
        return;
      }
      case 'perfect':
        for (let i = 0; i < PERFECT_NOTES_HZ.length; i++) {
          tone(c, PERFECT_NOTES_HZ[i]!, 0.18, 'square', t0 + i * 0.12);
        }
        return;
    }
  }

  return {
    isAvailable(): boolean {
      if (unavailable) return false;
      return Boolean(resolveAudioContextCtor());
    },
    play,
    cancel(): void {
      // Web Audio has no global "stop everything" — closing + recreating the context is the
      // accepted pattern, but we'd lose the user-gesture unlock. Cheaper option: ignore. The
      // longest envelope is `perfect` at ~700ms; nothing here lingers long enough to matter.
    },
  };
}

export function createNoopSfx(): Sfx {
  return {
    isAvailable: () => false,
    play: () => undefined,
    cancel: () => undefined,
  };
}

function resolveAudioContextCtor(): (new () => AudioContextLike) | null {
  const g = globalThis as unknown as {
    AudioContext?: new () => AudioContextLike;
    webkitAudioContext?: new () => AudioContextLike;
  };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}
