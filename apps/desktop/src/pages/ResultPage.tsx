import { createBrowserSfx } from '@kana-typing/game-runtime';
import { useEffect, useState, type CSSProperties, type JSX, type ReactNode } from 'react';

import { maybeUpdateComboRecord, readComboRecord } from '../features/result/comboRecord';
import {
  computeSessionInsights,
  type CrossGameRecommendation,
  type SessionInsights,
} from '../features/result/sessionInsights';
import { ErrorTagChip } from '../features/style/ErrorTagChip';
import { ERROR_TAG_LABEL_ZH } from '../features/style/errorTagPalette';
import { PixIcon } from '../features/style/PixIcon';
import {
  listAttemptsBySession,
  listProgress,
  type AttemptEventRow,
  type ProgressDto,
} from '../tauri/invoke';

export interface ResultPageProps {
  sessionId: string;
}

interface Aggregates {
  total: number;
  correct: number;
  accuracy: number;
  avgReactionMs: number;
  totalDurationMs: number;
  /** Longest consecutive-correct streak in this session. */
  peakCombo: number;
  /** Rough KPM estimate: 1 character per attempt over the wall-clock total. */
  kpm: number;
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
  const [progress, setProgress] = useState<ProgressDto[]>([]);
  const [insights, setInsights] = useState<SessionInsights | null>(null);
  const [comboBadge, setComboBadge] = useState<{ brokeCombo: boolean; brokeKpm: boolean } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        // We pull attempts + every progress row in parallel. progress is the user's full set
        // (capped at 5000 to match the boot pages); computeSessionInsights filters down to
        // the items touched in this session.
        const [rows, progressDtos] = await Promise.all([
          listAttemptsBySession({ sessionId: props.sessionId }),
          listProgress({ userId: 'default-user', limit: 5000 }),
        ]);
        setAttempts(rows);
        setProgress(progressDtos);
        const computed = computeSessionInsights({ attempts: rows, currentProgress: progressDtos });
        setInsights(computed);
        // Also reconcile the all-time peak combo / KPM with this session's numbers; a one-shot
        // localStorage write per result page is cheap and lets the badge render synchronously.
        const ag = aggregate(rows);
        const outcome = maybeUpdateComboRecord({ peakCombo: ag.peakCombo, peakKpm: ag.kpm });
        setComboBadge({ brokeCombo: outcome.brokeCombo, brokeKpm: outcome.brokeKpm });
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, [props.sessionId]);

  if (error) return <ErrorPanel message={error} />;
  if (!attempts) return <LoadingPanel />;

  const ag = aggregate(attempts);
  const allTimeRecord = readComboRecord();
  void progress; // ProgressDto kept in state for future stat panels; current view consumes via insights.
  const isPerfect = ag.total > 0 && ag.correct === ag.total;
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
      {isPerfect && <PerfectFinale />}
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
            <StatCell
              n={ag.peakCombo}
              unit="连击"
              label="最高连击"
              color="var(--kt2-accent)"
              {...(comboBadge?.brokeCombo && { badge: '破纪录' })}
              {...(allTimeRecord.peakCombo > 0 &&
                !comboBadge?.brokeCombo && {
                  subtitle: `历史 ${String(allTimeRecord.peakCombo)}`,
                })}
            />
            <StatCell
              n={ag.kpm.toFixed(1)}
              unit="KPM"
              label="速率"
              color="var(--kt2-accent-2)"
              {...(comboBadge?.brokeKpm && { badge: '破纪录' })}
              {...(allTimeRecord.peakKpm > 0 &&
                !comboBadge?.brokeKpm && {
                  subtitle: `历史 ${allTimeRecord.peakKpm.toFixed(1)}`,
                })}
            />
          </div>
        </Group>

        {insights ? <InsightsPanel insights={insights} /> : null}

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
  badge,
  subtitle,
}: {
  n: number | string;
  unit: string;
  label: string;
  color: string;
  badge?: string;
  subtitle?: string;
}): JSX.Element {
  return (
    <div
      className="r-sink"
      style={{
        padding: '8px 6px',
        textAlign: 'center',
        background: 'var(--kt2-sunken)',
        position: 'relative',
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
      {subtitle && (
        <div className="r-label" style={{ fontSize: 7, marginTop: 2, opacity: 0.65 }}>
          {subtitle}
        </div>
      )}
      {badge && (
        <span
          style={{
            position: 'absolute',
            top: 2,
            right: 4,
            fontFamily: 'var(--pix-display)',
            fontSize: 7,
            color: 'var(--kt2-accent)',
            textShadow: '0 0 4px var(--kt2-accent)',
            border: '1px solid var(--kt2-accent)',
            padding: '0 3px',
          }}
        >
          {badge}
        </span>
      )}
    </div>
  );
}

function InsightsPanel({ insights }: { insights: SessionInsights }): JSX.Element | null {
  const hasMistakes = insights.newMistakeItemIds.length > 0;
  const hasMastered = insights.newlyMasteredItemIds.length > 0;
  const hasRecos = insights.crossGameRecommendations.length > 0;
  if (!hasMistakes && !hasMastered && !hasRecos) return null;
  return (
    <Group title="▌ 本次提升">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
        {hasMistakes && (
          <InsightRow label="新进错题" count={insights.newMistakeItemIds.length}>
            <ItemChips items={insights.newMistakeItemIds.slice(0, 6)} color="var(--kt2-danger)" />
          </InsightRow>
        )}
        {hasMastered && (
          <InsightRow label="新掌握" count={insights.newlyMasteredItemIds.length}>
            <ItemChips
              items={insights.newlyMasteredItemIds.slice(0, 6)}
              color="var(--kt2-accent)"
            />
          </InsightRow>
        )}
        {hasRecos && (
          <InsightRow label="推荐继续练" count={insights.crossGameRecommendations.length}>
            <RecommendationChips recos={insights.crossGameRecommendations.slice(0, 4)} />
          </InsightRow>
        )}
      </div>
    </Group>
  );
}

function InsightRow({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: ReactNode;
}): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="r-label" style={{ fontSize: 7 }}>
          {label}
        </span>
        <span
          style={{
            fontFamily: 'var(--pix-display)',
            fontSize: 11,
            color: 'var(--kt2-fg-bright)',
          }}
        >
          ×{String(count)}
        </span>
      </div>
      {children}
    </div>
  );
}

