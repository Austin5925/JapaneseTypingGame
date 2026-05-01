import {
  selectSentenceOrderTasks,
  type EvaluationStrictness,
  type SelectedSentenceTaskQueue,
  type SentenceItem,
  type SkillDimension,
  type TrainingTask,
  type UserAttempt,
} from '@kana-typing/core';
import type { GameBridgeAdapter } from '@kana-typing/game-runtime';
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';

import { buildProgressMap, rowToSentenceItem } from '../features/db/rowConversions';
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
  particleReading: 'pronunciation',
};

const DEFAULT_SESSION_DURATION_MS = 180_000;
const TASK_TIME_LIMIT_MS = 25_000;
const DEFAULT_TASK_COUNT = 12;
const DEFAULT_SKILL_DIMENSION: SkillDimension = 'sentence_order';
const PARTICLE_TAGS = [
  'particle-ha',
  'particle-he',
  'particle-wo',
  'particle-ga',
  'particle-ni',
  'particle-de',
  'particle-to',
  'particle-kara',
  'particle-made',
];

export interface RiverJumpPageProps {
  overrides?:
    | {
        durationMs?: number;
        skillDimension?: SkillDimension;
      }
    | undefined;
}

interface SessionStats {
  attempts: number;
  correct: number;
  remainingMs: number;
}

/**
 * v0.8.3 RiverJump page — SQLite-driven boot.
 *
 * Sentence content lives in `learning_items` rows of `type='sentence'`, with the chunk
 * structure / acceptedOrders / zhPrompt JSON-encoded into `extras_json`. We pull every
 * sentence row, reverse the encoding via `rowToSentenceItem`, and feed the resulting
 * `SentenceItem[]` to `selectSentenceOrderTasks`. Attempts now persist through
 * `GameSessionService`, which means `attempt_events` + `item_skill_progress` capture
 * sentence-order outcomes and the cross-game scheduler can route them.
 */
export function RiverJumpPage(props: RiverJumpPageProps = {}): JSX.Element {
  const sessionDurationMs = props.overrides?.durationMs ?? DEFAULT_SESSION_DURATION_MS;
  const taskCount = Math.max(
    1,
    Math.round((sessionDurationMs / DEFAULT_SESSION_DURATION_MS) * DEFAULT_TASK_COUNT),
  );
  const skillDimension = riverSkillFromOverride(props.overrides?.skillDimension);
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

  const queueRef = useRef<SelectedSentenceTaskQueue | null>(null);
  const currentTaskRef = useRef<TrainingTask | null>(null);
  const startedAtRef = useRef<number>(Date.now());

  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        const [rows, progressDtos] = await Promise.all([
          listItems({ limit: 1000 }),
          listProgress({ userId: 'default-user', limit: 5000 }),
        ]);
        const sentences: SentenceItem[] = rows
          .filter((r) => r.type === 'sentence')
          .map(rowToSentenceItem)
          .filter((s): s is SentenceItem => s !== null);
        if (sentences.length === 0) {
          setBootError(
            'No sentence-typed items in DB. Visit #/dev to seed the foundations packs first.',
          );
          return;
        }
        const created = await session.create({
          gameType: 'river_jump',
          targetDurationMs: sessionDurationMs,
        });
        setSessionId(created.id);
        const progressMap = buildProgressMap(progressDtos);
        const queue = selectSentenceOrderTasks({
          sentences,
          progress: progressMap,
          count: taskCount,
          sessionId: created.id,
          gameType: 'river_jump',
          skillDimension,
          strictness: STRICT_POLICY,
          timeLimitMs: TASK_TIME_LIMIT_MS,
          ...(skillDimension === 'particle_usage' && { preferTags: PARTICLE_TAGS }),
        });
        if (queue.remaining() === 0) {
          setBootError('Sentences seeded but no eligible tasks could be built.');
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
        console.warn('RiverJump cleanup: finish failed', err);
      });
    };
  }, [session, sessionDurationMs, skillDimension, taskCount]);

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
            console.warn('RiverJump timer: finish failed', err);
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
          console.warn('RiverJump adapter: finish failed', err);
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
          <div className="title">▌ ERR · 激流勇进</div>
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
          <div className="title">▌ 激流勇进 — {labelForRiverSkill(skillDimension)}</div>
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
        <div className="title">
          ▌ 激流勇进 — {taskCount} 句 · {labelForRiverSkill(skillDimension)}
        </div>

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
            sceneKey="RiverJumpScene"
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
          ↵ ENTER 提交 · ⌫ BACKSPACE 编辑 · 顺序错 = 跳水 · attempt 写入 SQLite [v0.8.3]
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

function riverSkillFromOverride(skill: SkillDimension | undefined): SkillDimension {
  if (skill === 'particle_usage') return 'particle_usage';
  return DEFAULT_SKILL_DIMENSION;
}

function labelForRiverSkill(skill: SkillDimension): string {
  return skill === 'particle_usage' ? '助词读音 / 用法训练' : '句子语序训练';
}
