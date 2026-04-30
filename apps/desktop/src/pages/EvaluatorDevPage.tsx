import {
  type AnswerMode,
  type EvaluationResult,
  type EvaluationStrictness,
  type SkillDimension,
  type TrainingTask,
} from '@kana-typing/core';
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';

import { ImeInputBox } from '../features/input/ImeInputBox';
import { GameSessionService, generateId } from '../features/session/GameSessionService';
import {
  getProgress,
  listItems,
  listRecentAttempts,
  type AttemptEventRow,
  type DevItemRow,
  type ProgressDto,
} from '../tauri/invoke';

const STRICT_POLICY: EvaluationStrictness = {
  longVowel: 'strict',
  sokuon: 'strict',
  dakuten: 'strict',
  handakuten: 'strict',
  youon: 'strict',
  kanjiSurface: 'strict',
  particleReading: 'surface',
};

const ANSWER_MODES: AnswerMode[] = [
  'kana_input',
  'romaji_to_kana',
  'kanji_to_reading',
  'meaning_to_surface',
  'ime_surface',
];

const SKILL_BY_MODE: Record<AnswerMode, SkillDimension> = {
  kana_input: 'kana_typing',
  romaji_to_kana: 'kana_typing',
  kanji_to_reading: 'kanji_reading',
  meaning_to_surface: 'meaning_recall',
  ime_surface: 'ime_conversion',
  audio_to_surface: 'listening_discrimination',
  sentence_chunk_order: 'sentence_order',
};

