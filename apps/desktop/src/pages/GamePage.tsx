import {
  selectKanaTasks,
  type AnswerMode,
  type EvaluationStrictness,
  type GameType,
  type LearningItem,
  type SelectedTaskQueue,
  type SkillDimension,
  type SkillProgress,
  type TrainingTask,
  type UserAttempt,
} from '@kana-typing/core';
import { MOLE_SCENE_KEY, SPEED_CHASE_SCENE_KEY } from '@kana-typing/game-runtime';
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';

import { GameCanvasHost, type GameSceneKey } from '../features/game/GameCanvasHost';
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

interface SessionStats {
  attempts: number;
  correct: number;
  remainingMs: number;
}

export type GamePageMode = 'mole' | 'speed-chase';

interface ModeConfig {
  durationMs: number;
  gameType: GameType;
  sceneKey: GameSceneKey;
  answerMode: AnswerMode;
  skillDimension: SkillDimension;
  title: string;
  taskCount: number;
  timeLimitMs: number;
}

const MODE_CONFIG: Record<GamePageMode, ModeConfig> = {
  mole: {
    durationMs: 60_000,
    gameType: 'mole_story',
    sceneKey: MOLE_SCENE_KEY,
    answerMode: 'romaji_to_kana',
    skillDimension: 'kana_typing',
    title: '鼹鼠的故事 — 60s 假名训练',
    taskCount: 60,
    timeLimitMs: 6000,
  },
  'speed-chase': {
    durationMs: 180_000,
    gameType: 'speed_chase',
    sceneKey: SPEED_CHASE_SCENE_KEY,
    answerMode: 'romaji_to_kana',
    skillDimension: 'kanji_reading',
    title: '生死时速 — 3 分钟读音冲刺',
    taskCount: 90,
    timeLimitMs: 7000,
  },
};

export interface GamePageProps {
  mode: GamePageMode;
}

/**
 * Sprint 3+4 game page. `mode='mole'` is the 60s whack-a-mole route (`#/game/mole`);
 * `mode='speed-chase'` is the 3-minute kanji-reading sprint (`#/game/speed-chase`). Both
 * wire GameSessionService + selectKanaTasks + GameCanvasHost via the same shape — only the
 * scene key, duration, and skill dimension differ.
 */
export function GamePage(props: GamePageProps): JSX.Element {
  const config = MODE_CONFIG[props.mode];
  const SESSION_DURATION_MS = config.durationMs;
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
          gameType: config.gameType,
          targetDurationMs: SESSION_DURATION_MS,
        });
        setSessionId(created.id);
        const learningItems: LearningItem[] = rows.map(rowToItem);
        const queue = selectKanaTasks({
          items: learningItems,
          progress: new Map<string, SkillProgress>(),
          count: config.taskCount,
          sessionId: created.id,
          gameType: config.gameType,
          answerMode: config.answerMode,
          skillDimension: config.skillDimension,
          timeLimitMs: config.timeLimitMs,
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

  // Tick the session timer (mole = 60s, speed-chase = 180s; SESSION_DURATION_MS is closed
  // over per-render but the value is stable for a given mode, so the missing-dep lint warning
  // is intentional).
  useEffect(() => {
    if (!sessionId) return;
    const duration = SESSION_DURATION_MS;
    const handle = globalThis.setInterval(() => {
      const remaining = Math.max(0, duration - (Date.now() - startedAtRef.current));
      setStats((s) => ({ ...s, remainingMs: remaining }));
      if (remaining <= 0) {
        globalThis.clearInterval(handle);
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
  }, [sessionId, SESSION_DURATION_MS]);

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
    [sessionId, SESSION_DURATION_MS],
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
      <h1 style={{ textAlign: 'center' }}>{config.title}</h1>
      <GameHud
        remainingMs={stats.remainingMs}
        attemptsCount={stats.attempts}
        correctCount={stats.correct}
      />
      <GameCanvasHost
        sessionId={sessionId}
        sceneKey={config.sceneKey}
        adapter={adapter}
        width={800}
        height={480}
      />
      <p style={{ textAlign: 'center', color: 'var(--muted)', marginTop: '0.75rem' }}>
        type romaji + Enter. Backspace edits. Esc-to-quit lands in Sprint 5.
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
