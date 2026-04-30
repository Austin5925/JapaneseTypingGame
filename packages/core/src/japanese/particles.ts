// Particle-as-pronunciation rules: は, へ, を when used as particles are spoken `wa`, `e`, `o`.
// In *表記* (orthographic) mode the user must type は/へ/を; in *読み* (pronunciation) mode the
// user is allowed to type わ/え/お in those particle positions.
//
// We don't try to detect particles by parsing the sentence here — that's a downstream job for
// the answer evaluator, which knows whether the task is reading-mode or surface-mode. This
// module just exposes the substitution rules.

export const PARTICLE_HA = 'は';
export const PARTICLE_HE = 'へ';
export const PARTICLE_WO = 'を';

export const PARTICLE_KANA: ReadonlySet<string> = new Set([PARTICLE_HA, PARTICLE_HE, PARTICLE_WO]);

export const PARTICLE_TO_PRONUNCIATION: Readonly<Record<string, string>> = {
  [PARTICLE_HA]: 'わ',
  [PARTICLE_HE]: 'え',
  [PARTICLE_WO]: 'お',
};

export const PRONUNCIATION_TO_PARTICLE: Readonly<Record<string, string>> = {
  わ: PARTICLE_HA,
  え: PARTICLE_HE,
  お: PARTICLE_WO,
};

/**
 * Substitute particle kana with their pronunciation form everywhere they appear.
 *
 * This is over-eager: a non-particle は (e.g. inside 葉っぱ) would also be rewritten. That's
 * acceptable because:
 *   1. We only call this when the task is in pronunciation mode, where the user typed reading.
 *   2. The expected answer in reading mode has already been hand-authored as pronunciation,
 *      so the expected/actual share the same lossy transform — comparison still works.
 */
export function rewriteParticlesAsPronunciation(s: string): string {
  let out = '';
  for (const ch of s) out += PARTICLE_TO_PRONUNCIATION[ch] ?? ch;
  return out;
}

/** The reverse: rewrite reading kana back to surface particles. Same caveat applies. */
export function rewritePronunciationAsParticle(s: string): string {
  let out = '';
  for (const ch of s) out += PRONUNCIATION_TO_PARTICLE[ch] ?? ch;
  return out;
}
