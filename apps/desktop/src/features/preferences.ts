import type { MoleDifficulty } from '../pages/GamePage';

/**
 * v0.9.2: 鼹鼠难度从 SettingsPage 选择,持久化到 localStorage,GamePage 进入时如果 url
 * overrides 没指定,就读这里的偏好。把 read/write 集中在这一个文件,避免 storage key
 * 字符串散落在 SettingsPage / GamePage 两边漂。
 */

const MOLE_DIFFICULTY_KEY = 'kana-mole-difficulty';
const VALID_MOLE_DIFFICULTIES: MoleDifficulty[] = ['easy', 'normal', 'hard'];

export function readMoleDifficultyPreference(): MoleDifficulty | null {
  try {
    const raw = globalThis.localStorage?.getItem(MOLE_DIFFICULTY_KEY);
    if (raw && (VALID_MOLE_DIFFICULTIES as string[]).includes(raw)) {
      return raw as MoleDifficulty;
    }
  } catch {
    /* localStorage unavailable (private mode / quota) — fall back to null */
  }
  return null;
}

export function writeMoleDifficultyPreference(difficulty: MoleDifficulty): void {
  try {
    globalThis.localStorage?.setItem(MOLE_DIFFICULTY_KEY, difficulty);
  } catch {
    /* silent — preference is best-effort */
  }
}