function ItemChips({ items, color }: { items: string[]; color: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {items.map((id) => (
        <span
          key={id}
          className="r-cjk"
          style={{
            border: `1px solid ${color}`,
            padding: '1px 6px',
            fontSize: 11,
            color,
          }}
        >
          {id}
        </span>
      ))}
    </div>
  );
}

function RecommendationChips({ recos }: { recos: CrossGameRecommendation[] }): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {recos.map((r) => (
        <a
          key={`${r.targetGameType}::${r.reason}`}
          href={r.href}
          className="r-btn"
          style={{
            textDecoration: 'none',
            fontSize: 12,
            padding: '2px 8px',
          }}
          title={`基于 ${ERROR_TAG_LABEL_ZH[r.reason] ?? r.reason} ×${String(r.weight)}`}
        >
          {r.label} →
        </a>
      ))}
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
  // Peak combo: longest run of consecutive `isCorrect` attempts in chronological order.
  // attempts arrive oldest-first from list_attempts_by_session.
  let runningStreak = 0;
  let peakCombo = 0;
  for (const a of attempts) {
    if (a.isCorrect) {
      runningStreak += 1;
      if (runningStreak > peakCombo) peakCombo = runningStreak;
    } else {
      runningStreak = 0;
    }
  }
  // Rough KPM: 1 keystroke ≈ 1 attempt. We avoid trying to count actual chars (every game
  // type has different input shape). Total wall-clock is the sum of reactionTimeMs which is
  // a tight lower bound; if a session ran 3min real but reactions sum to 90s, KPM gets
  // overstated — acceptable for a "did I beat my record" badge.
  const minutes = totalDurationMs / 60_000;
  const kpm = minutes > 0 ? total / minutes : 0;
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
    peakCombo,
    kpm,
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

/**
 * Full-screen overlay shown when accuracy hits 100%. Plays the `perfect` sfx once on mount
 * and animates a phosphor-green "完璧 PERFECT" banner that fades after ~2s. Pointer-events
 * stay disabled so the underlying page is still interactive while the banner runs.
 */
function PerfectFinale(): JSX.Element {
  const [opacity, setOpacity] = useState(1);
  useEffect(() => {
    // Fire the victory sfx once. createBrowserSfx is cheap (lazy AudioContext), and the
    // Web-Audio-policy resume happens automatically because the user clicked "再练" /
    // navigated to the result page from a scene where they'd already gestured.
    const sfx = createBrowserSfx();
    sfx.play('perfect');
    // Fade out after 1.5s; remove the overlay after 2.0s.
    const fadeId = globalThis.setTimeout(() => setOpacity(0), 1500);
    return () => globalThis.clearTimeout(fadeId);
  }, []);
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 50,
        pointerEvents: 'none',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        opacity,
        transition: 'opacity 600ms ease-out',
        background:
          'radial-gradient(circle at center, rgba(126, 231, 135, 0.25), rgba(0, 0, 0, 0.4) 70%)',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--pix-display)',
          fontSize: 64,
          color: 'var(--kt2-accent)',
          letterSpacing: '0.12em',
          textShadow: '0 0 20px var(--kt2-accent), 0 0 4px #fff',
          animation: 'kt-perfect-pulse 1.4s ease-out',
        }}
      >
        完璧
      </div>
      <div
        style={{
          fontFamily: 'var(--pix-display)',
          fontSize: 24,
          color: 'var(--kt2-fg-bright)',
          letterSpacing: '0.4em',
          marginTop: 12,
          textShadow: '0 0 8px var(--kt2-accent)',
        }}
      >
        PERFECT
      </div>
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
