import {
  selectBossSession,
  selectChoiceTasks,
  selectKanaTasks,
  selectSentenceOrderTasks,
  type BossSegment,
  type EvaluationStrictness,
  type GameType,
  type LearningItem,
  type SentenceItem,
  type SkillProgress,
  type TrainingTask,
  type UserAttempt,
} from '@kana-typing/core';
import { createComboBus, type ComboBus, type GameBridgeAdapter } from '@kana-typing/game-runtime';
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';

import {
  buildProgressMap,
  rowToLearningItem,
  rowToSentenceItem,
} from '../features/db/rowConversions';
import { GameCanvasHost, type GameSceneKey } from '../features/game/GameCanvasHost';
import { GameHud } from '../features/game/GameHud';
import { GameSessionService } from '../features/session/GameSessionService';
import { listItems, listProgress, type ProgressDto } from '../tauri/invoke';

const STRICT_POLICY: EvaluationStrictness = {
  longVowel: 'strict',
  sokuon: 'strict',
  dakuten: 'strict',
  handakuten: 'strict',
  youon: 'strict',
  kanjiSurface: 'strict',
  particleReading: 'pronunciation',
};

const SESSION_DURATION_MS = 240_000; // 4 minutes — Boss is meant to be longer than a single game session.

const SCENE_KEY_FOR_GAME: Partial<Record<GameType, GameSceneKey>> = {
  mole_story: 'MoleScene',
  speed_chase: 'SpeedChaseScene',
  river_jump: 'RiverJumpScene',
  space_battle: 'SpaceBattleScene',
  apple_rescue: 'AppleRescueScene',
};

const GAME_LABEL: Partial<Record<GameType, string>> = {
  mole_story: '鼹鼠',
  speed_chase: '生死时速',
  river_jump: '激流勇进',
  space_battle: '太空大战',
  apple_rescue: '拯救苹果',
};

interface SessionStats {
  attempts: number;
  correct: number;
  remainingMs: number;
}

/**
 * v0.8.7 Boss page (`#/game/boss`). Builds a multi-segment cross-game gauntlet from the
 * user's recent weakness, then plays each segment sequentially.
 *
 * Architecture:
 *   - One `GameSessionService` instance for the whole Boss run; gameType='boss_round'.
 *   - One `ComboBus` instance shared across every segment so the streak survives
 *     segment-to-segment scene mounts.
 *   - Each segment mounts `GameCanvasHost` with that segment's sceneKey + a per-segment
 *     adapter that drains a queue built by the segment's task selector. When the queue
 *     finishes, finishSession bubbles up here, we advance to the next segment, and a new
 *     GameCanvasHost mounts (the previous one unmounts cleanly via React keying).
 *   - When all segments finish, navigate to ResultPage just like any other session.
 *
 * Empty-history fallback: when `selectBossSession` returns no segments, render a
 * "数据不够 — 先去练几局再来" panel rather than starting an empty session.
 */
