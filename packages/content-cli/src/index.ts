#!/usr/bin/env node
import { importPackFile } from './importPack';
import { reportValidation, validatePackFile } from './validatePack';

type Quality = 'official' | 'verified' | 'user_imported' | 'needs_review';

interface ParsedArgs {
  command: 'validate-pack' | 'import-pack' | 'help';
  packPath?: string;
  dbPath?: string;
  quality?: Quality;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const [, , cmd, ...rest] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    return { command: 'help' };
  }
  if (cmd !== 'validate-pack' && cmd !== 'import-pack') {
    throw new Error(`unknown command: ${cmd}`);
  }
  const out: ParsedArgs = { command: cmd };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === '--') {
      // POSIX end-of-options separator. pnpm forwards `pnpm run x -- y` as `... y` but some
      // shells/wrappers re-emit `--`, so we tolerate it.
      continue;
    }
    if (arg === '--db' || arg === '--db-path') {
      const v = rest[++i];
      if (!v) throw new Error(`${arg} requires a value`);
      out.dbPath = v;
    } else if (arg === '--quality') {
      const q = rest[++i];
      if (q !== 'official' && q !== 'verified' && q !== 'user_imported' && q !== 'needs_review') {
        throw new Error(`invalid --quality value: ${String(q)}`);
      }
      out.quality = q;
    } else if (!arg.startsWith('--') && !out.packPath) {
      out.packPath = arg;
    } else {
      throw new Error(`unrecognised argument: ${arg}`);
    }
  }
  if (!out.packPath) {
    throw new Error(`${cmd} requires a path to a content pack JSON file`);
  }
  return out;
}

function printHelp(): void {
  console.info(
    [
      'kana-content — content pack tools',
      '',
      'usage:',
      '  kana-content validate-pack <pack.json>',
      '  kana-content import-pack   <pack.json> [--db <path>] [--quality official|verified|user_imported|needs_review]',
      '',
      'notes:',
      '  - import-pack writes to a dev SQLite at local-data/kana_typing.sqlite by default.',
      '  - migrations are applied idempotently before any insert.',
    ].join('\n'),
  );
}

export function main(argv: readonly string[] = process.argv): number {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(`error: ${(err as Error).message}`);
    printHelp();
    return 2;
  }

  if (args.command === 'help') {
    printHelp();
    return 0;
  }

  if (args.command === 'validate-pack') {
    const outcome = validatePackFile({ packPath: args.packPath! });
    console.info(reportValidation(outcome));
    return outcome.ok ? 0 : 1;
  }

  // import-pack
  const result = importPackFile({
    packPath: args.packPath!,
    ...(args.dbPath !== undefined && { dbPath: args.dbPath }),
    ...(args.quality !== undefined && { quality: args.quality }),
  });
  if (!result.ok) {
    console.error(`import failed: ${result.packPath}`);
    for (const e of result.errors ?? []) console.error(`  ${e}`);
    return 1;
  }
  console.info(
    [
      `imported pack ${result.packId ?? '?'} into ${result.dbPath}`,
      `  items=${String(result.itemsUpserted ?? 0)}`,
      `  examples=${String(result.examplesUpserted ?? 0)}`,
      `  audio=${String(result.audioRefsUpserted ?? 0)}`,
      `  confusables=${String(result.confusableEdgesUpserted ?? 0)}`,
    ].join('\n'),
  );
  return 0;
}

// Module entry: only run when invoked as a CLI, not when imported by tests.
if (import.meta.url === `file://${process.argv[1] ?? ''}`) {
  process.exit(main());
}
