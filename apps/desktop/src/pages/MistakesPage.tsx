import { buildCrossGameEffects, type ErrorTag, type GameType } from '@kana-typing/core';
import { useEffect, useMemo, useState, type CSSProperties, type JSX, type ReactNode } from 'react';

import { ErrorTagChip } from '../features/style/ErrorTagChip';
import { ERROR_TAG_LABEL_ZH } from '../features/style/errorTagPalette';
import { PixIcon } from '../features/style/PixIcon';
import {
  aggregateRecentErrorTags,
  listRecentAttempts,
  type AttemptEventRow,
  type ErrorTagAggregateRow,
} from '../tauri/invoke';

interface RecoChip {
  href: string;
  label: string;
  reason: ErrorTag;
}

const RECO_LABEL: Record<GameType, { href: string; short: string }> = {
  apple_rescue: { href: '#/game/apple-rescue', short: '听辨' },
  space_battle: { href: '#/game/space-battle', short: '辨义' },
  river_jump: { href: '#/game/river-jump', short: '语序' },
  speed_chase: { href: '#/game/speed-chase', short: '读音' },
  mole_story: { href: '#/game/mole', short: '假名' },
  real_input: { href: '#/', short: '实战' },
};

/**
 * Map an attempt's error tags to up to two recommendation chips. Reuses the same routing
 * table as the SchedulerService / ResultPage insights so a wrong attempt's "去 X 复习 →"
 * link is consistent across the app.
 */
function recommendationsFor(errorTags: string[]): RecoChip[] {
  const seen = new Set<string>();
  const out: RecoChip[] = [];
  const synthetic = {
    attemptId: '',
    taskId: '',
    itemId: '',
    skillDimension: 'meaning_recall',
    isCorrect: false,
    score: 0,
    accuracyScore: 0,
    speedScore: 0,
    confidenceScore: 0,
    errorTags: errorTags as ErrorTag[],
    expectedDisplay: '',
    actualDisplay: '',
    reactionTimeMs: 0,
    shouldRepeatImmediately: false,
    crossGameEffects: [],
  } as Parameters<typeof buildCrossGameEffects>[0];
  const effects = buildCrossGameEffects(synthetic);
  for (const e of effects) {
    if (out.length >= 2) break;
    const key = `${e.targetGameType}::${e.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const meta = RECO_LABEL[e.targetGameType];
    if (!meta) continue;
    out.push({
      href: meta.href,
      label: `去${meta.short} →`,
      reason: e.reason,
    });
  }
  return out;
}

/**
 * Sprint 5 mistakes book (`#/mistakes`), retro-skinned in C8.
 *
 * Two-column layout (180px / 1fr) inside .r-main:
 *
 *   Left  ▌ 筛选 — radio-style tag filter (.r-chk). "全部" by default; click
 *           a tag to narrow the list. Counts come from
 *           aggregateRecentErrorTags. The "练所选" CTA stays disabled until
 *           the per-tag drill flow lands in v0.7+.
 *
 *   Right ▌ 错题列表 · N 项 — flat .r-list table (zebra). Columns:
 *           # / item / answerMode / error chips / reaction-ms / 时间.
 *           Rows render the latest 1000 wrong attempts intersected with
 *           the active tag filter.
 */
export function MistakesPage(): JSX.Element {
  const [tagAgg, setTagAgg] = useState<ErrorTagAggregateRow[] | null>(null);
  const [recentWrong, setRecentWrong] = useState<AttemptEventRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string>('__all__');

  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        const [agg, attempts] = await Promise.all([
          aggregateRecentErrorTags({ userId: 'default-user', days: 30, limit: 30 }),
          // Pull a wider window so the tag filter has enough rows to intersect with the
          // 30-day aggregate. SQL date-range filtering lands in P1-2.
          listRecentAttempts({ userId: 'default-user', limit: 1000 }),
        ]);
        setTagAgg(agg);
        setRecentWrong(attempts.filter((a) => !a.isCorrect));
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, []);

  const totalWrong = recentWrong?.length ?? 0;
  const filtered = useMemo(() => {
    if (!recentWrong) return [];
    if (selectedTag === '__all__') return recentWrong;
    return recentWrong.filter((a) => a.errorTags.includes(selectedTag));
  }, [recentWrong, selectedTag]);

  if (error) return <ErrorPanel message={error} />;
  if (!tagAgg || !recentWrong) return <LoadingPanel />;

  return (
    <div style={pageGrid}>
      <Group title="▌ 筛选">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14 }}>
          <FilterRow
            label="全部"
            count={totalWrong}
            checked={selectedTag === '__all__'}
            onClick={() => setSelectedTag('__all__')}
          />
          {tagAgg.map((row) => (
            <FilterRow
              key={row.tag}
              label={resolveTagLabel(row.tag)}
              count={row.count}
              checked={selectedTag === row.tag}
              onClick={() => setSelectedTag(row.tag)}
            />
          ))}
        </div>
        <div style={{ marginTop: 14 }} className="r-label">
          排序
        </div>
        <select className="r-input" style={{ width: '100%', marginTop: 4 }} disabled>
          <option>最近触发</option>
          <option>错误次数 ↓ (v0.7+)</option>
          <option>掌握度 (v0.7+)</option>
        </select>
        <div style={{ marginTop: 10 }}>
          <button className="r-btn primary" style={{ width: '100%' }} disabled>
            <PixIcon name="play" /> 练所选 [v0.7]
          </button>
        </div>
      </Group>

      <Group title={`▌ 错题列表 · ${filtered.length} 项 / 30 天`}>
        {filtered.length === 0 ? (
          <div style={{ color: 'var(--kt2-fg-dim)', fontSize: 13, lineHeight: 1.5, padding: 8 }}>
            » 当前筛选条件下没有错题
            <br />» 切换 "全部" 或换个 tag 查看
          </div>
        ) : (
          <div
            className="r-sink"
            style={{ background: 'var(--kt2-sunken)', flex: 1, overflow: 'auto' }}
          >
            <table className="r-list">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>#</th>
                  <th style={{ width: 180 }}>词条</th>
                  <th style={{ width: 100 }}>模式</th>
                  <th>错误类型</th>
                  <th style={{ width: 160 }}>推荐</th>
                  <th style={{ width: 90, textAlign: 'right' }}>反应</th>
                  <th style={{ width: 150, textAlign: 'right' }}>时间</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 200).map((r, i) => (
                  <tr key={r.id} className="zebra">
                    <td style={{ color: 'var(--kt2-fg-dim)' }}>
                      {(i + 1).toString().padStart(3, '0')}
                    </td>
                    <td className="r-cjk" style={{ color: 'var(--kt2-fg-bright)' }}>
                      {r.itemId}
                    </td>
                    <td className="kt-mono" style={{ fontSize: 11, color: 'var(--kt2-fg-dim)' }}>
                      {r.answerMode}
                    </td>
                    <td>
                      {r.errorTags.length === 0 ? (
                        <span style={{ color: 'var(--kt2-fg-dim)' }}>—</span>
                      ) : (
                        <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                          {r.errorTags.map((t) => (
                            <ErrorTagChip key={t} tag={t} />
                          ))}
                        </span>
                      )}
                    </td>
                    <td>
                      <RecommendationCell errorTags={r.errorTags} />
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        fontFamily: 'var(--pix-display)',
                        fontSize: 9,
                        color:
                          r.reactionTimeMs > 5000
                            ? 'var(--kt2-danger)'
                            : r.reactionTimeMs > 3000
                              ? 'var(--kt2-accent-2)'
                              : 'var(--kt2-accent)',
                      }}
                    >
                      {r.reactionTimeMs}ms
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        fontSize: 11,
                        color: 'var(--kt2-fg-dim)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {formatDate(r.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div
          style={{
            marginTop: 6,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12,
            color: 'var(--kt2-fg-dim)',
          }}
        >
          {filtered.length > 200 && <span>表格已截到前 200 条;完整查询在 v0.7+</span>}
          <span style={{ marginLeft: 'auto' }} />
          <a href="#/" className="r-btn" style={{ textDecoration: 'none' }}>
            <PixIcon name="home" /> 回首页
          </a>
        </div>
      </Group>
    </div>
  );
}

