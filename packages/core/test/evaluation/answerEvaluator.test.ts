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

describe('evaluate — sentence_chunk_order', () => {
  // 私は学校へ行きます — three chunks; canonical order [c1, c2, c3].
  const sentenceTask = (overrides: Partial<TrainingTask['expected']> = {}): TrainingTask =>
    task({
      answerMode: 'sentence_chunk_order',
      skillDimension: 'sentence_order',
      gameType: 'river_jump',
      expected: {
        chunkOrder: ['c1', 'c2', 'c3'],
        chunks: [
          {
            id: 'c1',
            text: '私は',
            kana: 'わたしは',
            romaji: ['watashiha'],
          },
          {
            id: 'c2',
            text: '学校へ',
            kana: 'がっこうへ',
            romaji: ['gakkouhe'],
          },
          { id: 'c3', text: '行きます', kana: 'いきます', romaji: ['ikimasu'] },
        ],
        ...overrides,
      },
    });

  function chunkInputs(entries: Array<[string, string]>): string {
    return JSON.stringify(entries.map(([chunkId, input]) => ({ chunkId, input })));
  }

  it('correct order + correct readings → isCorrect, no errorTags', () => {
    const r = evaluate(
      sentenceTask(),
      attempt({
        chunkOrder: ['c1', 'c2', 'c3'],
        rawInput: chunkInputs([
          ['c1', 'watashiha'],
          ['c2', 'がっこうへ'],
          ['c3', 'ikimasu'],
        ]),
      }),
    );
    expect(r.isCorrect).toBe(true);
    expect(r.errorTags).toEqual([]);
  });

  it('wrong chunk order → word_order_error, isCorrect false', () => {
    const r = evaluate(
      sentenceTask(),
      attempt({
        chunkOrder: ['c1', 'c3', 'c2'],
        rawInput: chunkInputs([
          ['c1', 'watashiha'],
          ['c3', 'ikimasu'],
          ['c2', 'gakkouhe'],
        ]),
      }),
    );
    expect(r.isCorrect).toBe(false);
    expect(r.errorTags).toContain('word_order_error');
  });

  it('alternate order in acceptedChunkOrders → isCorrect', () => {
    const r = evaluate(
      sentenceTask({ acceptedChunkOrders: [['c2', 'c1', 'c3']] }),
      attempt({
        chunkOrder: ['c2', 'c1', 'c3'],
        rawInput: chunkInputs([
          ['c2', 'gakkouhe'],
          ['c1', 'watashiha'],
          ['c3', 'ikimasu'],
        ]),
      }),
    );
    expect(r.isCorrect).toBe(true);
    expect(r.errorTags).toEqual([]);
  });

  it('rejects correct order when a chunk input is missing', () => {
    const r = evaluate(
      sentenceTask(),
      attempt({
        chunkOrder: ['c1', 'c2', 'c3'],
        rawInput: chunkInputs([
          ['c1', 'watashiha'],
          ['c2', 'gakkouhe'],
        ]),
      }),
    );
    expect(r.isCorrect).toBe(false);
    expect(r.errorTags).toContain('unknown');
  });

  it('rejects correct order when rawInput is absent despite chunk metadata', () => {
    const r = evaluate(
      sentenceTask(),
      attempt({
        chunkOrder: ['c1', 'c2', 'c3'],
      }),
    );
    expect(r.isCorrect).toBe(false);
    expect(r.errorTags).toContain('unknown');
  });

  it('accepts natural particle pronunciation in reading mode', () => {
    const pronunciationStrict = {
      ...STRICT,
      particleReading: 'pronunciation' as const,
    };
    const r = evaluate(
      sentenceTask(),
      attempt({
        chunkOrder: ['c1', 'c2', 'c3'],
        rawInput: chunkInputs([
          ['c1', 'watashiwa'],
          ['c2', 'gakkoue'],
          ['c3', 'ikimasu'],
        ]),
      }),
    );
    const t = sentenceTask();
    t.strictness = pronunciationStrict;
    const pronunciationResult = evaluate(
      t,
      attempt({
        chunkOrder: ['c1', 'c2', 'c3'],
        rawInput: chunkInputs([
          ['c1', 'watashiwa'],
          ['c2', 'gakkoue'],
          ['c3', 'ikimasu'],
        ]),
      }),
    );
    expect(r.isCorrect).toBe(false);
    expect(pronunciationResult.isCorrect).toBe(true);
  });

  it('correct order but wrong reading on a chunk → not isCorrect', () => {
    const r = evaluate(
      sentenceTask(),
      attempt({
        chunkOrder: ['c1', 'c2', 'c3'],
        rawInput: chunkInputs([
          ['c1', 'watashiha'],
          ['c2', 'gakouhe'], // missing sokuon → sokuon_error
          ['c3', 'ikimasu'],
        ]),
      }),
    );
    expect(r.isCorrect).toBe(false);
    // Some chunk should have flagged a reading error; we don't pin the exact tag (depends on
    // wanakana's normalisation) but we expect at least one error tag and no word_order_error.
    expect(r.errorTags).not.toContain('word_order_error');
    expect(r.errorTags.length).toBeGreaterThan(0);
  });

  it('order-only judgement when chunks metadata absent', () => {
    const r = evaluate(
      task({ answerMode: 'sentence_chunk_order', expected: { chunkOrder: ['a', 'b'] } }),
      attempt({ chunkOrder: ['b', 'a'] }),
    );
    expect(r.isCorrect).toBe(false);
    expect(r.errorTags).toContain('word_order_error');
  });
});

