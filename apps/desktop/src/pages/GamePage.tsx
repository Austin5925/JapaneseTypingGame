import {
  selectKanaTasks,
  type EvaluationStrictness,
  type LearningItem,
  type SelectedTaskQueue,
  type SkillProgress,
  type TrainingTask,
  type UserAttempt,
} from '@kana-typing/core';
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';

import { GameCanvasHost } from '../features/game/GameCanvasHost';
import { GameHud } from '../features/game/GameHud';
import { GameSessionService } from '../features/session/GameSessionService';
import { listItems, type DevItemRow } from '../tauri/invoke';

const STRICT_POLICY: EvaluationStrictness = {
  longVowel: 'strict',
  sokuon: 'strict',
  dakuten: 'strict',
  handakuten: 'strict',
  youon: 'strict',
  kanjiSurface: 'strict',
  particleReading: 'surface',
};

const SESSION_DURATION_MS = 60_000;

interface SessionStats {
  attempts: number;
  correct: number;
  remainingMs: number;
}

/**
 * Sprint 3 game page (`#/game/mole`). Boots a 60-second whack-a-mole training round backed by
 * the n5-basic-mini items. Wires together:
 *   - GameSessionService (owns SQLite writes)
 *   - selectKanaTasks (the task queue)
 *   - GameCanvasHost (Phaser MoleScene)
 * via a small adapter that the canvas's GameBridge calls into.
 */
export function GamePage(): JSX.Element {
  const [items, setItems] = useState<DevItemRow[] | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [stats, setStats] = useState<SessionStats>({
    attempts: 0,
    correct: 0,
    remainingMs: SESSION_DURATION_MS,
  });
  const [error, setError] = useState<string | null>(null);

  const sessionRef = useRef<GameSessionService | null>(null);
  const queueRef = useRef<SelectedTaskQueue | null>(null);
  const startedAtRef = useRef<number>(Date.now());

  const session = useMemo(() => new GameSessionService({ bufferAttempts: false }), []);
  sessionRef.current = session;

  // Boot once.
  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        const rows = await listItems({ limit: 100 });
        if (rows.length === 0) {
          setError('No items in DB. Visit #/dev to seed the test pack first.');
          return;
        }
        setItems(rows);
        const created = await session.create({
          gameType: 'mole_story',
          targetDurationMs: SESSION_DURATION_MS,
        });
        setSessionId(created.id);
        const learningItems: LearningItem[] = rows.map(rowToItem);
        const queue = selectKanaTasks({
          items: learningItems,
          progress: new Map<string, SkillProgress>(),
          count: 60, // plenty for a 60s session
          sessionId: created.id,
          gameType: 'mole_story',
          answerMode: 'romaji_to_kana',
          skillDimension: 'kana_typing',
          timeLimitMs: 6000,
          strictness: STRICT_POLICY,
        });
        queueRef.current = queue;
        startedAtRef.current = Date.now();
      } catch (err) {
        setError((err as Error).message);
      }
    })();
    return () => {
      void session.finish('aborted').catch((err: unknown) => {
        console.warn('GamePage cleanup: finish failed', err);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tick the 60-second timer.
  useEffect(() => {
    if (!sessionId) return;
    const handle = globalThis.setInterval(() => {
      const remaining = Math.max(0, SESSION_DURATION_MS - (Date.now() - startedAtRef.current));
      setStats((s) => ({ ...s, remainingMs: remaining }));
      if (remaining <= 0) {
        globalThis.clearInterval(handle);
        // Finish the session and route to result.
        void (async (): Promise<void> => {
          try {
            await sessionRef.current?.finish('finished');
            globalThis.location.hash = `#/result/${sessionId}`;
          } catch (err) {
            setError((err as Error).message);
          }
        })();
      }
    }, 250);
    return () => globalThis.clearInterval(handle);
  }, [sessionId]);

  // The scene calls `submitAttempt(attempt)` referencing a `taskId`; the adapter has to
  // remember which task it last handed out so it can recover the full TrainingTask for the
  // evaluator. We hold it in a ref because the adapter closure is stable across renders.
  const currentTaskRef = useRef<TrainingTask | null>(null);

  const adapter = useMemo(
    () => ({
      requestNextTask(): Promise<TrainingTask | null> {
        // End-of-time sentinel: scene will see null and finish.
        if (Date.now() - startedAtRef.current >= SESSION_DURATION_MS) {
          currentTaskRef.current = null;
          return Promise.resolve(null);
        }
        const next = queueRef.current?.next() ?? null;
        currentTaskRef.current = next;
        return Promise.resolve(next);
      },
      async submitAttempt(attempt: UserAttempt) {
        const task = currentTaskRef.current;
        if (!task || task.id !== attempt.taskId) {
          throw new Error(
            `task identity mismatch — adapter has ${task?.id ?? 'null'}, attempt is for ${attempt.taskId}`,
          );
        }
        const result = await sessionRef.current!.submitAttempt(task, attempt);
        setStats((s) => ({
          ...s,
          attempts: s.attempts + 1,
          correct: s.correct + (result.isCorrect ? 1 : 0),
        }));
        if (result.shouldRepeatImmediately) {
          queueRef.current?.pushFront(task);
        }
        return result;
      },
      async finishSession(): Promise<void> {
        await sessionRef.current!.finish('finished');
        globalThis.location.hash = `#/result/${sessionId ?? ''}`;
      },
    }),
    [sessionId],
  );

  if (error) {
    return (
      <section style={{ padding: '2rem', maxWidth: '720px', margin: '0 auto' }}>
        <h1>Game error</h1>
        <p style={{ color: 'var(--err)' }}>{error}</p>
        <p>
          <a href="#/">go home</a>
        </p>
      </section>
    );
  }
  if (!items || !sessionId) {
    return (
      <section style={{ padding: '2rem', maxWidth: '720px', margin: '0 auto' }}>
        <p>Loading…</p>
      </section>
    );
  }

  return (
    <section style={{ padding: '1rem' }}>
      <h1 style={{ textAlign: 'center' }}>鼹鼠的故事 — 60s 假名训练</h1>
      <GameHud
        remainingMs={stats.remainingMs}
        attemptsCount={stats.attempts}
        correctCount={stats.correct}
      />
      <GameCanvasHost sessionId={sessionId} adapter={adapter} width={800} height={480} />
      <p style={{ textAlign: 'center', color: 'var(--muted)', marginTop: '0.75rem' }}>
        type romaji + Enter. Backspace edits. Esc-to-quit lands in Sprint 4.
      </p>
    </section>
  );
}

// Convert the dev DTO returned by `list_items` into a (partial) LearningItem suitable for the
// task selector. The selector only needs id / surface / kana / tags / skillTags, so we fill
// the rest with sane defaults.
function rowToItem(row: DevItemRow): LearningItem {
  const item: LearningItem = {
    id: row.id,
    type: 'word',
    surface: row.surface,
    kana: row.kana,
    romaji: row.romaji,
    meaningsZh: [],
    tags: [],
    skillTags: ['kana_typing'],
    examples: [],
    audioRefs: [],
    confusableItemIds: [],
    sourcePackId: 'unknown',
    quality: 'official',
    createdAt: '',
    updatedAt: '',
  };
  if (row.jlpt !== undefined && row.jlpt !== '') {
    item.jlpt = row.jlpt as NonNullable<LearningItem['jlpt']>;
  }
  return item;
}
