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
import { useEffect, useMemo, useRef, useState, type JSX, type RefObject } from 'react';

import {
  GameCanvasHost,
  type GameCanvasExternalInputControl,
  type GameSceneKey,
} from '../features/game/GameCanvasHost';
import { GameHud } from '../features/game/GameHud';
import { ImeInputBox } from '../features/input/ImeInputBox';
import type { ImeInputState } from '../features/input/useImeInputController';
import { GameSessionService, toDomainProgress } from '../features/session/GameSessionService';
import { listItems, listProgress, type DevItemRow, type ProgressDto } from '../tauri/invoke';

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
  timeLimitMs?: number;
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
  },
};

/** Where the user actually types. `romaji` keeps the existing Phaser keyboard pump (ASCII →
 * wanakana → kana). `ime_surface` mounts an `<ImeInputBox>` outside the canvas so a real OS
 * IME can run; the IME-finalised value is pushed into the scene through GameBridge. */
export type GameInputMode = 'romaji' | 'ime_surface';

export interface GameRouteOverrides {
  durationMs?: number;
  skillDimension?: SkillDimension;
  inputMode?: GameInputMode;
}

export interface GamePageProps {
  mode: GamePageMode;
  overrides?: GameRouteOverrides | undefined;
}

/**
 * Sprint 3+4 game page. `mode='mole'` is the 60s whack-a-mole route (`#/game/mole`);
 * `mode='speed-chase'` is the 3-minute kanji-reading sprint (`#/game/speed-chase`). Both
 * wire GameSessionService + selectKanaTasks + GameCanvasHost via the same shape — only the
 * scene key, duration, and skill dimension differ.
 */
