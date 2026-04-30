import { describe, expect, it } from 'vitest';

import { evaluate } from '../../src/evaluation/answerEvaluator';
import type { EvaluationStrictness, TrainingTask, UserAttempt } from '../../src/types/domain';

const STRICT: EvaluationStrictness = {
  longVowel: 'strict',
  sokuon: 'strict',
  dakuten: 'strict',
  handakuten: 'strict',
  youon: 'strict',
  kanjiSurface: 'strict',
  particleReading: 'surface',
};

function task(partial: Partial<TrainingTask>): TrainingTask {
  return {
    id: 't1',
    sessionId: 's1',
    itemId: 'item-1',
    gameType: 'speed_chase',
    answerMode: 'kana_input',
    skillDimension: 'kana_typing',
    prompt: { kind: 'text', text: 'test' },
    expected: { kana: 'やくそく' },
    difficulty: 0.5,
    allowHints: false,
    strictness: STRICT,
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

function attempt(partial: Partial<UserAttempt>): UserAttempt {
  return {
    id: 'a1',
    sessionId: 's1',
    taskId: 't1',
    itemId: 'item-1',
    gameType: 'speed_chase',
    startedAt: new Date().toISOString(),
    submittedAt: new Date().toISOString(),
    reactionTimeMs: 3000,
    usedHint: false,
    inputMethod: 'romaji',
    ...partial,
  };
}

describe('evaluate — kana_input', () => {
  it('correct attempt → isCorrect true, no error tags, score>0', () => {
    const r = evaluate(task({}), attempt({ committedInput: 'やくそく' }));
    expect(r.isCorrect).toBe(true);
    expect(r.errorTags).toEqual([]);
    expect(r.score).toBeGreaterThan(0);
    expect(r.shouldRepeatImmediately).toBe(false);
  });

  it('wrong attempt → isCorrect false, error tags surfaced', () => {
    const r = evaluate(task({}), attempt({ committedInput: 'やくそくう' }));
    expect(r.isCorrect).toBe(false);
    expect(r.errorTags.length).toBeGreaterThan(0);
  });

  it('severe error sets shouldRepeatImmediately', () => {
    const r = evaluate(task({ expected: { kana: 'ビール' } }), attempt({ committedInput: 'ビル' }));
    expect(r.isCorrect).toBe(false);
    expect(r.errorTags).toContain('long_vowel_error');
    expect(r.shouldRepeatImmediately).toBe(true);
  });

  it('non-severe error does not set shouldRepeatImmediately', () => {
    const r = evaluate(task({ expected: { kana: 'やま' } }), attempt({ committedInput: 'かわ' }));
    expect(r.isCorrect).toBe(false);
    expect(r.shouldRepeatImmediately).toBe(false);
  });
});

describe('evaluate — romaji_to_kana', () => {
  it('accepts shi/si variants for し', () => {
    const t = task({ answerMode: 'romaji_to_kana', expected: { kana: 'し' } });
    expect(evaluate(t, attempt({ rawInput: 'shi' })).isCorrect).toBe(true);
    expect(evaluate(t, attempt({ rawInput: 'si' })).isCorrect).toBe(true);
  });

  it('rejects wrong romaji', () => {
    const t = task({ answerMode: 'romaji_to_kana', expected: { kana: 'やくそく' } });
    expect(evaluate(t, attempt({ rawInput: 'yakusoku' })).isCorrect).toBe(true);
    expect(evaluate(t, attempt({ rawInput: 'yakusokuu' })).isCorrect).toBe(false);
  });
});

describe('evaluate — meaning_to_surface', () => {
  it('accepts the canonical surface', () => {
    const t = task({
      answerMode: 'meaning_to_surface',
      expected: { surface: '約束', kana: 'やくそく' },
    });
    expect(evaluate(t, attempt({ committedInput: '約束' })).isCorrect).toBe(true);
  });

  it('accepts the kana reading as a fallback', () => {
    const t = task({
      answerMode: 'meaning_to_surface',
      expected: { surface: '約束', kana: 'やくそく' },
    });
    expect(evaluate(t, attempt({ committedInput: 'やくそく' })).isCorrect).toBe(true);
  });

  it('rejects an unrelated word', () => {
    const t = task({
      answerMode: 'meaning_to_surface',
      expected: { surface: '約束', kana: 'やくそく' },
    });
    expect(evaluate(t, attempt({ committedInput: '予約' })).isCorrect).toBe(false);
  });
});

describe('evaluate — ime_surface', () => {
  it('exact surface match', () => {
    const t = task({ answerMode: 'ime_surface', expected: { surface: '約束' } });
    expect(evaluate(t, attempt({ committedInput: '約束' })).isCorrect).toBe(true);
  });

  it('accepts an alt surface from acceptedSurfaces', () => {
    const t = task({
      answerMode: 'ime_surface',
      expected: { surface: '会う', acceptedSurfaces: ['逢う'] },
    });
    expect(evaluate(t, attempt({ committedInput: '逢う' })).isCorrect).toBe(true);
  });

  it('flags wrong kanji as ime_conversion_error', () => {
    const t = task({ answerMode: 'ime_surface', expected: { surface: '約束' } });
    const r = evaluate(t, attempt({ committedInput: '予約' }));
    expect(r.isCorrect).toBe(false);
    expect(r.errorTags).toContain('ime_conversion_error');
  });
});

describe('evaluate — sentence_chunk_order is intentionally unimplemented', () => {
  it('throws so callers know they need V1', () => {
    const t = task({ answerMode: 'sentence_chunk_order' });
    expect(() => evaluate(t, attempt({ committedInput: 'x' }))).toThrow(/sentence_chunk_order/);
  });
});

describe('evaluate — crossGameEffects routing', () => {
  it('long_vowel_error routes to apple_rescue (listening) and mole_story (typing)', () => {
    const r = evaluate(task({ expected: { kana: 'ビール' } }), attempt({ committedInput: 'ビル' }));
    const targets = r.crossGameEffects.map((e) => e.targetGameType);
    expect(targets).toContain('apple_rescue');
    expect(targets).toContain('mole_story');
  });

  it('katakana_shape_confusion routes only to mole_story', () => {
    const r = evaluate(
      task({ expected: { kana: 'シート' } }),
      attempt({ committedInput: 'ツート' }),
    );
    const targets = r.crossGameEffects.map((e) => e.targetGameType);
    expect(targets).toEqual(['mole_story']);
  });

  it('unknown errors produce no cross-game effects', () => {
    const r = evaluate(task({ expected: { kana: 'やま' } }), attempt({ committedInput: 'かわ' }));
    expect(r.crossGameEffects).toEqual([]);
  });
});
