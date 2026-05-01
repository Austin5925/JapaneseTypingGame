import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBrowserJapaneseTts, createNoopJapaneseTts } from '../src/audio/japaneseTts';

interface FakeUtterance {
  text: string;
  lang: string;
  rate: number;
  voice?: { lang: string };
  listeners: Map<string, ((event?: unknown) => void)[]>;
}

function setupFakeSpeech(opts: {
  voices?: Array<{ lang: string; name?: string }>;
  errorOn?: string;
}): {
  synth: {
    speaking: boolean;
    speak: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    getVoices: () => Array<{ lang: string; name?: string }>;
    addEventListener: ReturnType<typeof vi.fn>;
  };
  utterances: FakeUtterance[];
} {
  const utterances: FakeUtterance[] = [];
  const speak = vi.fn((u: FakeUtterance) => {
    utterances.push(u);
    // Fire the event listeners next tick so the await in playKana resolves cleanly.
    queueMicrotask(() => {
      if (opts.errorOn && u.text === opts.errorOn) {
        u.listeners.get('error')?.forEach((cb) => cb({ error: 'synthesis-failed' }));
      } else {
        u.listeners.get('end')?.forEach((cb) => cb());
      }
    });
  });
  const synth = {
    speaking: false,
    speak: speak as unknown as ReturnType<typeof vi.fn>,
    cancel: vi.fn(),
    getVoices: () => opts.voices ?? [],
    addEventListener: vi.fn(),
  };

  // Patch the global SpeechSynthesisUtterance so `new SpeechSynthesisUtterance(text)`
  // returns our fake. The constructor stub exposes `addEventListener` over the listener map.
  class FakeSpeechSynthesisUtterance {
    text: string;
    lang = '';
    rate = 1;
    voice?: { lang: string };
    listeners: Map<string, ((event?: unknown) => void)[]>;
    constructor(text: string) {
      this.text = text;
      this.listeners = new Map();
    }
    addEventListener(type: string, cb: () => void): void {
      const list = this.listeners.get(type) ?? [];
      list.push(cb);
      this.listeners.set(type, list);
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).speechSynthesis = synth;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).SpeechSynthesisUtterance = FakeSpeechSynthesisUtterance;

  return { synth, utterances };
}

function teardownFakeSpeech(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).speechSynthesis;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).SpeechSynthesisUtterance;
}

describe('createBrowserJapaneseTts', () => {
  afterEach(teardownFakeSpeech);

  it('reports unavailable when speechSynthesis is missing', () => {
    teardownFakeSpeech();
    const tts = createBrowserJapaneseTts();
    expect(tts.isAvailable()).toBe(false);
  });

  it('reports available when speechSynthesis is mocked', () => {
    setupFakeSpeech({ voices: [{ lang: 'ja-JP', name: 'Kyoko' }] });
    const tts = createBrowserJapaneseTts();
    expect(tts.isAvailable()).toBe(true);
  });

  it('speaks an utterance with lang=ja-JP, normal rate, ja voice', async () => {
    const { utterances } = setupFakeSpeech({ voices: [{ lang: 'ja-JP', name: 'Kyoko' }] });
    const tts = createBrowserJapaneseTts();
    await tts.playKana('はし');
    expect(utterances).toHaveLength(1);
    expect(utterances[0]!.text).toBe('はし');
    expect(utterances[0]!.lang).toBe('ja-JP');
    expect(utterances[0]!.rate).toBe(1);
    expect(utterances[0]!.voice?.lang).toBe('ja-JP');
  });

  it('honours speed=slow with rate 0.7', async () => {
    const { utterances } = setupFakeSpeech({ voices: [{ lang: 'ja-JP' }] });
    const tts = createBrowserJapaneseTts();
    await tts.playKana('はし', { speed: 'slow' });
    expect(utterances[0]!.rate).toBeCloseTo(0.7, 2);
  });

  it('falls back to default voice when no ja voice is reachable', async () => {
    const { utterances } = setupFakeSpeech({ voices: [{ lang: 'en-US', name: 'Alex' }] });
    const tts = createBrowserJapaneseTts();
    await tts.playKana('はし');
    expect(utterances[0]!.lang).toBe('ja-JP');
    expect(utterances[0]!.voice).toBeUndefined();
  });

  it('cancels in-flight speech on a new playKana', async () => {
    const { synth } = setupFakeSpeech({ voices: [{ lang: 'ja-JP' }] });
    const tts = createBrowserJapaneseTts();
    await tts.playKana('one');
    await tts.playKana('two');
    expect(synth.cancel).toHaveBeenCalledTimes(2);
  });

  it('rejects when the engine emits an error event', async () => {
    setupFakeSpeech({ voices: [{ lang: 'ja-JP' }], errorOn: 'badword' });
    const tts = createBrowserJapaneseTts();
    await expect(tts.playKana('badword')).rejects.toThrow(/synthesis-failed/);
  });

  it('cancel() forwards to the synth', () => {
    const { synth } = setupFakeSpeech({ voices: [{ lang: 'ja-JP' }] });
    const tts = createBrowserJapaneseTts();
    tts.cancel();
    expect(synth.cancel).toHaveBeenCalledTimes(1);
  });

  it('skips empty input gracefully', async () => {
    const { synth } = setupFakeSpeech({ voices: [{ lang: 'ja-JP' }] });
    const tts = createBrowserJapaneseTts();
    await tts.playKana('');
    expect(synth.speak).not.toHaveBeenCalled();
  });
});

describe('createNoopJapaneseTts', () => {
  it('reports unavailable and never throws', async () => {
    const tts = createNoopJapaneseTts();
    expect(tts.isAvailable()).toBe(false);
    await expect(tts.playKana('はし')).resolves.toBeUndefined();
    expect(() => tts.cancel()).not.toThrow();
  });
});

describe('createBrowserJapaneseTts — voiceschanged path', () => {
  beforeEach(() => {
    teardownFakeSpeech();
  });
  afterEach(teardownFakeSpeech);

  it('waits for voiceschanged when getVoices returns empty initially', async () => {
    let voices: Array<{ lang: string }> = [];
    const listenerRef: { current: (() => void) | null } = { current: null };
    const synth = {
      speaking: false,
      speak: vi.fn((u: FakeUtterance) => {
        queueMicrotask(() => {
          u.listeners.get('end')?.forEach((cb) => cb());
        });
      }),
      cancel: vi.fn(),
      getVoices: () => voices,
      addEventListener: vi.fn((type: string, cb: () => void) => {
        if (type === 'voiceschanged') listenerRef.current = cb;
      }),
    };
    class FakeSpeechSynthesisUtterance {
      text: string;
      lang = '';
      rate = 1;
      voice?: { lang: string };
      listeners: Map<string, ((event?: unknown) => void)[]>;
      constructor(text: string) {
        this.text = text;
        this.listeners = new Map();
      }
      addEventListener(type: string, cb: () => void): void {
        const list = this.listeners.get(type) ?? [];
        list.push(cb);
        this.listeners.set(type, list);
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).speechSynthesis = synth;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).SpeechSynthesisUtterance = FakeSpeechSynthesisUtterance;

    const tts = createBrowserJapaneseTts();
    const playPromise = tts.playKana('はし');

    // Simulate voices arriving asynchronously.
    voices = [{ lang: 'ja-JP' }];
    listenerRef.current?.();

    await playPromise;
    expect(synth.speak).toHaveBeenCalledTimes(1);
  });
});
