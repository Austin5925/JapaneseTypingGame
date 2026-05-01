import {
  selectChoiceTasks,
  type EvaluationStrictness,
  type LearningItem,
  type SelectedChoiceTaskQueue,
  type TrainingTask,
  type UserAttempt,
} from '@kana-typing/core';
import type { GameBridgeAdapter } from '@kana-typing/game-runtime';
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';

import { buildProgressMap, rowToLearningItem } from '../features/db/rowConversions';
import { GameCanvasHost } from '../features/game/GameCanvasHost';
import { GameHud } from '../features/game/GameHud';
import { GameSessionService } from '../features/session/GameSessionService';
import { listItems, listProgress } from '../tauri/invoke';

const STRICT_POLICY: EvaluationStrictness = {
  longVowel: 'strict',
  sokuon: 'strict',
  dakuten: 'strict',
  handakuten: 'strict',
  youon: 'strict',
  kanjiSurface: 'strict',
  particleReading: 'surface',
};

const DEFAULT_SESSION_DURATION_MS = 180_000;
const TASK_TIME_LIMIT_MS = 8000;
const DEFAULT_TASK_COUNT = 16;
const DISTRACTOR_COUNT = 3;

export interface SpaceBattlePageProps {
  overrides?: { durationMs?: number } | undefined;
}

interface SessionStats {
  attempts: number;
  correct: number;
  remainingMs: number;
}

/**
 * v0.8.3 SpaceBattle page — SQLite-driven boot.
 *
 * Pulls every confusable-tagged item from `listItems`, runs `selectChoiceTasks` weighted by
 * `listProgress`, persists attempts through `GameSessionService`. Bypasses the in-memory pack
 * loader that v0.8.1 used; the same path now lights up `attempt_events` + `item_skill_progress`
 * so the scheduler / mistakes book / cross-game effects all see SpaceBattle outcomes.
 */
