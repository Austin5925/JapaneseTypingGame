import {
  buildWeaknessVector,
  selectGameBlocks,
  type ErrorTagAggregate,
  type GameBlock,
  type GameType,
  type SkillProgress,
  type WeaknessVector,
} from '@kana-typing/core';
import { useEffect, useState, type CSSProperties, type JSX, type ReactNode } from 'react';

import { ERROR_TAG_LABEL_ZH } from '../features/style/errorTagPalette';
import { PixIcon, type PixIconName } from '../features/style/PixIcon';
import { aggregateRecentErrorTags, listProgress, type ProgressDto } from '../tauri/invoke';

const DEFAULT_TARGET_DURATION_MS = 8 * 60 * 1000; // 8 minutes — devdocs §3.1 daily flow

const GAME_TYPE_TO_HASH: Partial<Record<GameType, string>> = {
  mole_story: '#/game/mole',
  speed_chase: '#/game/speed-chase',
};

const GAME_TYPE_LABEL: Record<GameType, string> = {
  mole_story: '鼹鼠的故事',
  speed_chase: '生死时速',
  apple_rescue: '拯救苹果',
  river_jump: '激流勇进',
  space_battle: '太空大战',
  real_input: '实战输入',
};

const GAME_TYPE_SUB: Record<GameType, string> = {
  mole_story: 'MOLE.EXE',
  speed_chase: 'CHASE.EXE',
  apple_rescue: 'APPLE.EXE',
  river_jump: 'RIVER.EXE',
  space_battle: 'BATTLE.EXE',
  real_input: 'REAL.EXE',
};

const GAME_TYPE_ICON: Record<GameType, PixIconName> = {
  mole_story: 'mole',
  speed_chase: 'bolt',
  apple_rescue: 'target',
  river_jump: 'bolt',
  space_battle: 'bolt',
  real_input: 'play',
};

/**
 * Sprint 5 today-training page (`#/today`), retro-skinned in C7.
 *
 * Layout: two columns (1fr / 280px) inside the .r-main grid.
 *
 *   Left  ▌ 今日训练 · N 题 · 约 X 分钟
 *           STAGE-0n cards (one per GameBlock) — icon, label, stage tag,
 *           reason, item count, duration, and a 开始 CTA per row.
 *           Bottom: a primary 开始 button starting the first block.
 *   Right ▌ 生成依据 — top error tags as plain text reasons sourced
 *           from buildWeaknessVector + selectGameBlocks.
 *         ▌ 进度    — placeholder STAGE completion (0/N) until daily
 *           plans persist (separate sprint).
 */