describe('evaluate — option_select', () => {
  // 橋 / 箸 / 端 — three same-sound options.
  const choiceTask = (overrides: Partial<TrainingTask> = {}): TrainingTask =>
    task({
      answerMode: 'option_select',
      skillDimension: 'meaning_recall',
      gameType: 'space_battle',
      expected: { optionId: 'opt-bridge' },
      options: [
        { id: 'opt-bridge', label: '橋', kana: 'はし', isCorrect: true },
        {
          id: 'opt-chopsticks',
          label: '箸',
          kana: 'はし',
          isCorrect: false,
          errorTagIfChosen: 'same_sound_confusion',
        },
        {
          id: 'opt-edge',
          label: '端',
          kana: 'はし',
          isCorrect: false,
          errorTagIfChosen: 'same_sound_confusion',
        },
      ],
      ...overrides,
    });

  it('correct pick → isCorrect, no errorTags', () => {
    const r = evaluate(choiceTask(), attempt({ selectedOptionId: 'opt-bridge' }));
    expect(r.isCorrect).toBe(true);
    expect(r.errorTags).toEqual([]);
    expect(r.expectedDisplay).toBe('橋');
    expect(r.actualDisplay).toBe('橋');
  });

  it('wrong pick → option.errorTagIfChosen surfaces', () => {
    const r = evaluate(choiceTask(), attempt({ selectedOptionId: 'opt-chopsticks' }));
    expect(r.isCorrect).toBe(false);
    expect(r.errorTags).toEqual(['same_sound_confusion']);
    expect(r.actualDisplay).toBe('箸');
  });

  it('wrong pick without errorTagIfChosen falls back to meaning_confusion', () => {
    const t = choiceTask();
    t.options = t.options!.map((o) =>
      o.id === 'opt-chopsticks'
        ? ({ id: o.id, label: o.label, kana: o.kana, isCorrect: false } as typeof o)
        : o,
    );
    const r = evaluate(t, attempt({ selectedOptionId: 'opt-chopsticks' }));
    expect(r.isCorrect).toBe(false);
    expect(r.errorTags).toEqual(['meaning_confusion']);
  });

  it('absent selectedOptionId (timeout) → timeout tag', () => {
    const r = evaluate(choiceTask(), attempt({}));
    expect(r.isCorrect).toBe(false);
    expect(r.errorTags).toEqual(['timeout']);
    expect(r.actualDisplay).toBe('∅');
  });

  it('selectedOptionId not in task.options → misclick', () => {
    const r = evaluate(choiceTask(), attempt({ selectedOptionId: 'opt-rogue' }));
    expect(r.isCorrect).toBe(false);
    expect(r.errorTags).toEqual(['misclick']);
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
