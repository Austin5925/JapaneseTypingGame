import { describe, expect, it } from 'vitest';

import {
  markPerfectShown,
  maybeUpdateComboRecord,
  PERFECT_SHOWN_MAX,
  prunePerfectShownMarkers,
  readComboRecord,
  wasPerfectShownForSession,
  type ComboRecordStorage,
} from './comboRecord';

interface MemoryStorage extends ComboRecordStorage {
  data: Map<string, string>;
  removeItem(key: string): void;
  keys(): string[];
}

function memoryStorage(initial: Record<string, string> = {}): MemoryStorage {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem(key) {
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      data.set(key, value);
    },
    removeItem(key) {
      data.delete(key);
    },
    keys() {
      return [...data.keys()];
    },
  };
}

describe('readComboRecord', () => {
  it('returns an empty record when storage is empty', () => {
    const store = memoryStorage();
    expect(readComboRecord(store)).toEqual({ peakCombo: 0, peakKpm: 0, updatedAt: '' });
  });

  it('returns the parsed record when storage holds a valid blob', () => {
    const store = memoryStorage({
      'kana-typing.combo-record': JSON.stringify({
        peakCombo: 12,
        peakKpm: 45,
        updatedAt: '2026-05-02T00:00:00Z',
      }),
    });
    expect(readComboRecord(store)).toEqual({
      peakCombo: 12,
      peakKpm: 45,
      updatedAt: '2026-05-02T00:00:00Z',
    });
  });

  it('returns an empty record on malformed JSON', () => {
    const store = memoryStorage({ 'kana-typing.combo-record': '{not json' });
    expect(readComboRecord(store)).toEqual({ peakCombo: 0, peakKpm: 0, updatedAt: '' });
  });

  it('returns an empty record on shape mismatch', () => {
    const store = memoryStorage({
      'kana-typing.combo-record': JSON.stringify({ foo: 'bar' }),
    });
    expect(readComboRecord(store)).toEqual({ peakCombo: 0, peakKpm: 0, updatedAt: '' });
  });
});

describe('maybeUpdateComboRecord', () => {
  it('writes a new record when both fields beat zero baseline', () => {
    const store = memoryStorage();
    const out = maybeUpdateComboRecord({ peakCombo: 7, peakKpm: 30 }, store);
    expect(out.brokeCombo).toBe(true);
    expect(out.brokeKpm).toBe(true);
    expect(out.record.peakCombo).toBe(7);
    expect(out.record.peakKpm).toBe(30);
    expect(store.data.get('kana-typing.combo-record')).toBeTruthy();
  });

  it('keeps the higher value per axis on a partial improvement', () => {
    const store = memoryStorage({
      'kana-typing.combo-record': JSON.stringify({
        peakCombo: 12,
        peakKpm: 45,
        updatedAt: 'old',
      }),
    });
    const out = maybeUpdateComboRecord({ peakCombo: 5, peakKpm: 60 }, store);
    expect(out.brokeCombo).toBe(false);
    expect(out.brokeKpm).toBe(true);
    expect(out.record.peakCombo).toBe(12); // kept
    expect(out.record.peakKpm).toBe(60); // updated
  });

  it('does not persist on a no-op', () => {
    const store = memoryStorage({
      'kana-typing.combo-record': JSON.stringify({
        peakCombo: 12,
        peakKpm: 45,
        updatedAt: 'old',
      }),
    });
    const out = maybeUpdateComboRecord({ peakCombo: 3, peakKpm: 10 }, store);
    expect(out.brokeCombo).toBe(false);
    expect(out.brokeKpm).toBe(false);
    expect(out.record.updatedAt).toBe('old'); // not refreshed
  });

  it('refreshes updatedAt on any improvement', () => {
    const store = memoryStorage();
    const out = maybeUpdateComboRecord({ peakCombo: 1, peakKpm: 0 }, store);
    expect(out.record.updatedAt).not.toBe('');
  });
});