export function SpaceBattlePage(props: SpaceBattlePageProps = {}): JSX.Element {
  const sessionDurationMs = props.overrides?.durationMs ?? DEFAULT_SESSION_DURATION_MS;
  const taskCount = Math.max(
    1,
    Math.round((sessionDurationMs / DEFAULT_SESSION_DURATION_MS) * DEFAULT_TASK_COUNT),
  );
  const session = useMemo(() => new GameSessionService({ bufferAttempts: false }), []);
  const sessionRef = useRef<GameSessionService | null>(null);
  sessionRef.current = session;

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [stats, setStats] = useState<SessionStats>({
    attempts: 0,
    correct: 0,
    remainingMs: sessionDurationMs,
  });

  const queueRef = useRef<SelectedChoiceTaskQueue | null>(null);
  const currentTaskRef = useRef<TrainingTask | null>(null);
  const startedAtRef = useRef<number>(Date.now());

  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        const [rows, progressDtos] = await Promise.all([
          listItems({ limit: 1000 }),
          listProgress({ userId: 'default-user', limit: 5000 }),
        ]);
        const confusables = rows.filter((r) => r.type === 'word' && r.tags.includes('confusable'));
        if (confusables.length < DISTRACTOR_COUNT + 1) {
          setBootError(
            'No confusable items in DB. Visit #/dev to seed the foundations packs first.',
          );
          return;
        }
        const created = await session.create({
          gameType: 'space_battle',
          targetDurationMs: sessionDurationMs,
        });
        setSessionId(created.id);
        const items: LearningItem[] = confusables.map(rowToLearningItem);
        const progressMap = buildProgressMap(progressDtos);
        const queue = selectChoiceTasks({
          items,
          progress: progressMap,
          count: taskCount,
          sessionId: created.id,
          gameType: 'space_battle',
          skillDimension: 'meaning_recall',
          strictness: STRICT_POLICY,
          distractorCount: DISTRACTOR_COUNT,
          timeLimitMs: TASK_TIME_LIMIT_MS,
          preferTags: ['confusable'],
        });
        if (queue.remaining() === 0) {
          setBootError('Confusables pack present but no eligible items found for option_select.');
          return;
        }
        queueRef.current = queue;
        startedAtRef.current = Date.now();
      } catch (err) {
        setBootError((err as Error).message);
      }
    })();
    return () => {
      void session.finish('aborted').catch((err: unknown) => {
        console.warn('SpaceBattle cleanup: finish failed', err);
      });
    };
  }, [session, sessionDurationMs, taskCount]);

  // Wall-clock countdown — same shape as GamePage / RiverJump.
  useEffect(() => {
    if (!sessionId) return;
    const handle = globalThis.setInterval(() => {
      const remaining = Math.max(0, sessionDurationMs - (Date.now() - startedAtRef.current));
      setStats((s) => ({ ...s, remainingMs: remaining }));
      if (remaining <= 0) {
        globalThis.clearInterval(handle);
        void (async (): Promise<void> => {
          try {
            await sessionRef.current?.finish('finished');
          } catch (err) {
            console.warn('SpaceBattle timer: finish failed', err);
          }
          navigateToResult(sessionId);
        })();
      }
    }, 250);
    return () => globalThis.clearInterval(handle);
  }, [sessionId, sessionDurationMs]);

  const adapter = useMemo<GameBridgeAdapter>(
    () => ({
      requestNextTask: () => {
        if (Date.now() - startedAtRef.current >= sessionDurationMs) {
          currentTaskRef.current = null;
          return Promise.resolve(null);
        }
        const next = queueRef.current?.next() ?? null;
        currentTaskRef.current = next;
        return Promise.resolve(next);
      },
      submitAttempt: async (attempt: UserAttempt) => {
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
      finishSession: async (): Promise<void> => {
        try {
          await sessionRef.current?.finish('finished');
        } catch (err) {
          console.warn('SpaceBattle adapter: finish failed', err);
        }
        navigateToResult(sessionId);
      },
    }),
    [sessionId, sessionDurationMs],
  );

  if (bootError) {
    return (
      <div style={{ padding: 10, height: '100%' }}>
        <div className="r-group">
          <div className="title">▌ ERR · 太空大战</div>
          <div className="kt-banner kt-banner--err" style={{ marginBottom: 12 }}>
            <span className="kt-banner__glyph">!</span>
            <div style={{ fontSize: 13 }}>{bootError}</div>
          </div>
          <a href="#/" className="r-btn" style={{ textDecoration: 'none' }}>
            回首页
          </a>
        </div>
      </div>
    );
  }

  if (!sessionId || !queueRef.current) {
    return (
      <div style={{ padding: 10, height: '100%' }}>
        <div className="r-group">
          <div className="title">▌ 太空大战 — 同音/近形/中文误导词辨析</div>
          <div style={{ color: 'var(--kt2-fg-dim)' }}>Booting session...</div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: 10,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        className="r-group"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: '14px 12px 12px',
          minHeight: 0,
        }}
      >
        <div className="title">▌ 太空大战 — {taskCount} 题</div>

        <GameHud
          remainingMs={stats.remainingMs}
          attemptsCount={stats.attempts}
          correctCount={stats.correct}
        />

        <div
          className="r-crt"
          style={{
            alignSelf: 'center',
            width: 808,
            minWidth: 808,
            height: 488,
            padding: 0,
            flexShrink: 0,
          }}
        >
          <GameCanvasHost
            sessionId={sessionId}
            sceneKey="SpaceBattleScene"
            adapter={adapter}
            width={800}
            height={480}
            onSessionFinished={() => navigateToResult(sessionId)}
          />
        </div>

        <div
          style={{
            textAlign: 'center',
            fontFamily: 'var(--pix-font)',
            fontSize: 13,
            color: 'var(--kt2-fg-dim)',
            letterSpacing: '0.04em',
          }}
        >
          数字键 1-4 锁定目标 · 击中正确者 = 通过 · attempt 写入 SQLite [v0.8.3]
        </div>
      </div>
    </div>
  );
}

function navigateToResult(sessionId: string | null): void {
  if (!sessionId) return;
  const target = `#/result/${sessionId}`;
  if (globalThis.location.hash !== target) {
    globalThis.location.hash = target;
  }
}
