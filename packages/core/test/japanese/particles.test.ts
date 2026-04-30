import { describe, expect, it } from 'vitest';

import {
  PARTICLE_KANA,
  rewriteParticlesAsPronunciation,
  rewritePronunciationAsParticle,
} from '../../src/japanese/particles';

describe('particle character set', () => {
  it('contains は/へ/を', () => {
    expect(PARTICLE_KANA.has('は')).toBe(true);
    expect(PARTICLE_KANA.has('へ')).toBe(true);
    expect(PARTICLE_KANA.has('を')).toBe(true);
  });

  it('does not contain regular kana', () => {
    expect(PARTICLE_KANA.has('わ')).toBe(false);
    expect(PARTICLE_KANA.has('え')).toBe(false);
    expect(PARTICLE_KANA.has('お')).toBe(false);
  });
});

describe('rewriteParticlesAsPronunciation', () => {
  it('rewrites は → わ', () => {
    expect(rewriteParticlesAsPronunciation('わたしは')).toBe('わたしわ');
  });

  it('rewrites へ → え', () => {
    expect(rewriteParticlesAsPronunciation('がっこうへ')).toBe('がっこうえ');
  });

  it('rewrites を → お', () => {
    expect(rewriteParticlesAsPronunciation('ほんを')).toBe('ほんお');
  });

  it('rewrites every particle in the sentence', () => {
    expect(rewriteParticlesAsPronunciation('わたしはがっこうへほんをよむ')).toBe(
      'わたしわがっこうえほんおよむ',
    );
  });

  it('is a no-op when no particle kana present', () => {
    expect(rewriteParticlesAsPronunciation('やくそく')).toBe('やくそく');
  });
});

describe('rewritePronunciationAsParticle', () => {
  it('reverses わ → は etc.', () => {
    expect(rewritePronunciationAsParticle('わたしわ')).toBe('はたしは');
    // Note: this rewrites every occurrence, not just particle positions — the function's docs
    // call out the lossy behaviour and the consumer is responsible for using it only when
    // expected/actual share the same lossy transform.
  });
});