export function BossPage(): JSX.Element {
  const session = useMemo(() => new GameSessionService({ bufferAttempts: false }), []);
  const sessionRef = useRef<GameSessionService | null>(null);
  sessionRef.current = session;
  const combo = useMemo<ComboBus>(() => createComboBus(), []);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [emptyReason, setEmptyReason] = useState<string | null>(null);
  const [segments, setSegments] = useState<BuiltSegment[]>([]);
  const [segmentIndex, setSegmentIndex] = useState(0);
  const [stats, setStats] = useState<SessionStats>({
    attempts: 0,
    correct: 0,
    remainingMs: SESSION_DURATION_MS,
  });

  // Each segment has its own task queue keyed by segment id (we use index here). Holding the
  // queue in a ref keeps the adapter closure stable across renders.
  const queueRef = useRef<TrainingTask[]>([]);
  const currentTaskRef = useRef<TrainingTask | null>(null);
  const startedAtRef = useRef<number>(Date.now());

  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        const [rows, progressDtos] = await Promise.all([
          listItems({ limit: 1000 }),
          listProgress({ userId: 'default-user', limit: 5000 }),
        ]);
        const learningItems: LearningItem[] = rows
          .filter((r) => r.type !== 'sentence')
          .map(rowToLearningItem);
        const sentenceItems: SentenceItem[] = rows
          .filter((r) => r.type === 'sentence')
          .map(rowToSentenceItem)
          .filter((s): s is SentenceItem => s !== null);
        const progressDomain: SkillProgress[] = progressDtos
          .map(toDomainProgressOrNull)
          .filter((p): p is SkillProgress => p !== null);
        const out = selectBossSession({
          progress: progressDomain,
          learningItems,
          sentenceItems,
          segmentCount: 4,
          itemsPerSegment: 5,
        });
        if (out.segments.length === 0) {
          setEmptyReason(
            out.weakCandidateCount === 0
              ? '还没有错题数据 — 先去鼹鼠 / 生死时速 / 激流勇进 / 太空大战 / 拯救苹果 任意几局再回来'
              : '错题虽然有,但没有可用的内容 — 检查 #/dev 是否已 seed 全部 foundations 包',
          );
          return;
        }
        const created = await session.create({
          gameType: 'boss_round',
          targetDurationMs: SESSION_DURATION_MS,
        });
        const progressMap = buildProgressMap(progressDtos);
        const builtSegments = out.segments.map((seg) =>
          attachSegmentQueue(seg, progressMap, created.id),
        );
        const playableSegments = builtSegments.filter((seg) => seg.tasks.length > 0);
        if (playableSegments.length === 0) {
          await session.finish('aborted').catch((finishErr: unknown) => {
            console.warn('Boss empty queue cleanup failed', finishErr);
          });
          setEmptyReason(
            '错题已经路由到 Boss 段落,但没有生成可玩的题目 — 检查 choice distractors / sentence 内容包是否完整',
          );
          return;
        }
        setSessionId(created.id);
        setSegments(playableSegments);
        // Prime the first segment's queue so the GameCanvasHost mount immediately has tasks.
        const firstSeg = playableSegments[0];
        if (firstSeg) {
          queueRef.current = [...firstSeg.tasks];
        }
        startedAtRef.current = Date.now();
      } catch (err) {
        setBootError((err as Error).message);
      }
    })();
    return () => {
      void session.finish('aborted').catch((err: unknown) => {
        console.warn('Boss cleanup: finish failed', err);
      });
    };
  }, [session]);

  useEffect(() => {
    if (!sessionId) return;
    const handle = globalThis.setInterval(() => {
      const remaining = Math.max(0, SESSION_DURATION_MS - (Date.now() - startedAtRef.current));
      setStats((s) => ({ ...s, remainingMs: remaining }));
      if (remaining <= 0) {
        globalThis.clearInterval(handle);
        void (async (): Promise<void> => {
          try {
            await sessionRef.current?.finish('finished');
          } catch (err) {
            console.warn('Boss timer: finish failed', err);
          }
          navigateToResult(sessionId);
        })();
      }
    }, 250);
    return () => globalThis.clearInterval(handle);
  }, [sessionId]);

  const adapter = useMemo<GameBridgeAdapter>(
    () => ({
      requestNextTask: () => {
        if (Date.now() - startedAtRef.current >= SESSION_DURATION_MS) {
          currentTaskRef.current = null;
          return Promise.resolve(null);
        }
        const next = queueRef.current.shift() ?? null;
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
          queueRef.current.unshift(task);
        }
        return result;
      },
      finishSession: () => {
        // The current segment's queue exhausted (or scene's own timeout fired). Advance to
        // the next segment if one exists; otherwise wrap up the whole Boss session.
        const nextIndex = segmentIndex + 1;
        if (nextIndex >= segments.length) {
          void (async (): Promise<void> => {
            try {
              await sessionRef.current?.finish('finished');
            } catch (err) {
              console.warn('Boss adapter: finish failed', err);
            }
            navigateToResult(sessionId);
          })();
          return Promise.resolve();
        }
        // Refill queueRef with the next segment's tasks before the host re-mounts.
        const next = segments[nextIndex];
        if (next) queueRef.current = [...next.tasks];
        setSegmentIndex(nextIndex);
        return Promise.resolve();
      },
    }),
    [sessionId, segments, segmentIndex],
  );

  if (bootError) return <BootErrorPanel message={bootError} />;
  if (emptyReason) return <EmptyHistoryPanel message={emptyReason} />;
  if (!sessionId || segments.length === 0) {
    return (
      <div style={{ padding: 10, height: '100%' }}>
        <div className="r-group">
          <div className="title">▌ Boss 关 — 跨游戏混合复习</div>
          <div style={{ color: 'var(--kt2-fg-dim)' }}>分析最近的错题数据,生成 Boss 段落...</div>
        </div>
      </div>
    );
  }

  const currentSeg = segments[segmentIndex];
  if (!currentSeg) return <BootErrorPanel message="segment index out of range" />;
  const sceneKey = SCENE_KEY_FOR_GAME[currentSeg.gameType];
  if (!sceneKey) {
    return <BootErrorPanel message={`no scene for gameType=${currentSeg.gameType}`} />;
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
          ▌ BOSS · 段 {segmentIndex + 1}/{segments.length} ·{' '}
          {GAME_LABEL[currentSeg.gameType] ?? currentSeg.gameType} · 因{' '}
          {currentSeg.reasons.join('/')}
        </div>

        <GameHud
          remainingMs={stats.remainingMs}
          attemptsCount={stats.attempts}
          correctCount={stats.correct}
        />

        <div
          className="r-crt"
          // Keying on segmentIndex forces GameCanvasHost to fully unmount + remount when we
          // switch segments — Phaser scenes don't survive a sceneKey prop change otherwise,
          // and we want the next segment's scene to start clean with the next queue.
          key={`boss-seg-${String(segmentIndex)}`}
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
            sceneKey={sceneKey}
            adapter={adapter}
            combo={combo}
            width={800}
            height={480}
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
          段落自动轮换 · 连击跨段保持 · attempt 写入 SQLite [v0.8.7]
        </div>
      </div>
    </div>
  );
}

