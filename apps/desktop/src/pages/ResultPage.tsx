import { useEffect, useState, type CSSProperties, type JSX, type ReactNode } from 'react';

import { ErrorTagChip } from '../features/style/ErrorTagChip';
import { ERROR_TAG_LABEL_ZH } from '../features/style/errorTagPalette';
import { PixIcon } from '../features/style/PixIcon';
import { listAttemptsBySession, type AttemptEventRow } from '../tauri/invoke';

export interface ResultPageProps {
  sessionId: string;
}

interface Aggregates {
  total: number;
  correct: number;
  accuracy: number;
  avgReactionMs: number;
  totalDurationMs: number;
  topErrors: Array<{ tag: string; count: number }>;
  slowest: AttemptEventRow[];
  wrongOnly: AttemptEventRow[];
}

/**
 * Sprint 3 result page (`#/result/:sessionId`), retro-skinned in C8.
 *
 * Two-column layout (1fr / 1.2fr) inside .r-main:
 *
 *   Left   ▌ SCORE — pixel-display accuracy big number + 4 StatCells
 *           (correct / total / 用时 / avg reaction).
 *          ▌ 错误分布 — top error tags as repeating-stripe progress rows.
 *
 *   Right  ▌ 本次错题 — wrong-only attempts as .r-list zebra table.
 *          Bottom: 再练 / 回首页 buttons.
 */