export function GamePage(props: GamePageProps): JSX.Element {
  const baseConfig = MODE_CONFIG[props.mode];
  const durationMs = props.overrides?.durationMs ?? baseConfig.durationMs;
  const config: ModeConfig = {
    ...baseConfig,
    durationMs,
    skillDimension: props.overrides?.skillDimension ?? baseConfig.skillDimension,
    taskCount: Math.max(1, Math.round((durationMs / baseConfig.durationMs) * baseConfig.taskCount)),
  };
  const SESSION_DURATION_MS = config.durationMs;
  // Only speed-chase honours `inputMode=ime_surface` for now (mole stays romaji until P0-x in a
  // future sprint). For other modes we silently fall back to romaji.
  const inputMode: GameInputMode =
    props.mode === 'speed-chase' && props.overrides?.inputMode === 'ime_surface'
      ? 'ime_surface'
      : 'romaji';
  const externalInputRef = useRef<GameCanvasExternalInputControl | null>(null);
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
        const [rows, progressDtos] = await Promise.all([
          listItems({ limit: 1000 }),
          listProgress({ userId: 'default-user', limit: 5000 }),
        ]);
        if (rows.length === 0) {
          setError('No items in DB. Visit #/dev to seed the test pack first.');
          return;
        }
        setItems(rows);
        const progressMap = buildProgressMap(progressDtos);
        const created = await session.create({
          gameType: config.gameType,
          targetDurationMs: SESSION_DURATION_MS,
        });
        setSessionId(created.id);
        const learningItems: LearningItem[] = rows.map(rowToItem);
        const preferTags = preferTagsForSkill(config.skillDimension);
        const queue = selectKanaTasks({
          items: learningItems,
          progress: progressMap,
          count: config.taskCount,
          sessionId: created.id,
          gameType: config.gameType,
          answerMode: config.answerMode,
          skillDimension: config.skillDimension,
          strictness: STRICT_POLICY,
          ...(config.timeLimitMs !== undefined && { timeLimitMs: config.timeLimitMs }),
          ...(preferTags.length > 0 && { preferTags }),
        });
        if (queue.remaining() === 0) {
          setError(`No eligible items for skillDimension=${config.skillDimension}.`);
          return;
        }
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
      <div style={{ padding: 10, height: '100%' }}>
        <div className="r-group">
          <div className="title">▌ ERR · Game</div>
          <div className="kt-banner kt-banner--err" style={{ marginBottom: 12 }}>
            <span className="kt-banner__glyph">!</span>
            <div style={{ fontSize: 13 }}>{error}</div>
          </div>
          <a href="#/" className="r-btn" style={{ textDecoration: 'none' }}>
            回首页
          </a>
        </div>
      </div>
    );
  }
  if (!items || !sessionId) {
    return (
      <div style={{ padding: 10, height: '100%' }}>
        <div className="r-group">
          <div className="title">▌ {config.title}</div>
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
        <div className="title">▌ {config.title}</div>

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
            height: 488,
            padding: 0,
          }}
        >
          <GameCanvasHost
            sessionId={sessionId}
            sceneKey={config.sceneKey}
            adapter={adapter}
            width={800}
            height={480}
            externalInputRef={externalInputRef}
            sceneInit={inputMode === 'ime_surface' ? { inputSource: 'external' } : {}}
          />
        </div>

        {inputMode === 'ime_surface' ? (
          <ImeModeInputArea externalInputRef={externalInputRef} />
        ) : (
          <div
            style={{
              textAlign: 'center',
              fontFamily: 'var(--pix-font)',
              fontSize: 13,
              color: 'var(--kt2-fg-dim)',
              letterSpacing: '0.04em',
            }}
          >
            ↵ ENTER 提交 · ⌫ BACKSPACE 编辑 · Esc 退出 [v0.7+]
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * IME-mode footer: an `<ImeInputBox>` mounted just below the Phaser canvas so the OS IME runs
 * outside the game and the finalised string is forwarded into the scene through the canvas
 * host's external-input ref.
 *
 * We log the IME state stream at debug level (platform + isComposing/keyCode/key) — handoff
 * §3 P0-3 calls this out explicitly because composition events are notoriously inconsistent
 * across WebViews and we'll need the trace once we hit a real-world quirk.
 */
function ImeModeInputArea(props: {
  externalInputRef: RefObject<GameCanvasExternalInputControl | null>;
}): JSX.Element {
  // Track whether we were composing on the last state push. We only log on transitions to
  // avoid spamming once per keystroke; full per-frame trace lives in useImeInputController.
  const wasComposingRef = useRef(false);

  useEffect(() => {
    // One-shot: log the host platform so debug captures across sessions can be correlated to
    // macOS vs Windows WebView quirks. `navigator.platform` is technically deprecated but
    // remains the simplest signal that doesn't require parsing userAgent.
    const platform = `${globalThis.navigator?.platform ?? 'unknown'} (${globalThis.navigator?.userAgent ?? ''})`;
    console.info('[GamePage IME] platform:', platform);
  }, []);

  const handleChange = (state: ImeInputState): void => {
    if (state.isComposing !== wasComposingRef.current) {
      wasComposingRef.current = state.isComposing;
      console.info('[GamePage IME] composition transition', {
        isComposing: state.isComposing,
        composing: state.composingValue,
        raw: state.rawValue,
      });
    }
  };

  const handleCommit = (value: string): void => {
    console.info('[GamePage IME] commit', { value });
    props.externalInputRef.current?.commit(value);
  };

  return (
    <div
      style={{
        margin: '4px auto 0',
        width: 808,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <ImeInputBox
        mode="ime_surface"
        autoSubmitOnEnter
        onCommit={handleCommit}
        onChange={handleChange}
        placeholder=">>> ここに日本語で入力 + Enter"
        showComposeIndicator
        id="game-ime-input"
      />
      <div
        style={{
          textAlign: 'center',
          fontFamily: 'var(--pix-font)',
          fontSize: 13,
          color: 'var(--kt2-fg-dim)',
          letterSpacing: '0.04em',
        }}
      >
        IME · 选定候选后 ↵ 提交 · CRT 框上方 Phaser canvas 不抢焦点
      </div>
    </div>
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
    tags: row.tags,
    skillTags: row.skillTags.length > 0 ? row.skillTags : ['kana_typing'],
    examples: [],
    audioRefs: [],
    confusableItemIds: [],
    sourcePackId: 'unknown',
    quality: 'official',
    createdAt: '',
    updatedAt: '',
  };
  if (row.jlpt) {
    item.jlpt = row.jlpt as NonNullable<LearningItem['jlpt']>;
  }
  if (row.acceptedKana.length > 0) {
    item.acceptedKana = row.acceptedKana;
  }
  return item;
}

function buildProgressMap(dtos: ProgressDto[]): Map<string, SkillProgress> {
  const map = new Map<string, SkillProgress>();
  for (const dto of dtos) {
    const progress = toDomainProgress(dto);
    if (!progress) continue;
    map.set(progressKey(progress.itemId, progress.skillDimension), progress);
  }
  return map;
}

function progressKey(itemId: string, skill: SkillDimension): string {
  return `${itemId}::${skill}`;
}

function preferTagsForSkill(skill: SkillDimension): string[] {
  switch (skill) {
    case 'katakana_recognition':
      return ['katakana'];
    case 'kana_typing':
    case 'kana_recognition':
    case 'kanji_reading':
    case 'meaning_recall':
    case 'ime_conversion':
    case 'listening_discrimination':
    case 'particle_usage':
    case 'sentence_order':
    case 'active_output':
      return [];
  }
}