export function EvaluatorDevPage(): JSX.Element {
  const [items, setItems] = useState<DevItemRow[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [answerMode, setAnswerMode] = useState<AnswerMode>('kana_input');
  const [progress, setProgress] = useState<ProgressDto | null>(null);
  const [recent, setRecent] = useState<AttemptEventRow[]>([]);
  const [lastResult, setLastResult] = useState<EvaluationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitStartRef = useRef<number>(Date.now());

  const session = useMemo(() => new GameSessionService(), []);
  const sessionInitedRef = useRef(false);

  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        const rows = await listItems({ limit: 100 });
        setItems(rows);
        if (rows.length > 0 && !selectedItemId) {
          setSelectedItemId(rows[0]!.id);
        }
        if (!sessionInitedRef.current) {
          await session.create({ gameType: 'speed_chase' });
          sessionInitedRef.current = true;
        }
      } catch (err) {
        setError((err as Error).message);
      }
    })();
    return () => {
      // Best-effort: finish session on unmount. Failures are silent — the session row simply
      // stays in 'active' state until the next time the page mounts.
      void session.finish('aborted').catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedItemId) return;
    submitStartRef.current = Date.now();
    void (async (): Promise<void> => {
      try {
        const skill = SKILL_BY_MODE[answerMode];
        const p = await getProgress({
          userId: 'default-user',
          itemId: selectedItemId,
          skillDimension: skill,
        });
        setProgress(p);
        const r = await listRecentAttempts({
          userId: 'default-user',
          itemId: selectedItemId,
          limit: 10,
        });
        setRecent(r);
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, [selectedItemId, answerMode]);

  const selectedItem = items.find((it) => it.id === selectedItemId) ?? null;

  function buildTask(): TrainingTask | null {
    if (!selectedItem || !sessionInitedRef.current) return null;
    return {
      id: generateId('task'),
      sessionId: session.sessionId,
      itemId: selectedItem.id,
      gameType: 'speed_chase',
      answerMode,
      skillDimension: SKILL_BY_MODE[answerMode],
      prompt: { kind: 'text', text: selectedItem.surface },
      expected:
        answerMode === 'romaji_to_kana' ||
        answerMode === 'kana_input' ||
        answerMode === 'kanji_to_reading'
          ? { kana: selectedItem.kana }
          : answerMode === 'ime_surface'
            ? { surface: selectedItem.surface }
            : { surface: selectedItem.surface, kana: selectedItem.kana },
      difficulty: 0.5,
      allowHints: false,
      strictness: STRICT_POLICY,
      createdAt: new Date().toISOString(),
    };
  }

  async function onSubmit(value: string): Promise<void> {
    setError(null);
    const task = buildTask();
    if (!task) return;
    setBusy(true);
    try {
      const reactionTimeMs = Math.max(300, Date.now() - submitStartRef.current);
      const attempt = {
        id: generateId('att'),
        sessionId: session.sessionId,
        taskId: task.id,
        itemId: task.itemId,
        gameType: task.gameType,
        rawInput: value,
        committedInput: value,
        startedAt: new Date(submitStartRef.current).toISOString(),
        submittedAt: new Date().toISOString(),
        reactionTimeMs,
        usedHint: false,
        inputMethod: 'ime' as const,
      };
      const result = await session.submitAttempt(task, attempt);
      setLastResult(result);
      // Refresh views
      const p = await getProgress({
        userId: 'default-user',
        itemId: task.itemId,
        skillDimension: task.skillDimension,
      });
      setProgress(p);
      const r = await listRecentAttempts({
        userId: 'default-user',
        itemId: task.itemId,
        limit: 10,
      });
      setRecent(r);
      submitStartRef.current = Date.now();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ padding: '1.5rem', maxWidth: '1100px', margin: '0 auto' }}>
      <h1>Evaluator + Mastery Probe</h1>
      <p style={{ color: 'var(--muted)' }}>
        Sprint 2 dev page. Pick an item, type an answer, submit — the evaluator runs in
        @kana-typing/core, the attempt is logged to <code>attempt_events</code>, and progress for{' '}
        <code>(item, skillDimension)</code> updates with the next due date.
      </p>

      <section style={{ marginTop: '1.5rem' }}>
        <h2>Item + answer mode</h2>
        <label>
          item:&nbsp;
          <select
            value={selectedItemId}
            onChange={(e) => setSelectedItemId(e.target.value)}
            style={{ padding: '0.3rem 0.5rem', font: 'inherit' }}
          >
            {items.map((it) => (
              <option key={it.id} value={it.id}>
                {it.surface} ({it.kana}) — {it.id}
              </option>
            ))}
          </select>
        </label>
        <span style={{ marginLeft: '1rem' }}>
          <label>
            mode:&nbsp;
            <select
              value={answerMode}
              onChange={(e) => setAnswerMode(e.target.value as AnswerMode)}
              style={{ padding: '0.3rem 0.5rem', font: 'inherit' }}
            >
              {ANSWER_MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        </span>
      </section>

      <section style={{ marginTop: '1.5rem' }}>
        <h2>Type your answer</h2>
        <ImeInputBox
          mode={answerMode === 'romaji_to_kana' ? 'romaji' : 'ime_surface'}
          autoSubmitOnEnter
          onCommit={(v) => void onSubmit(v)}
          placeholder={`expected: ${selectedItem?.kana ?? '—'}`}
          showComposeIndicator
          disabled={busy || !selectedItem}
        />
        {error && <p style={{ color: 'var(--err)' }}>error: {error}</p>}
      </section>

      {lastResult && (
        <section style={{ marginTop: '1.5rem' }}>
          <h2>Last evaluation</h2>
          <table>
            <tbody>
              <tr>
                <td>isCorrect</td>
                <td style={{ color: lastResult.isCorrect ? 'var(--ok)' : 'var(--err)' }}>
                  <code>{String(lastResult.isCorrect)}</code>
                </td>
              </tr>
              <tr>
                <td>score</td>
                <td>
                  <code>
                    {lastResult.score.toFixed(1)} (acc={lastResult.accuracyScore.toFixed(2)}, speed=
                    {lastResult.speedScore.toFixed(2)}, confidence=
                    {lastResult.confidenceScore.toFixed(2)})
                  </code>
                </td>
              </tr>
              <tr>
                <td>error tags</td>
                <td>
                  <code>{lastResult.errorTags.join(', ') || '(none)'}</code>
                </td>
              </tr>
              <tr>
                <td>shouldRepeatImmediately</td>
                <td>
                  <code>{String(lastResult.shouldRepeatImmediately)}</code>
                </td>
              </tr>
              <tr>
                <td>cross-game effects</td>
                <td>
                  <code>
                    {lastResult.crossGameEffects.length === 0
                      ? '(none)'
                      : lastResult.crossGameEffects
                          .map(
                            (e) => `${e.targetGameType}/${e.skillDimension} (+${e.priorityBoost})`,
                          )
                          .join(' · ')}
                  </code>
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      )}

      <section style={{ marginTop: '1.5rem' }}>
        <h2>Progress for (item, skill)</h2>
        {progress ? (
          <table>
            <tbody>
              <tr>
                <td>state</td>
                <td>
                  <code>{progress.state}</code>
                </td>
              </tr>
              <tr>
                <td>mastery score</td>
                <td>
                  <code>{progress.masteryScore.toFixed(1)}</code>
                </td>
              </tr>
              <tr>
                <td>exposures / correct / wrong</td>
                <td>
                  <code>
                    {progress.exposureCount} / {progress.correctCount} / {progress.wrongCount}
                  </code>
                </td>
              </tr>
              <tr>
                <td>streak / lapseCount</td>
                <td>
                  <code>
                    {progress.streak} / {progress.lapseCount}
                  </code>
                </td>
              </tr>
              <tr>
                <td>nextDueAt</td>
                <td>
                  <code>{progress.nextDueAt ?? '—'}</code>
                </td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p style={{ color: 'var(--muted)' }}>No progress yet — submit an attempt.</p>
        )}
      </section>

      <section style={{ marginTop: '1.5rem' }}>
        <h2>Recent attempts (last 10)</h2>
        {recent.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>No attempts logged yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>time</th>
                <th>mode</th>
                <th>correct</th>
                <th>score</th>
                <th>tags</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id}>
                  <td>
                    <code>{new Date(r.createdAt).toLocaleTimeString()}</code>
                  </td>
                  <td>
                    <code>{r.answerMode}</code>
                  </td>
                  <td style={{ color: r.isCorrect ? 'var(--ok)' : 'var(--err)' }}>
                    <code>{String(r.isCorrect)}</code>
                  </td>
                  <td>
                    <code>{r.score.toFixed(1)}</code>
                  </td>
                  <td>
                    <code>{r.errorTags.join(', ') || '—'}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </section>
  );
}
