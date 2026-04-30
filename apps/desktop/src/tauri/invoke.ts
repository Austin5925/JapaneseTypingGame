import { invoke } from '@tauri-apps/api/core';

// Dev-only DTOs: deliberately a narrow projection of LearningItem so the Rust scaffold can stay
// small in Sprint 0. Sprint 2 swaps these for the full Repository layer that returns
// @kana-typing/core domain models.

export interface DevItemRow {
  id: string;
  surface: string;
  kana: string;
  romaji: string[];
  jlpt?: string;
}

export interface SeedTestPackResult {
  packId: string;
  itemsUpserted: number;
}

export function seedTestPack(): Promise<SeedTestPackResult> {
  return invoke<SeedTestPackResult>('seed_test_pack');
}

export function listItems(args: { limit?: number } = {}): Promise<DevItemRow[]> {
  return invoke<DevItemRow[]>('list_items', { limit: args.limit ?? 50 });
}

export interface DbInfo {
  path: string;
  appliedMigrations: string[];
  itemCount: number;
}

export function getDbInfo(): Promise<DbInfo> {
  return invoke<DbInfo>('get_db_info');
}