export function TodayTrainingPage(): JSX.Element {
  const [vector, setVector] = useState<WeaknessVector | null>(null);
  const [blocks, setBlocks] = useState<GameBlock[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        const [progressDtos, tagRows] = await Promise.all([
          listProgress({ userId: 'default-user', limit: 200 }),
          aggregateRecentErrorTags({ userId: 'default-user', days: 7, limit: 10 }),
        ]);
        const progressList = progressDtos.map(toProgress);
        const errors: ErrorTagAggregate[] = tagRows.map((r) => ({
          tag: r.tag as ErrorTagAggregate['tag'],
          count: r.count,
        }));
        const v = buildWeaknessVector(progressList, errors);
        setVector(v);
        setBlocks(selectGameBlocks({ vector: v, targetDurationMs: DEFAULT_TARGET_DURATION_MS }));
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, []);

  if (error) {
    return <ErrorPanel message={error} />;
  }
  if (!vector) {
    return <LoadingPanel />;
  }

  const totalMs = blocks.reduce((s, b) => s + b.durationMs, 0);
  const totalItems = blocks.reduce((s, b) => s + estimateTasks(b.durationMs), 0);
  const firstHref = blocks.length > 0 ? hrefForBlock(blocks[0]!) : undefined;

  return (
    <div style={pageGrid}>
      <Group title={`▌ 今日训练 · ${totalItems} 题 · 约 ${Math.round(totalMs / 60_000)} 分钟`}>
        {blocks.length === 0 ? (
          <div style={{ color: 'var(--kt2-fg-dim)', fontSize: 13, lineHeight: 1.5 }}>
            » 还没有推荐路线。先在{' '}
            <a href="#/" className="kt-link">
              首页
            </a>{' '}
            确认词库已有词条。
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {blocks.map((b, idx) => (
              <StageRow key={idx} block={b} index={idx} />
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          {firstHref ? (
            <a href={firstHref} className="r-btn primary tall" style={{ textDecoration: 'none' }}>
              <PixIcon name="play" /> 开始 [F5]
            </a>
          ) : (
            <button className="r-btn tall" disabled>
              <PixIcon name="play" /> 开始 [F5]
            </button>
          )}
          <a href="#/" className="r-btn tall" style={{ textDecoration: 'none' }}>
            <PixIcon name="home" /> 回首页
          </a>
        </div>
      </Group>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Group title="▌ 生成依据">
          <ReasonList vector={vector} blocks={blocks} />
        </Group>

        <Group title="▌ 进度" style={{ flex: 1 }}>
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <div
              style={{
                fontFamily: 'var(--pix-display)',
                fontSize: 28,
                color: 'var(--kt2-accent)',
                textShadow: '0 0 12px var(--kt2-accent)',
              }}
            >
              0 / {blocks.length}
            </div>
            <div className="r-label" style={{ marginTop: 4 }}>
              已完成
            </div>
          </div>
          <div className="r-progress" style={{ marginTop: 12 }}>
            <div className="fill" style={{ width: '0%' }} />
            <div className="text">0%</div>
          </div>
          <div
            style={{
              marginTop: 10,
              fontSize: 11,
              color: 'var(--kt2-fg-dim)',
              fontFamily: 'var(--pix-font)',
            }}
          >
            » 完成持久化在后续 sprint 上线
          </div>
        </Group>
      </div>
    </div>
  );
}

function StageRow({ block, index }: { block: GameBlock; index: number }): JSX.Element {
  const href = hrefForBlock(block);
  const label = GAME_TYPE_LABEL[block.gameType] ?? block.gameType;
  const sub = GAME_TYPE_SUB[block.gameType] ?? block.gameType.toUpperCase();
  const icon = GAME_TYPE_ICON[block.gameType] ?? 'play';
  const stage = `STAGE-${String(index + 1).padStart(2, '0')}`;
  const minutes = (block.durationMs / 60_000).toFixed(1);

  const body = (
    <div
      className="r-raise"
      style={{
        background: 'var(--kt2-panel-2)',
        padding: '8px 10px',
        display: 'grid',
        gridTemplateColumns: '32px 1fr 90px 80px',
        alignItems: 'center',
        gap: 10,
        cursor: href ? 'pointer' : 'default',
        opacity: href ? 1 : 0.55,
      }}
    >
      <PixIcon name={icon} size={20} />
      <div>
        <div style={{ fontSize: 15, color: 'var(--kt2-fg-bright)' }}>{label}</div>
        <div style={{ fontSize: 12, color: 'var(--kt2-fg-dim)' }}>
          {stage} · {sub} · {block.reason}
        </div>
      </div>
      <div
        style={{
          textAlign: 'right',
          fontFamily: 'var(--pix-display)',
          fontSize: 9,
          color: 'var(--kt2-accent)',
        }}
      >
        ~{estimateTasks(block.durationMs)} 题
      </div>
      <div style={{ textAlign: 'right', fontSize: 12, color: 'var(--kt2-fg-dim)' }}>
        {minutes} 分
      </div>
    </div>
  );
  if (!href) return body;
  return (
    <a href={href} style={{ textDecoration: 'none', color: 'inherit' }}>
      {body}
    </a>
  );
}

function ReasonList({
  vector,
  blocks,
}: {
  vector: WeaknessVector;
  blocks: GameBlock[];
}): JSX.Element {
  const reasons: string[] = [];
  // The block-derived reasons are the most operational — show them first.
  blocks.slice(0, 3).forEach((b) => {
    reasons.push(`${GAME_TYPE_LABEL[b.gameType] ?? b.gameType} · ${b.reason}`);
  });
  // Then the top error tags from the weakness vector for context.
  vector.topErrorTags.slice(0, 3).forEach((e) => {
    const label = Object.prototype.hasOwnProperty.call(ERROR_TAG_LABEL_ZH, e.tag)
      ? ERROR_TAG_LABEL_ZH[e.tag]
      : e.tag;
    reasons.push(`${label} · 弱点权重 ${e.weight}`);
  });
  if (reasons.length === 0) {
    return (
      <div style={{ fontSize: 13, color: 'var(--kt2-fg-dim)', lineHeight: 1.5 }}>
        » 没有可用的训练历史
        <br />» 路线按默认配置生成
      </div>
    );
  }
  return (
    <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--kt2-fg-dim)' }}>
      {reasons.map((r, i) => (
        <div key={i}>» {r}</div>
      ))}
    </div>
  );
}

const pageGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 280px',
  gap: 10,
  padding: 10,
  height: '100%',
};

function Group({
  title,
  style,
  children,
}: {
  title: string;
  style?: CSSProperties;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="r-group" style={style}>
      <div className="title">{title}</div>
      {children}
    </div>
  );
}

function LoadingPanel(): JSX.Element {
  return (
    <div style={pageGrid}>
      <Group title="▌ 今日训练">
        <div style={{ color: 'var(--kt2-fg-dim)' }}>读取进度数据中...</div>
      </Group>
      <Group title="▌ 状态">
        <div className="kt-skel" style={{ width: '100%', height: 14, marginBottom: 8 }} />
        <div className="kt-skel" style={{ width: '60%', height: 14 }} />
      </Group>
    </div>
  );
}

function ErrorPanel({ message }: { message: string }): JSX.Element {
  return (
    <div style={pageGrid}>
      <Group title="▌ ERR · 路线生成失败">
        <div className="kt-banner kt-banner--err">
          <span className="kt-banner__glyph">!</span>
          <div style={{ fontSize: 13 }}>{message}</div>
        </div>
      </Group>
      <Group title="▌ 状态">
        <div className="r-label">build</div>
        <div
          style={{
            fontFamily: 'var(--pix-display)',
            fontSize: 14,
            color: 'var(--kt2-danger)',
            marginTop: 4,
          }}
        >
          ERROR
        </div>
      </Group>
    </div>
  );
}

/**
 * Rough task-count estimate from block duration. GameBlock doesn't carry an
 * itemCount (the queue size is decided downstream by selectKanaTasks); we
 * assume ~6 seconds per task — close to the observed Mole/SpeedChase
 * cadence — and round. The "~" prefix in the UI signals "approximate".
 */
function estimateTasks(durationMs: number): number {
  return Math.max(1, Math.round(durationMs / 6000));
}

function hrefForBlock(block: GameBlock): string | undefined {
  const base = GAME_TYPE_TO_HASH[block.gameType];
  if (!base) return undefined;
  const params = new URLSearchParams({
    durationMs: String(block.durationMs),
    skillDimension: block.skillDimension,
  });
  return `${base}?${params.toString()}`;
}

function toProgress(dto: ProgressDto): SkillProgress {
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
    ...(dto.averageReactionTimeMs !== null && {
      averageReactionTimeMs: dto.averageReactionTimeMs,
    }),
    ...(dto.lastAttemptAt !== null && { lastAttemptAt: dto.lastAttemptAt }),
    ...(dto.nextDueAt !== null && { nextDueAt: dto.nextDueAt }),
    lastErrorTags: dto.lastErrorTags as SkillProgress['lastErrorTags'],
    updatedAt: dto.updatedAt,
  };
}
