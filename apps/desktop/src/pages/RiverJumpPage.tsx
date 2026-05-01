import {
  evaluate,
  selectSentenceOrderTasks,
  type EvaluationResult,
  type EvaluationStrictness,
  type SelectedSentenceTaskQueue,
  type TrainingTask,
  type UserAttempt,
} from '@kana-typing/core';
import type { GameBridgeAdapter } from '@kana-typing/game-runtime';
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';

import { GameCanvasHost } from '../features/game/GameCanvasHost';
import { GameHud } from '../features/game/GameHud';
import {
  getFoundationsPackInfo,
  loadFoundationsSentences,
} from '../features/sentences/sentencesData';

// RiverJump session is ephemeral — sentence training does not yet have its own SQLite
// schema (v0.8.x will introduce one). The whole loop runs in memory: tasks come from the
// foundations pack, attempts go through `evaluate()` for feedback, nothing is persisted.
// The session id below is local-only and never travels to a Tauri command.

const STRICT_POLICY: EvaluationStrictness = {
  longVowel: 'strict',
  sokuon: 'strict',
  dakuten: 'strict',
  handakuten: 'strict',
  youon: 'strict',
  kanjiSurface: 'strict',
  particleReading: 'surface',
};

const SESSION_DURATION_MS = 180_000; // 3 minutes
const TASK_TIME_LIMIT_MS = 25_000;
const TASK_COUNT = 12;

interface SessionStats {
  attempts: number;
  correct: number;
  remainingMs: number;
  recent: EvaluationResult[];
}

export function RiverJumpPage(): JSX.Element {
  const sessionId = useMemo(() => generateEphemeralId(), []);
  const startedAtRef = useRef<number>(Date.now());
  const queueRef = useRef<SelectedSentenceTaskQueue | null>(null);
  const currentTaskRef = useRef<TrainingTask | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [stats, setStats] = useState<SessionStats>({
    attempts: 0,
    correct: 0,
    remainingMs: SESSION_DURATION_MS,
    recent: [],
  });

  useEffect(() => {
    try {
      const sentences = loadFoundationsSentences();
      const queue = selectSentenceOrderTasks({
        sentences,
        count: TASK_COUNT,
        sessionId,
        gameType: 'river_jump',
        skillDimension: 'sentence_order',
        strictness: STRICT_POLICY,
        timeLimitMs: TASK_TIME_LIMIT_MS,
      });
      if (queue.remaining() === 0) {
        setBootError('No sentences available in the foundations pack.');
        return;
      }
      queueRef.current = queue;
      startedAtRef.current = Date.now();
    } catch (err) {
      setBootError((err as Error).message);
    }
  }, [sessionId]);

  // Wall-clock timer tick. RiverJump's queue is bounded (TASK_COUNT) so the user typically
  // finishes earlier; the timer is a safety net + the HUD countdown.
  useEffect(() => {
    if (bootError) return;
    const handle = globalThis.setInterval(() => {
      const remaining = Math.max(0, SESSION_DURATION_MS - (Date.now() - startedAtRef.current));
      setStats((s) => ({ ...s, remainingMs: remaining }));
      if (remaining <= 0) {
        globalThis.clearInterval(handle);
        navigateHome();
      }
    }, 250);
    return () => globalThis.clearInterval(handle);
  }, [bootError]);

  const adapter = useMemo<GameBridgeAdapter>(
    () => ({
      requestNextTask(): Promise<TrainingTask | null> {
        if (Date.now() - startedAtRef.current >= SESSION_DURATION_MS) {
          currentTaskRef.current = null;
          return Promise.resolve(null);
        }
        const next = queueRef.current?.next() ?? null;
        currentTaskRef.current = next;
        return Promise.resolve(next);
      },
      submitAttempt(attempt: UserAttempt): Promise<EvaluationResult> {
        const task = currentTaskRef.current;
        if (!task || task.id !== attempt.taskId) {
          return Promise.reject(
            new Error(
              `task identity mismatch — adapter has ${task?.id ?? 'null'}, attempt is for ${attempt.taskId}`,
            ),
          );
        }
        const result = evaluate(task, attempt);
        setStats((s) => ({
          attempts: s.attempts + 1,
          correct: s.correct + (result.isCorrect ? 1 : 0),
          remainingMs: s.remainingMs,
          recent: [result, ...s.recent].slice(0, 6),
        }));
        if (result.shouldRepeatImmediately) {
          queueRef.current?.pushFront(task);
        }
        return Promise.resolve(result);
      },
      finishSession(): Promise<void> {
        navigateHome();
        return Promise.resolve();
      },
    }),
    [],
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

  if (!queueRef.current) {
    return (
      <div style={{ padding: 10, height: '100%' }}>
        <div className="r-group">
          <div className="title">▌ 激流勇进 — 句子语序训练</div>
          <div style={{ color: 'var(--kt2-fg-dim)' }}>Booting session...</div>
        </div>
      </div>
    );
  }

  const packInfo = getFoundationsPackInfo();

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
          ▌ 激流勇进 — {packInfo.name} v{packInfo.version} · {TASK_COUNT} 句
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
            onSessionFinished={navigateHome}
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
          ↵ ENTER 提交 · ⌫ BACKSPACE 编辑 · 顺序错 = 跳水 · 本模式 attempt 暂未持久化 [v0.8.0]
        </div>
      </div>
    </div>
  );
}

function navigateHome(): void {
  if (globalThis.location.hash !== '#/') {
    globalThis.location.hash = '#/';
  }
}

function generateEphemeralId(): string {
  const uuid =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString()}-${Math.random().toString(16).slice(2)}`;
  return `ephemeral-river-jump-${uuid}`;
}
