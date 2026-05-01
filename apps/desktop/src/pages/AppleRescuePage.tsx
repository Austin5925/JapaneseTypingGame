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
const DEFAULT_TASK_COUNT = 12;
// Each minimal-pair item declares 1 confusable peer. distractorCount=1 keeps the listening
// task a binary minimal-pair choice — strongest training signal for long/sokuon/dakuten.
const DISTRACTOR_COUNT = 1;

export interface AppleRescuePageProps {
  overrides?: { durationMs?: number } | undefined;
}

interface SessionStats {
  attempts: number;
  correct: number;
  remainingMs: number;
}

/**
 * v0.8.3 AppleRescue page — SQLite-driven boot.
 *
 * Loads audio-discrim-tagged minimal pairs from listItems, runs selectChoiceTasks with
 * promptKind='audio' weighted by listProgress, persists attempts through GameSessionService.
 * The audio cue (kana via SpeechSynthesis) still lives inside AppleRescueScene; nothing on
 * the React side changes for v0.8.3 except the boot path.
 */
export function AppleRescuePage(props: AppleRescuePageProps = {}): JSX.Element {
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
        const audioDiscrim = rows.filter(
          (r) => r.type === 'word' && r.tags.includes('audio-discrim'),
        );
        if (audioDiscrim.length < DISTRACTOR_COUNT + 1) {
          setBootError(
            'No audio-discrim items in DB. Visit #/dev to seed the foundations packs first.',
          );
          return;
        }
        const created = await session.create({
          gameType: 'apple_rescue',
          targetDurationMs: sessionDurationMs,
        });
        setSessionId(created.id);
        const items: LearningItem[] = audioDiscrim.map(rowToLearningItem);
        const progressMap = buildProgressMap(progressDtos);
        const queue = selectChoiceTasks({
          items,
          progress: progressMap,
          count: taskCount,
          sessionId: created.id,
          gameType: 'apple_rescue',
          skillDimension: 'listening_discrimination',
          strictness: STRICT_POLICY,
          distractorCount: DISTRACTOR_COUNT,
          timeLimitMs: TASK_TIME_LIMIT_MS,
          promptKind: 'audio',
          preferTags: ['audio-discrim'],
        });
        if (queue.remaining() === 0) {
          setBootError('Audio-discrim pack present but no eligible items.');
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
        console.warn('AppleRescue cleanup: finish failed', err);
      });
    };
  }, [session, sessionDurationMs, taskCount]);

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
            console.warn('AppleRescue timer: finish failed', err);
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
          console.warn('AppleRescue adapter: finish failed', err);
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
          <div className="title">▌ ERR · 拯救苹果</div>
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
          <div className="title">▌ 拯救苹果 — 听辨长音/促音/浊音</div>
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
        <div className="title">▌ 拯救苹果 — {taskCount} 题</div>

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
            sceneKey="AppleRescueScene"
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
          ←/→ 移动篮子 · R 重听 · S 慢速 · attempt 写入 SQLite [v0.8.3]
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
