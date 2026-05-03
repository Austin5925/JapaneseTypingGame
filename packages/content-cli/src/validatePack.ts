import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import {
  formatIssues,
  validatePack,
  validateSentencePack,
  type ContentPackInput,
  type SentencePackInput,
  type ValidationResult,
} from '@kana-typing/content-schema';

export interface ValidatePackOptions {
  packPath: string;
}

export type ValidatePackKind = 'word' | 'sentence';

export interface ValidatePackOutcome {
  ok: boolean;
  packPath: string;
  kind: ValidatePackKind;
  result: ValidationResult<ContentPackInput | SentencePackInput>;
}

function resolveUserPath(p: string): string {
  if (isAbsolute(p)) return p;
  const base = process.env.INIT_CWD ?? process.cwd();
  return resolve(base, p);
}

// v0.9.0 phase1 corpus ships sentence packs alongside word packs; auto-detect by which top-level
// array is present so a single `kana-content validate-pack <file>` works for either.
function detectKind(raw: unknown): ValidatePackKind {
  if (raw && typeof raw === 'object' && 'sentences' in raw && Array.isArray(raw.sentences)) {
    return 'sentence';
  }
  return 'word';
}

export function validatePackFile({ packPath }: ValidatePackOptions): ValidatePackOutcome {
  const absolute = resolveUserPath(packPath);
  const raw = JSON.parse(readFileSync(absolute, 'utf8')) as unknown;
  const kind = detectKind(raw);
  const result = kind === 'sentence' ? validateSentencePack(raw) : validatePack(raw);
  return { ok: result.ok, packPath: absolute, kind, result };
}

export function reportValidation(outcome: ValidatePackOutcome): string {
  const lines: string[] = [];
  lines.push(`pack: ${outcome.packPath}`);
  if (outcome.result.ok) {
    const value = outcome.result.value;
    const count =
      outcome.kind === 'sentence'
        ? (value as SentencePackInput).sentences.length
        : (value as ContentPackInput).items.length;
    const noun = outcome.kind === 'sentence' ? 'sentences' : 'items';
    lines.push(`status: OK (${String(count)} ${noun})`);
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