describe('perfect finale session marker', () => {
  it('marks one session without affecting another session', () => {
    const store = memoryStorage();
    expect(wasPerfectShownForSession('s1', store)).toBe(false);
    expect(wasPerfectShownForSession('s2', store)).toBe(false);

    markPerfectShown('s1', store);

    expect(wasPerfectShownForSession('s1', store)).toBe(true);
    expect(wasPerfectShownForSession('s2', store)).toBe(false);
  });
});

describe('prunePerfectShownMarkers', () => {
  function fillMarkers(store: MemoryStorage, count: number): void {
    for (let i = 0; i < count; i++) {
      // Lexicographic ISO order: padded index ensures sort matches insertion order.
      const ts = `2026-05-03T00:00:${String(i).padStart(2, '0')}.000Z`;
      store.data.set(`kana-typing.perfect-shown.s${String(i)}`, ts);
    }
  }

  it('is a no-op when count <= maxKeep', () => {
    const store = memoryStorage();
    fillMarkers(store, 5);
    prunePerfectShownMarkers(store, 10);
    expect(store.keys().filter((k) => k.startsWith('kana-typing.perfect-shown.'))).toHaveLength(5);
  });

  it('prunes oldest markers down to maxKeep', () => {
    const store = memoryStorage();
    fillMarkers(store, 12);
    prunePerfectShownMarkers(store, 5);
    const remaining = store
      .keys()
      .filter((k) => k.startsWith('kana-typing.perfect-shown.'))
      .sort();
    expect(remaining).toHaveLength(5);
    // Oldest 7 (s0..s6) should have been pruned; s7..s11 survive.
    expect(remaining).toEqual([
      'kana-typing.perfect-shown.s10',
      'kana-typing.perfect-shown.s11',
      'kana-typing.perfect-shown.s7',
      'kana-typing.perfect-shown.s8',
      'kana-typing.perfect-shown.s9',
    ]);
  });

  it('treats empty / corrupted timestamps as oldest (pruned first)', () => {
    const store = memoryStorage();
    store.data.set('kana-typing.perfect-shown.empty1', '');
    store.data.set('kana-typing.perfect-shown.empty2', '');
    store.data.set('kana-typing.perfect-shown.good1', '2026-05-03T00:00:00.000Z');
    store.data.set('kana-typing.perfect-shown.good2', '2026-05-03T00:00:01.000Z');
    prunePerfectShownMarkers(store, 2);
    const remaining = store.keys().filter((k) => k.startsWith('kana-typing.perfect-shown.'));
    expect(remaining.sort()).toEqual([
      'kana-typing.perfect-shown.good1',
      'kana-typing.perfect-shown.good2',
    ]);
  });

  it('does not touch non-perfect-shown keys', () => {
    const store = memoryStorage();
    store.data.set('kana-typing.combo-record', 'untouched');
    fillMarkers(store, 10);
    prunePerfectShownMarkers(store, 3);
    expect(store.data.get('kana-typing.combo-record')).toBe('untouched');
  });

  it('skips silently when storage lacks removeItem / keys', () => {
    const data = new Map<string, string>([
      ['kana-typing.perfect-shown.s1', '2026-05-03T00:00:00Z'],
    ]);
    const minimalStore: ComboRecordStorage = {
      getItem(key: string) {
        return data.get(key) ?? null;
      },
      setItem(_key: string, _value: string) {
        // no-op for the storage interface
      },
    };
    expect(() => prunePerfectShownMarkers(minimalStore, 0)).not.toThrow();
    expect(data.size).toBe(1); // marker preserved because removeItem is unavailable
  });

  it('markPerfectShown enforces PERFECT_SHOWN_MAX automatically', () => {
    const store = memoryStorage();
    fillMarkers(store, PERFECT_SHOWN_MAX);
    // Adding one more must trigger an in-place prune back down to PERFECT_SHOWN_MAX.
    markPerfectShown('s-new', store);
    const remaining = store.keys().filter((k) => k.startsWith('kana-typing.perfect-shown.'));
    expect(remaining.length).toBe(PERFECT_SHOWN_MAX);
    expect(remaining).toContain('kana-typing.perfect-shown.s-new');
  });
});