interface BuiltSegment extends BossSegment {
  tasks: TrainingTask[];
}

function attachSegmentQueue(
  seg: BossSegment,
  progressMap: Map<string, SkillProgress>,
  sessionId: string,
): BuiltSegment {
  const tasks: TrainingTask[] = [];
  if (seg.gameType === 'mole_story' || seg.gameType === 'speed_chase') {
    if (seg.content.kind !== 'words') return { ...seg, tasks };
    const queue = selectKanaTasks({
      items: seg.content.items,
      progress: progressMap,
      count: seg.taskCount,
      sessionId,
      gameType: seg.gameType,
      answerMode: seg.gameType === 'mole_story' ? 'romaji_to_kana' : 'romaji_to_kana',
      skillDimension: seg.skillDimension,
      strictness: STRICT_POLICY,
      timeLimitMs: seg.timeLimitMs,
    });
    while (queue.remaining() > 0) {
      const t = queue.next();
      if (t) tasks.push(t);
    }
  } else if (seg.gameType === 'space_battle' || seg.gameType === 'apple_rescue') {
    if (seg.content.kind !== 'words') return { ...seg, tasks };
    const queue = selectChoiceTasks({
      items: seg.content.items,
      progress: progressMap,
      count: seg.taskCount,
      sessionId,
      gameType: seg.gameType,
      skillDimension: seg.skillDimension,
      strictness: STRICT_POLICY,
      distractorCount: seg.gameType === 'apple_rescue' ? 1 : 3,
      timeLimitMs: seg.timeLimitMs,
      promptKind: seg.gameType === 'apple_rescue' ? 'audio' : 'meaning_zh',
    });
    while (queue.remaining() > 0) {
      const t = queue.next();
      if (t) tasks.push(t);
    }
  } else if (seg.gameType === 'river_jump') {
    if (seg.content.kind !== 'sentences') return { ...seg, tasks };
    const queue = selectSentenceOrderTasks({
      sentences: seg.content.sentences,
      progress: progressMap,
      count: seg.taskCount,
      sessionId,
      gameType: 'river_jump',
      skillDimension: seg.skillDimension,
      strictness: STRICT_POLICY,
      timeLimitMs: seg.timeLimitMs,
    });
    while (queue.remaining() > 0) {
      const t = queue.next();
      if (t) tasks.push(t);
    }
  }
  return { ...seg, tasks };
}

function navigateToResult(sessionId: string | null): void {
  if (!sessionId) return;
  const target = `#/result/${sessionId}`;
  if (globalThis.location.hash !== target) {
    globalThis.location.hash = target;
  }
}

function BootErrorPanel({ message }: { message: string }): JSX.Element {
  return (
    <div style={{ padding: 10, height: '100%' }}>
      <div className="r-group">
        <div className="title">▌ ERR · Boss 关</div>
        <div className="kt-banner kt-banner--err" style={{ marginBottom: 12 }}>
          <span className="kt-banner__glyph">!</span>
          <div style={{ fontSize: 13 }}>{message}</div>
        </div>
        <a href="#/" className="r-btn" style={{ textDecoration: 'none' }}>
          回首页
        </a>
      </div>
    </div>
  );
}

function EmptyHistoryPanel({ message }: { message: string }): JSX.Element {
  return (
    <div style={{ padding: 10, height: '100%' }}>
      <div className="r-group">
        <div className="title">▌ Boss 关 — 还需要更多数据</div>
        <div style={{ color: 'var(--kt2-fg-dim)', fontSize: 13, lineHeight: 1.6, padding: 8 }}>
          {message}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <a href="#/today" className="r-btn primary" style={{ textDecoration: 'none' }}>
            去今日训练
          </a>
          <a href="#/" className="r-btn" style={{ textDecoration: 'none' }}>
            回首页
          </a>
        </div>
      </div>
    </div>
  );
}

/**
 * SkillProgress shape mirrors ProgressDto except `lastErrorTags` is typed as `ErrorTag[]`
 * (closed enum) instead of the wide DTO `string[]`. `selectBossSession` only uses fields
 * present on both, so a defensive identity-cast suffices for the boss boot path.
 */
function toDomainProgressOrNull(dto: ProgressDto): SkillProgress | null {
  return {
    userId: dto.userId,
    itemId: dto.itemId,
    skillDimension: dto.skillDimension,
    state: dto.state as SkillProgress['state'],
    masteryScore: dto.masteryScore,
    stability: dto.stability,
    difficulty: dto.difficulty,
    exposureCount: dto.exposureCount,
    correctCount: dto.correctCount,
    wrongCount: dto.wrongCount,
    streak: dto.streak,
    lapseCount: dto.lapseCount,
    ...(dto.averageReactionTimeMs !== null && { averageReactionTimeMs: dto.averageReactionTimeMs }),
    ...(dto.lastAttemptAt !== null && { lastAttemptAt: dto.lastAttemptAt }),
    ...(dto.nextDueAt !== null && { nextDueAt: dto.nextDueAt }),
    lastErrorTags: dto.lastErrorTags as SkillProgress['lastErrorTags'],
    updatedAt: dto.updatedAt,
  };
}