export function ResultPage(props: ResultPageProps): JSX.Element {
  const [attempts, setAttempts] = useState<AttemptEventRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        const rows = await listAttemptsBySession({ sessionId: props.sessionId });
        setAttempts(rows);
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, [props.sessionId]);

  if (error) return <ErrorPanel message={error} />;
  if (!attempts) return <LoadingPanel />;

  const ag = aggregate(attempts);
  const accuracyColor =
    ag.accuracy >= 90
      ? 'var(--kt2-accent)'
      : ag.accuracy >= 70
        ? 'var(--kt2-accent-2)'
        : 'var(--kt2-danger)';
  const grade =
    ag.accuracy >= 95
      ? 'A+'
      : ag.accuracy >= 90
        ? 'A'
        : ag.accuracy >= 80
          ? 'B'
          : ag.accuracy >= 70
            ? 'C'
            : ag.accuracy >= 60
              ? 'D'
              : 'F';
  const maxTagCount = ag.topErrors.reduce((m, e) => Math.max(m, e.count), 0) || 1;

  return (
    <div style={pageGrid}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Group title="▌ SCORE">
          <div style={{ textAlign: 'center', padding: '12px 0 16px' }}>
            <PixIcon name="medal" size={48} style={{ marginBottom: 6 }} />
            <div
              style={{
                fontFamily: 'var(--pix-display)',
                fontSize: 28,
                color: accuracyColor,
                letterSpacing: '0.06em',
                textShadow: `0 0 12px ${accuracyColor}`,
                margin: '8px 0',
              }}
            >
              {ag.accuracy.toFixed(0)}%
            </div>
            <div className="r-label">本次评级 · {grade}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
            <StatCell n={ag.correct} unit="对" label="正确" color="var(--kt2-accent)" />
            <StatCell n={ag.total} unit="题" label="完成" color="var(--kt2-fg-bright)" />
            <StatCell
              n={formatDuration(ag.totalDurationMs)}
              unit=""
              label="用时"
              color="var(--kt2-link)"
            />
            <StatCell
              n={`${ag.avgReactionMs.toFixed(0)}ms`}
              unit=""
              label="平均反应"
              color="var(--kt2-accent-2)"
            />
          </div>
        </Group>

        <Group title="▌ 错误分布">
          {ag.topErrors.length === 0 ? (
            <div style={{ color: 'var(--kt2-fg-dim)', fontSize: 13, lineHeight: 1.5 }}>
              » 全部正确,本次零错题
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
              {ag.topErrors.slice(0, 6).map((e) => {
                const pct = (e.count / maxTagCount) * 100;
                const tagColor = `var(--tag-${tagToken(e.tag)})`;
                return (
                  <div
                    key={e.tag}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '90px 1fr 30px',
                      gap: 6,
                      alignItems: 'center',
                    }}
                  >
                    <span>{resolveTagLabel(e.tag)}</span>
                    <div className="r-progress" style={{ height: 12 }}>
                      <div
                        className="fill"
                        style={{
                          width: `${pct}%`,
                          background: `repeating-linear-gradient(90deg,${tagColor} 0,${tagColor} 6px,${tagColor} 6px,${tagColor} 8px)`,
                          opacity: 0.85,
                        }}
                      />
                    </div>
                    <span
                      style={{
                        textAlign: 'right',
                        color: tagColor,
                        fontFamily: 'var(--pix-display)',
                        fontSize: 9,
                      }}
                    >
                      {e.count}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Group>
      </div>

      <Group title={`▌ 本次错题 · ${ag.wrongOnly.length} 项`}>
        {ag.wrongOnly.length === 0 ? (
          <div style={{ color: 'var(--kt2-fg-dim)', fontSize: 13, lineHeight: 1.6, padding: 8 }}>
            » 本次没有错题。
            <br />» 全对 — 漂亮 ◎
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
                  <th>词条</th>
                  <th style={{ width: 80, textAlign: 'right' }}>反应</th>
                  <th style={{ width: 200 }}>类型</th>
                </tr>
              </thead>
              <tbody>
                {ag.wrongOnly.slice(0, 20).map((r, i) => (
                  <tr key={r.id} className="zebra">
                    <td style={{ color: 'var(--kt2-fg-dim)' }}>
                      {(i + 1).toString().padStart(2, '0')}
                    </td>
                    <td className="r-cjk" style={{ color: 'var(--kt2-fg-bright)' }}>
                      {r.itemId}
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        fontFamily: 'var(--pix-display)',
                        fontSize: 9,
                        color: 'var(--kt2-accent-2)',
                      }}
                    >
                      {r.reactionTimeMs}ms
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <a href="#/mistakes" className="r-btn primary" style={{ textDecoration: 'none' }}>
            <PixIcon name="mistakes" /> 看错题本
          </a>
          <a href="#/today" className="r-btn" style={{ textDecoration: 'none' }}>
            <PixIcon name="play" /> 再练一组
          </a>
          <a href="#/" className="r-btn" style={{ textDecoration: 'none' }}>
            <PixIcon name="home" /> 回首页
          </a>
        </div>
        <div className="r-label" style={{ marginTop: 8, fontSize: 8 }}>
          session {props.sessionId}
        </div>
      </Group>
    </div>
  );
}

function StatCell({
  n,
  unit,
  label,
  color,
}: {
  n: number | string;
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
          fontSize: 16,
          color,
          marginTop: 4,
          textShadow: `0 0 6px ${color}`,
        }}
      >
        {n}
      </div>
      {unit && (
        <div className="r-label" style={{ fontSize: 7, marginTop: 2 }}>
          {unit}
        </div>
      )}
    </div>
  );
}

function aggregate(attempts: AttemptEventRow[]): Aggregates {
  const total = attempts.length;
  const correct = attempts.filter((a) => a.isCorrect).length;
  const accuracy = total === 0 ? 0 : (correct / total) * 100;
  const avgReactionMs =
    total === 0 ? 0 : attempts.reduce((sum, a) => sum + a.reactionTimeMs, 0) / total;
  const totalDurationMs = attempts.reduce((sum, a) => sum + a.reactionTimeMs, 0);
  const tagCounts = new Map<string, number>();
  for (const a of attempts) {
    for (const t of a.errorTags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  }
  const topErrors = [...tagCounts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
  const slowest = [...attempts].sort((a, b) => b.reactionTimeMs - a.reactionTimeMs);
  const wrongOnly = attempts.filter((a) => !a.isCorrect);
  return {
    total,
    correct,
    accuracy,
    avgReactionMs,
    totalDurationMs,
    topErrors,
    slowest,
    wrongOnly,
  };
}

function resolveTagLabel(tag: string): string {
  return Object.prototype.hasOwnProperty.call(ERROR_TAG_LABEL_ZH, tag)
    ? ERROR_TAG_LABEL_ZH[tag as keyof typeof ERROR_TAG_LABEL_ZH]
    : tag;
}

/**
 * Map an ErrorTag identifier to the CSS-var suffix used in styles.css. Mirrors
 * the collapse logic in errorTagPalette.ts so the result-page bar uses the same
 * hue as the chip elsewhere on screen.
 */
function tagToken(tag: string): string {
  if (tag.includes('shape_confusion') || tag === 'kanji_reading_error') return 'shape_confusion';
  if (tag === 'long_vowel_error') return 'long_vowel';
  if (tag === 'sokuon_error') return 'sokuon';
  if (tag === 'dakuten_error') return 'dakuten';
  if (tag === 'handakuten_error' || tag === 'meaning_confusion') return 'handakuten';
  if (tag === 'youon_error' || tag === 'n_error') return 'youon';
  if (tag === 'particle_error' || tag === 'word_order_error') return 'particle';
  if (
    tag === 'ime_conversion_error' ||
    tag === 'same_sound_confusion' ||
    tag === 'near_sound_confusion'
  ) {
    return 'ime_conversion';
  }
  return 'unknown';
}

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const pageGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1.2fr',
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
      <Group title="▌ SCORE">
        <div style={{ color: 'var(--kt2-fg-dim)', textAlign: 'center', padding: 16 }}>
          读取本次记录...
        </div>
      </Group>
      <Group title="▌ 本次错题">
        <div className="kt-skel" style={{ width: '100%', height: 14, marginBottom: 8 }} />
        <div className="kt-skel" style={{ width: '60%', height: 14 }} />
      </Group>
    </div>
  );
}

function ErrorPanel({ message }: { message: string }): JSX.Element {
  return (
    <div style={pageGrid}>
      <Group title="▌ ERR · 结算读取失败">
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