function RecommendationCell({ errorTags }: { errorTags: string[] }): JSX.Element {
  const recos = recommendationsFor(errorTags);
  if (recos.length === 0) {
    return <span style={{ color: 'var(--kt2-fg-dim)', fontSize: 11 }}>—</span>;
  }
  return (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      {recos.map((r) => (
        <a
          key={`${r.label}::${r.reason}`}
          href={r.href}
          className="r-btn"
          style={{
            textDecoration: 'none',
            fontSize: 11,
            padding: '0 6px',
            lineHeight: 1.6,
          }}
          title={`基于 ${ERROR_TAG_LABEL_ZH[r.reason] ?? r.reason}`}
        >
          {r.label}
        </a>
      ))}
    </span>
  );
}

function FilterRow({
  label,
  count,
  checked,
  onClick,
}: {
  label: string;
  count: number;
  checked: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        all: 'unset',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        cursor: 'pointer',
        padding: 2,
        color: checked ? 'var(--kt2-fg-bright)' : 'var(--kt2-fg)',
      }}
    >
      <span className={`r-chk ${checked ? 'on' : ''}`} />
      <span style={{ flex: 1 }}>{label}</span>
      <span style={{ color: 'var(--kt2-fg-dim)', fontSize: 12 }}>({count})</span>
    </button>
  );
}

function resolveTagLabel(tag: string): string {
  return Object.prototype.hasOwnProperty.call(ERROR_TAG_LABEL_ZH, tag)
    ? ERROR_TAG_LABEL_ZH[tag as keyof typeof ERROR_TAG_LABEL_ZH]
    : tag;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${m}/${day} ${hh}:${mm}`;
}

const pageGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '180px 1fr',
  gap: 10,
  padding: 10,
  height: '100%',
};

function Group({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div className="r-group" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="title">{title}</div>
      {children}
    </div>
  );
}

function LoadingPanel(): JSX.Element {
  return (
    <div style={pageGrid}>
      <Group title="▌ 筛选">
        <div style={{ color: 'var(--kt2-fg-dim)' }}>加载中...</div>
      </Group>
      <Group title="▌ 错题列表">
        <div className="kt-skel" style={{ width: '100%', height: 14, marginBottom: 8 }} />
        <div className="kt-skel" style={{ width: '70%', height: 14, marginBottom: 8 }} />
        <div className="kt-skel" style={{ width: '80%', height: 14 }} />
      </Group>
    </div>
  );
}

function ErrorPanel({ message }: { message: string }): JSX.Element {
  return (
    <div style={pageGrid}>
      <Group title="▌ 筛选">
        <div style={{ color: 'var(--kt2-fg-dim)' }}>—</div>
      </Group>
      <Group title="▌ ERR · 错题读取失败">
        <div className="kt-banner kt-banner--err">
          <span className="kt-banner__glyph">!</span>
          <div style={{ fontSize: 13 }}>{message}</div>
        </div>
      </Group>
    </div>
  );
}
