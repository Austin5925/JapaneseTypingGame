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
const PERFECT_SHOWN_PREFIX = 'kana-typing.perfect-shown.';

export interface ComboRecord {
  peakCombo: number;
  peakKpm: number;
  /** ISO 8601 timestamp of the last write. */
  updatedAt: string;
}

export interface ComboRecordStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  /** Optional — when present, enables LRU pruning of perfect-shown markers. */
  removeItem?(key: string): void;
  /** Optional — list every stored key. Real `localStorage` exposes length + key(i). */
  keys?(): string[];
}

/** Cap on stored `kana-typing.perfect-shown.*` markers; oldest pruned beyond this. */
export const PERFECT_SHOWN_MAX = 50;

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

export function wasPerfectShownForSession(
  sessionId: string,
  storage?: ComboRecordStorage,
): boolean {
  const store = storage ?? globalThis.localStorage;
  if (!store) return false;
  return store.getItem(perfectShownKey(sessionId)) !== null;
}

export function markPerfectShown(sessionId: string, storage?: ComboRecordStorage): void {
  const store = storage ?? globalThis.localStorage;
  if (!store) return;
  try {
    store.setItem(perfectShownKey(sessionId), new Date().toISOString());
  } catch (err) {
    console.warn('[comboRecord] failed to persist perfect marker', err);
  }
  prunePerfectShownMarkers(store, PERFECT_SHOWN_MAX);
}

/**
 * LRU-prune `perfect-shown.*` markers when the count exceeds `maxKeep`. Drops the oldest
 * (lowest stored ISO timestamp) markers first. Skips silently when storage doesn't expose
 * `keys()` / `removeItem` (real `localStorage` does; in-memory test stubs may not).
 */
export function prunePerfectShownMarkers(
  storage: ComboRecordStorage | undefined,
  maxKeep: number,
): void {
  const store = storage ?? globalThis.localStorage;
  if (!store) return;
  const listKeys = resolveListKeys(store);
  if (!listKeys || typeof store.removeItem !== 'function') return;
  const remove = store.removeItem.bind(store);
  const allKeys = listKeys().filter((k) => k.startsWith(PERFECT_SHOWN_PREFIX));
  if (allKeys.length <= maxKeep) return;
  const dated = allKeys
    .map((key) => ({ key, ts: store.getItem(key) ?? '' }))
    // Lexicographic sort on ISO 8601 strings == chronological. Empty timestamps (corrupted
    // markers from older versions) sort first → pruned first, which is what we want.
    .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  const toRemove = dated.slice(0, dated.length - maxKeep);
  for (const { key } of toRemove) {
    try {
      remove(key);
    } catch (err) {
      console.warn('[comboRecord] failed to prune perfect marker', err);
    }
  }
}

function resolveListKeys(store: ComboRecordStorage): (() => string[]) | null {
  if (typeof store.keys === 'function') return store.keys.bind(store);
  // Real DOM Storage exposes `length` + `key(index)` but ComboRecordStorage doesn't list them
  // on the interface. Detect at runtime and synthesise a listKeys for the localStorage path.
  const ls = store as unknown as { length?: number; key?: (index: number) => string | null };
  if (typeof ls.length !== 'number' || typeof ls.key !== 'function') return null;
  return (): string[] => {
    const out: string[] = [];
    const len = ls.length ?? 0;
    for (let i = 0; i < len; i++) {
      const k = ls.key?.(i);
      if (typeof k === 'string') out.push(k);
    }
    return out;
  };
}

function emptyRecord(): ComboRecord {
  return { peakCombo: 0, peakKpm: 0, updatedAt: '' };
}

function perfectShownKey(sessionId: string): string {
  return `${PERFECT_SHOWN_PREFIX}${sessionId}`;
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
