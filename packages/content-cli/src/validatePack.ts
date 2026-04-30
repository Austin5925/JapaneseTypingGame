import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import {
  formatIssues,
  validatePack,
  type ContentPackInput,
  type ValidationResult,
} from '@kana-typing/content-schema';

export interface ValidatePackOptions {
  packPath: string;
}

export interface ValidatePackOutcome {
  ok: boolean;
  packPath: string;
  result: ValidationResult<ContentPackInput>;
}

// pnpm/npm scripts run with `cwd = <package dir>` but expose the user's invocation directory
// in `INIT_CWD`. Relative paths the user typed should resolve against that, otherwise
// `pnpm content:validate ./pack.json` fails inside the workspace package's cwd.
function resolveUserPath(p: string): string {
  if (isAbsolute(p)) return p;
  const base = process.env.INIT_CWD ?? process.cwd();
  return resolve(base, p);
}

export function validatePackFile({ packPath }: ValidatePackOptions): ValidatePackOutcome {
  const absolute = resolveUserPath(packPath);
  const raw = JSON.parse(readFileSync(absolute, 'utf8')) as unknown;
  const result = validatePack(raw);
  return { ok: result.ok, packPath: absolute, result };
}

export function reportValidation(outcome: ValidatePackOutcome): string {
  const lines: string[] = [];
  lines.push(`pack: ${outcome.packPath}`);
  if (outcome.result.ok) {
    lines.push(`status: OK (${String(outcome.result.value.items.length)} items)`);
    if (outcome.result.warnings.length > 0) {
      lines.push('warnings:');
      lines.push(formatIssues(outcome.result.warnings));
    }
  } else {
    lines.push(`status: FAIL (${String(outcome.result.errors.length)} errors)`);
    lines.push(formatIssues(outcome.result.errors));
    if (outcome.result.warnings.length > 0) {
      lines.push('warnings:');
      lines.push(formatIssues(outcome.result.warnings));
    }
  }
  return lines.join('\n');
}
