import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBrowserSfx, createNoopSfx, type SfxCue } from '../src/audio/sfx';

interface OscRecord {
  type: OscillatorType;
  freqSet: number;
  freqRamp?: number;
  startedAt: number;
  stoppedAt: number;
}

interface SetupResult {
  oscillators: OscRecord[];
  resumeCalls: number;
  ctorCalls: number;
}

function setupFakeAudio(initialState: AudioContextState = 'running'): SetupResult {
  const oscillators: OscRecord[] = [];
  let now = 0;
  const result: SetupResult = { oscillators, resumeCalls: 0, ctorCalls: 0 };

  class FakeOscillator {
    type: OscillatorType = 'sine';
    private rec: OscRecord = {
      type: 'sine',
      freqSet: 0,
      startedAt: 0,
      stoppedAt: 0,
    };
    constructor() {
      oscillators.push(this.rec);
    }
    frequency = {
      setValueAtTime: (v: number, _t: number) => {
        this.rec.freqSet = v;
      },
      exponentialRampToValueAtTime: (v: number, _t: number) => {
        this.rec.freqRamp = v;
      },
    };
    connect(_n: AudioNode): void {}
    start(t: number): void {
      this.rec.startedAt = t;
      this.rec.type = this.type;
    }
    stop(t: number): void {
      this.rec.stoppedAt = t;
    }
  }

  class FakeGain {
    gain = {
      setValueAtTime: (_v: number, _t: number) => undefined,
      linearRampToValueAtTime: (_v: number, _t: number) => undefined,
      exponentialRampToValueAtTime: (_v: number, _t: number) => undefined,
    };
    connect(_n: AudioNode): void {}
  }

  class FakeAudioContext {
    state: AudioContextState = initialState;
    destination = {} as AudioNode;
    constructor() {
      result.ctorCalls += 1;
    }
    get currentTime(): number {
      const t = now;
      now += 0.001;
      return t;
    }
    createOscillator(): OscillatorNode {
      return new FakeOscillator() as unknown as OscillatorNode;
    }
    createGain(): GainNode {
      return new FakeGain() as unknown as GainNode;
    }
    resume(): Promise<void> {
      result.resumeCalls += 1;
      this.state = 'running';
      return Promise.resolve();
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).AudioContext = FakeAudioContext;
  return result;
}

function teardownFakeAudio(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).AudioContext;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).webkitAudioContext;
}

afterEach(teardownFakeAudio);

describe('createBrowserSfx', () => {
  it('reports unavailable when no AudioContext constructor exists', () => {
    teardownFakeAudio();
    const sfx = createBrowserSfx();
    expect(sfx.isAvailable()).toBe(false);
  });

  it('reports available when AudioContext is mocked', () => {
    setupFakeAudio();
    const sfx = createBrowserSfx();
    expect(sfx.isAvailable()).toBe(true);
  });

  it('correct cue schedules two square-wave tones', () => {
    const setup = setupFakeAudio();
    const sfx = createBrowserSfx();
    sfx.play('correct');
    expect(setup.oscillators.length).toBe(2);
    expect(setup.oscillators[0]!.type).toBe('square');
    expect(setup.oscillators[1]!.type).toBe('square');
  });

  it('wrong cue schedules a downward sawtooth sweep', () => {
    const setup = setupFakeAudio();
    const sfx = createBrowserSfx();
    sfx.play('wrong');
    expect(setup.oscillators.length).toBe(1);
    expect(setup.oscillators[0]!.type).toBe('sawtooth');
    const r = setup.oscillators[0]!;
    expect(r.freqRamp ?? 0).toBeLessThan(r.freqSet);
  });

  it('combo cue schedules a 3-note arpeggio that scales with level', () => {
    const setup = setupFakeAudio();
    const sfx = createBrowserSfx();
    sfx.play('combo', { level: 1 });
    const baseFreq = setup.oscillators[0]!.freqSet;
    expect(setup.oscillators.length).toBe(3);
    sfx.play('combo', { level: 4 });
    const baseFreqHigh = setup.oscillators[3]!.freqSet;
    expect(baseFreqHigh).toBeGreaterThan(baseFreq); // higher level → higher base
  });

  it('perfect cue schedules a four-note motif', () => {
    const setup = setupFakeAudio();
    const sfx = createBrowserSfx();
    sfx.play('perfect');
    expect(setup.oscillators.length).toBe(4);
    // Pitches strictly ascend.
    for (let i = 1; i < 4; i++) {
      expect(setup.oscillators[i]!.freqSet).toBeGreaterThan(setup.oscillators[i - 1]!.freqSet);
    }
  });

  it('reuses one AudioContext across cues', () => {
    const setup = setupFakeAudio();
    const sfx = createBrowserSfx();
    sfx.play('correct');
    sfx.play('wrong');
    sfx.play('tick');
    expect(setup.ctorCalls).toBe(1);
  });

  it('resumes a suspended AudioContext on first play', async () => {
    const setup = setupFakeAudio('suspended');
    const sfx = createBrowserSfx();
    sfx.play('correct');
    // Resume is async; let the microtask drain.
    await Promise.resolve();
    expect(setup.resumeCalls).toBeGreaterThanOrEqual(1);
  });

  it('falls back silently when AudioContext throws', () => {
    class BoomCtx {
      constructor() {
        throw new Error('no audio device');
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).AudioContext = BoomCtx;
    const sfx = createBrowserSfx();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(() => sfx.play('correct')).not.toThrow();
    warn.mockRestore();
  });
});

describe('createNoopSfx', () => {
  it('reports unavailable and play is a no-op', () => {
    const sfx = createNoopSfx();
    expect(sfx.isAvailable()).toBe(false);
    const cues: SfxCue[] = ['correct', 'wrong', 'tick', 'combo', 'perfect'];
    for (const cue of cues) {
      expect(() => sfx.play(cue)).not.toThrow();
    }
  });
});
