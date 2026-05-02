import { describe, expect, it } from 'vitest';

import { maybeUpdateComboRecord, readComboRecord, type ComboRecordStorage } from './comboRecord';

function memoryStorage(initial: Record<string, string> = {}): ComboRecordStorage & {
  data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem(key) {
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      data.set(key, value);
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
