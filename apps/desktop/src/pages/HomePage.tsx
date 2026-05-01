import {
  ALL_ERROR_TAGS,
  buildWeaknessVector,
  type ErrorTag,
  type ErrorTagAggregate,
  type SkillProgress,
  type WeaknessVector,
} from '@kana-typing/core';
import { useEffect, useState, type CSSProperties, type JSX, type ReactNode } from 'react';

import { ERROR_TAG_LABEL_ZH } from '../features/style/errorTagPalette';
import { PixIcon, type PixIconName } from '../features/style/PixIcon';
import {
  aggregateRecentErrorTags,
  getDbInfo,
  listProgress,
  type ProgressDto,
} from '../tauri/invoke';

interface HomeData {
  vector: WeaknessVector;
  itemCount: number;
  fragileCount: number;
  totalRecentErrors: number;
}

/**
 * Sprint 5 Home page (`#/`), retro-skinned in C6. Pulls the current weakness
 * vector + last-week error aggregate and surfaces:
 *   - 工作台 hero — itemCount snapshot + CTA to today's training
 *   - 模式选择 grid — Mole / SpeedChase / Library / 水平测评 (placeholder)
 *   - 数据统计 — three StatCells
 *   - 弱点速览 — top error tags as retro progress bars
 *   - 提示 — keyboard hint footer
 *
 * If the user hasn't seeded a content pack yet, we route them to the dev
 * page; the proper diagnostic flow lands in v0.7 P0-2.
 */
export function HomePage(): JSX.Element {
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        const info = await getDbInfo();
        if (info.itemCount === 0) {
          setEmpty(true);
          return;
        }
        const [progressDtos, tagRows] = await Promise.all([
          listProgress({ userId: 'default-user', limit: 200 }),
          aggregateRecentErrorTags({ userId: 'default-user', days: 7, limit: 10 }),
        ]);
        const progressList = progressDtos.map(toProgress);
        const errors: ErrorTagAggregate[] = tagRows.map((r) => ({
          tag: r.tag as ErrorTagAggregate['tag'],
          count: r.count,
        }));
        const vector = buildWeaknessVector(progressList, errors);
        const fragileCount = progressList.filter(
          (p) => p.state === 'fragile' || p.state === 'learning',
        ).length;
        const totalRecentErrors = tagRows.reduce((sum, r) => sum + r.count, 0);
        setData({ vector, itemCount: info.itemCount, fragileCount, totalRecentErrors });
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, []);

  if (error) {
    return <ErrorPanel message={error} />;
  }
  if (empty) {
    return <EmptyPanel />;
  }
  if (!data) {
    return <LoadingPanel />;
  }

  const { vector, itemCount, fragileCount, totalRecentErrors } = data;
  const topErrors = vector.topErrorTags.slice(0, 5);
  const maxWeight = topErrors.reduce((m, e) => Math.max(m, e.weight), 0) || 1;

  return (
    <div style={pageGrid}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Group title="▌ 工作台">
          <div className="r-h1">晚上好,继续训练</div>
          <div
            style={{
              marginTop: 6,
              fontFamily: 'var(--pix-font)',
              fontSize: 16,
              color: 'var(--kt2-fg)',
            }}
          >
            词库已收录{' '}
            <span style={{ color: 'var(--kt2-accent)', fontFamily: 'var(--pix-display)' }}>
              {itemCount}
            </span>{' '}
            项 · 待巩固 <span style={{ color: 'var(--kt2-accent-2)' }}>{fragileCount}</span> 项
          </div>
          <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
            <a href="#/today" className="r-btn primary tall" style={{ textDecoration: 'none' }}>
              <PixIcon name="play" /> 继续训练 [F5]
            </a>
            <a href="#/mistakes" className="r-btn tall" style={{ textDecoration: 'none' }}>
              <PixIcon name="mistakes" /> 从错题开始
            </a>
          </div>
        </Group>

        <Group title="▌ 模式选择" style={{ flex: 1 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <ModeBlock
              href="#/game/mole"
              icon="mole"
              name="鼹鼠的故事"
              sub="MOLE.EXE"
              desc="假名落下,听写或视写敲入。"
            />
            <ModeBlock
              href="#/game/speed-chase"
              icon="bolt"
              name="生死时速"
              sub="CHASE.EXE"
              desc="3 分钟汉字读音冲刺。"
            />
            <ModeBlock
              href="#/library"
              icon="library"
              name="题库浏览"
              sub="LIBRARY"
              desc="查看已收录词条 + 掌握度。"
            />
            <ModeBlock
              icon="target"
              name="水平测评"
              sub="DIAG.EXE"
              desc="新手诊断 · v0.7 P0-2 即将推出。"
              disabled
            />
          </div>
        </Group>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Group title="▌ 数据统计">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
            <StatCell n={itemCount} unit="项" label="词库" color="var(--kt2-accent)" />
            <StatCell n={fragileCount} unit="项" label="待巩固" color="var(--kt2-accent-2)" />
            <StatCell n={totalRecentErrors} unit="次" label="近 7 天错" color="var(--kt2-danger)" />
          </div>
        </Group>

        <Group title="▌ 弱点速览" style={{ flex: 1 }}>
          {topErrors.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--kt2-fg-dim)', lineHeight: 1.5 }}>
              » 还没有可统计的错误
              <br />» 先打几局,这里会给出按 tag 聚合的弱点分布
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {topErrors.map(({ tag, weight }) => (
                <WeaknessRow key={tag} tag={tag} weight={weight} pct={(weight / maxWeight) * 100} />
              ))}
            </div>
          )}
        </Group>

        <Group title="▌ 提示">
          <div style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--kt2-fg-dim)' }}>
            » 按 <span style={{ color: 'var(--kt2-accent)' }}>F5</span> 立即开始今日训练
            <br />» 按 <span style={{ color: 'var(--kt2-accent)' }}>Esc</span> 退出当前游戏
            <br />» 错误 2 次后自动显示读音
          </div>
        </Group>
      </div>
    </div>
  );
}

const pageGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1.4fr 1fr',
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

function StatCell({
  n,
  unit,
  label,
  color,
}: {
  n: number;
  unit: string;
  label: string;
  color: string;
}): JSX.Element {
  return (
    <div
      className="r-sink"
      style={{
        padding: '8px 6px',
        textAlign: 'center',
        background: 'var(--kt2-sunken)',
      }}
    >
      <div className="r-label" style={{ fontSize: 7 }}>
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--pix-display)',
          fontSize: 18,
          color,
          marginTop: 4,
          textShadow: `0 0 6px ${color}`,
        }}
      >
        {n}
      </div>
      <div className="r-label" style={{ fontSize: 7, marginTop: 2 }}>
        {unit}
      </div>
    </div>
  );
}

function ModeBlock({
  icon,
  name,
  sub,
  desc,
  href,
  disabled,
}: {
  icon: PixIconName;
  name: string;
  sub: string;
  desc: string;
  href?: string;
  disabled?: boolean;
}): JSX.Element {
  const inner = (
    <div
      className="r-raise"
      style={{
        background: 'var(--kt2-panel-2)',
        padding: 10,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <PixIcon name={icon} size={24} />
        <div>
          <div
            style={{
              fontFamily: 'var(--pix-display)',
              fontSize: 11,
              color: 'var(--kt2-fg-bright)',
              letterSpacing: '0.06em',
            }}
          >
            {name}
          </div>
          <div className="r-label" style={{ fontSize: 7 }}>
            {sub}
          </div>
        </div>
      </div>
      <div
        style={{
          fontSize: 13,
          color: 'var(--kt2-fg-dim)',
          lineHeight: 1.4,
          minHeight: 36,
        }}
      >
        {desc}
      </div>
    </div>
  );
  if (disabled || !href) return inner;
  return (
    <a href={href} style={{ textDecoration: 'none', color: 'inherit' }}>
      {inner}
    </a>
  );
}

function WeaknessRow({
  tag,
  weight,
  pct,
}: {
  tag: ErrorTag;
  weight: number;
  pct: number;
}): JSX.Element {
  const sev: 'low' | 'mid' | 'high' = pct >= 66 ? 'high' : pct >= 33 ? 'mid' : 'low';
  const fill =
    sev === 'high'
      ? 'repeating-linear-gradient(90deg,#ff7a7a 0,#ff7a7a 6px,#c54242 6px,#c54242 8px)'
      : sev === 'mid'
        ? 'repeating-linear-gradient(90deg,#ffb454 0,#ffb454 6px,#c2700b 6px,#c2700b 8px)'
        : 'repeating-linear-gradient(90deg,#7ee787 0,#7ee787 6px,#5fc870 6px,#5fc870 8px)';
  const label = (ALL_ERROR_TAGS as readonly string[]).includes(tag) ? ERROR_TAG_LABEL_ZH[tag] : tag;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '70px 1fr 40px',
        alignItems: 'center',
        gap: 6,
        fontSize: 14,
      }}
    >
      <span>{label}</span>
      <div className="r-progress" style={{ height: 12 }}>
        <div className="fill" style={{ width: `${Math.max(8, pct)}%`, background: fill }} />
      </div>
      <span
        style={{
          textAlign: 'right',
          fontFamily: 'var(--pix-display)',
          fontSize: 9,
          color: sev === 'high' ? 'var(--kt2-danger)' : 'var(--kt2-fg-dim)',
        }}
      >
        {weight}
      </span>
    </div>
  );
}

