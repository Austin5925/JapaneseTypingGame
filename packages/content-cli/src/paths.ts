import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Walk upward from this file until we find pnpm-workspace.yaml. We avoid hard-coding `../..`
// so the CLI keeps working when bundled (`dist/index.js`) or invoked from a sibling package.
export function findRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('content-cli could not locate the monorepo root (pnpm-workspace.yaml)');
}

export function migrationsDir(repoRoot = findRepoRoot()): string {
  const dir = join(repoRoot, 'migrations');
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`migrations directory not found at ${dir}`);
  }
  return dir;
}

// Returns SQL strings in lexicographic order. Files are read once at startup; we don't watch
// for changes — the CLI is a one-shot tool.
export function listMigrations(dir = migrationsDir()): Array<{ name: string; path: string }> {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, path: resolve(dir, name) }));
}

export function defaultDevDbPath(repoRoot = findRepoRoot()): string {
  return join(repoRoot, 'local-data', 'kana_typing.sqlite');
}
