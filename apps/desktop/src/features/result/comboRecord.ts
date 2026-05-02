/**
 * Local-only "all-time peak" record tracked across sessions. The browser localStorage holds
 * one row keyed `kana-typing.combo-record` with `{peakCombo, peakKpm, updatedAt}`. Each
 * ResultPage diff against this row decides whether to render a "破纪录" badge and whether to
 * promote the current session's peak.
 *
 * We deliberately stay in localStorage rather than SQLite for two reasons:
 *   1. Combo / KPM are purely cosmetic — losing them on a profile reset is fine.
 *   2. Avoids touching the DB schema for a dependency-free polish feature.
 *
 * Functions are pure-ish: storage is injected (defaults to globalThis.localStorage). Tests
 * pass a Map-backed fake.
 */

const STORAGE_KEY = 'kana-typing.combo-record';

export interface ComboRecord {
  peakCombo: number;
  peakKpm: number;
  /** ISO 8601 timestamp of the last write. */
  updatedAt: string;
}

export interface ComboRecordStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readComboRecord(storage?: ComboRecordStorage): ComboRecord {
  const store = storage ?? globalThis.localStorage;
  if (!store) return emptyRecord();
  const raw = store.getItem(STORAGE_KEY);
  if (!raw) return emptyRecord();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isComboRecord(parsed)) return emptyRecord();
    return parsed;
  } catch {
    return emptyRecord();
  }
}

export interface MaybeUpdateInput {
  peakCombo: number;
  peakKpm: number;
}

export interface MaybeUpdateOutcome {
  /** The record after merging — same as input on a no-op. */
  record: ComboRecord;
  /** True when at least one field beat the previous record. */
  brokeCombo: boolean;
  brokeKpm: boolean;
}

/**
 * Read the current record, merge with the candidate values (taking the max per field), persist
 * if anything improved. The two flags let the UI render distinct "破纪录" badges per axis.
 */
export function maybeUpdateComboRecord(
  candidate: MaybeUpdateInput,
  storage?: ComboRecordStorage,
): MaybeUpdateOutcome {
  const store = storage ?? globalThis.localStorage;
  const current = readComboRecord(store);
  const brokeCombo = candidate.peakCombo > current.peakCombo;
  const brokeKpm = candidate.peakKpm > current.peakKpm;
  if (!brokeCombo && !brokeKpm) {
    return { record: current, brokeCombo: false, brokeKpm: false };
  }
  const next: ComboRecord = {
    peakCombo: Math.max(current.peakCombo, candidate.peakCombo),
    peakKpm: Math.max(current.peakKpm, candidate.peakKpm),
    updatedAt: new Date().toISOString(),
  };
  if (store) {
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (err) {
      console.warn('[comboRecord] failed to persist record', err);
    }
  }
  return { record: next, brokeCombo, brokeKpm };
}

function emptyRecord(): ComboRecord {
  return { peakCombo: 0, peakKpm: 0, updatedAt: '' };
}

function isComboRecord(value: unknown): value is ComboRecord {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.peakCombo === 'number' &&
    typeof v.peakKpm === 'number' &&
    typeof v.updatedAt === 'string'
  );
}
