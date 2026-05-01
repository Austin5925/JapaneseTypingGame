import {
  evaluate,
  selectChoiceTasks,
  type EvaluationResult,
  type EvaluationStrictness,
  type SelectedChoiceTaskQueue,
  type TrainingTask,
  type UserAttempt,
} from '@kana-typing/core';
import type { GameBridgeAdapter } from '@kana-typing/game-runtime';
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';

import {
  getConfusablesPackInfo,
  loadConfusableItems,
} from '../features/confusables/confusablesData';
import { GameCanvasHost } from '../features/game/GameCanvasHost';
import { GameHud } from '../features/game/GameHud';

// SpaceBattle session is ephemeral (same trade-off as RiverJump v0.8.0): the confusables
// pack is bundled at build time and the boot path goes straight from JSON to selector to
// scene without touching SQLite. v0.8.x will fold confusables into the dev seed and switch
// to listItems-driven boot so attempts persist.

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
const TASK_TIME_LIMIT_MS = 8000;
const TASK_COUNT = 16;
const DISTRACTOR_COUNT = 3; // 1 correct + 3 wrong = 4 ships per task

interface SessionStats {
  attempts: number;
  correct: number;
  remainingMs: number;
  recent: EvaluationResult[];
}

export function SpaceBattlePage(): JSX.Element {
  const sessionId = useMemo(() => generateEphemeralId(), []);
  const startedAtRef = useRef<number>(Date.now());
  const queueRef = useRef<SelectedChoiceTaskQueue | null>(null);
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
      const items = loadConfusableItems();
      const queue = selectChoiceTasks({
        items,
        count: TASK_COUNT,
        sessionId,
        gameType: 'space_battle',
        skillDimension: 'meaning_recall',
        strictness: STRICT_POLICY,
        distractorCount: DISTRACTOR_COUNT,
        timeLimitMs: TASK_TIME_LIMIT_MS,
        preferTags: ['confusable'],
      });
      if (queue.remaining() === 0) {
        setBootError('No confusable items available — pack failed to load.');
        return;
      }
      queueRef.current = queue;
      startedAtRef.current = Date.now();
    } catch (err) {
      setBootError((err as Error).message);
    }
  }, [sessionId]);

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

  if (!queueRef.current) {
    return (
      <div style={{ padding: 10, height: '100%' }}>
        <div className="r-group">
          <div className="title">▌ 太空大战 — 同音/近形/中文误导词辨析</div>
          <div style={{ color: 'var(--kt2-fg-dim)' }}>Booting session...</div>
        </div>
      </div>
    );
  }

  const packInfo = getConfusablesPackInfo();

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
          ▌ 太空大战 — {packInfo.name} v{packInfo.version} · {TASK_COUNT} 题
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
            sceneKey="SpaceBattleScene"
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
          数字键 1-4 锁定目标 · 击中正确者 = 通过 · 本模式 attempt 暂未持久化 [v0.8.1]
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
  return `ephemeral-space-battle-${uuid}`;
}