function EmptyPanel(): JSX.Element {
  return (
    <div style={pageGrid}>
      <Group title="▌ 起步">
        <div className="r-h1" style={{ marginBottom: 6 }}>
          欢迎来到假名打字通
        </div>
        <div style={{ fontSize: 14, color: 'var(--kt2-fg-dim)', lineHeight: 1.6 }}>
          词库还是空的。先去{' '}
          <a href="#/dev" className="kt-link">
            dev
          </a>{' '}
          页面种入官方 N5 mini 词库,再回来这里。
          <br />
          完整新手诊断流程会在 v0.7 P0-2 上线。
        </div>
        <div style={{ marginTop: 14 }}>
          <a href="#/dev" className="r-btn primary tall" style={{ textDecoration: 'none' }}>
            <PixIcon name="save" /> 打开 dev 页面
          </a>
        </div>
      </Group>
      <Group title="▌ 状态">
        <div className="r-label">db</div>
        <div
          style={{
            fontFamily: 'var(--pix-display)',
            fontSize: 18,
            color: 'var(--kt2-fg-dim)',
            marginTop: 4,
          }}
        >
          0 items
        </div>
      </Group>
    </div>
  );
}

function LoadingPanel(): JSX.Element {
  return (
    <div style={pageGrid}>
      <Group title="▌ 工作台">
        <div style={{ color: 'var(--kt2-fg-dim)' }}>读取数据中...</div>
      </Group>
      <Group title="▌ 状态">
        <div className="kt-skel" style={{ width: '100%', height: 14, marginBottom: 8 }} />
        <div className="kt-skel" style={{ width: '70%', height: 14, marginBottom: 8 }} />
        <div className="kt-skel" style={{ width: '85%', height: 14 }} />
      </Group>
    </div>
  );
}

function ErrorPanel({ message }: { message: string }): JSX.Element {
  return (
    <div style={pageGrid}>
      <Group title="▌ ERR · 启动失败">
        <div className="kt-banner kt-banner--err" style={{ marginBottom: 12 }}>
          <span className="kt-banner__glyph">!</span>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>无法读取本地数据</div>
            <div style={{ fontSize: 13, opacity: 0.9 }}>{message}</div>
          </div>
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
