import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type ReactNode,
} from 'react';

import type { StudyMode } from '../App';
import { PixIcon } from '../features/style/PixIcon';
import {
  listStudyItems,
  recordStudyView,
  toggleStudyMarked,
  type StudyFilter,
  type StudyItemRow,
} from '../tauri/invoke';

const USER_ID = 'default-user';
/** Wait this long after a card mounts before it counts as "viewed". */
const VIEW_THRESHOLD_MS = 2_000;
/** localStorage key prefix for "where did I leave off in pack X". */
const RESUME_KEY_PREFIX = 'study:resume:';

interface StudyPageProps {
  packId: string;
  mode: StudyMode;
}

/**
 * v0.9.0 Study card view. Renders one item at a time with surface / kana / romaji / pos / jlpt /
 * 中文意思 / 例句. After {@link VIEW_THRESHOLD_MS} on a card, view_count is incremented in SQLite
 * (auto "已学过"); user can also press the ✓ button to force-toggle the marked flag.
 *
 * Keyboard:
 *   ← / → — prev / next
 *   Space / Enter — toggle marked
 *   Esc / Q — back to pack picker
 *
 * Resume: the current index is mirrored to localStorage so reopening the same pack resumes
 * from the last card. SQLite holds the durable progress (view_count / marked); the resume key
 * is purely cosmetic and capped at one entry per pack.
 */
export function StudyPage({ packId, mode }: StudyPageProps): JSX.Element {
  const [items, setItems] = useState<StudyItemRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  // Local mirror of view_count / marked so the UI can update before SQLite round-trips.
  const [progressByItem, setProgressByItem] = useState<
    Record<string, { viewCount: number; marked: boolean }>
  >({});

  // Load items + restore resume index ----------------------------------------
  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    setIndex(0);
    setProgressByItem({});
    void (async (): Promise<void> => {
      try {
        const filter: StudyFilter = mode;
        const rows = await listStudyItems({ packId, userId: USER_ID, filter });
        if (cancelled) return;
        setItems(rows);
        const initialMap: Record<string, { viewCount: number; marked: boolean }> = {};
        for (const r of rows) {
          initialMap[r.id] = { viewCount: r.viewCount, marked: r.marked };
        }
        setProgressByItem(initialMap);
        const resumeIdx = readResumeIndex(packId, mode);
        setIndex(resumeIdx > 0 && resumeIdx < rows.length ? resumeIdx : 0);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, [packId, mode]);

  const current = items?.[index] ?? null;

  // Persist resume index ------------------------------------------------------
  useEffect(() => {
    if (!items || items.length === 0) return;
    writeResumeIndex(packId, mode, index);
  }, [items, packId, mode, index]);

  // Auto-record view after VIEW_THRESHOLD_MS ----------------------------------
  // Reset the timer every time `current.id` changes; if the user blasts through cards in <2s
  // we never inflate view_count. Keeping the latest fired id in a ref guards against React
  // strict-mode double-mount triggering two views per card.
  const lastViewedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!current) return;
    const id = current.id;
    const timer = setTimeout(() => {
      if (lastViewedRef.current === id) return;
      lastViewedRef.current = id;
      void (async (): Promise<void> => {
        try {
          await recordStudyView({ userId: USER_ID, itemId: id });
          setProgressByItem((prev) => {
            const cur = prev[id] ?? { viewCount: 0, marked: false };
            return { ...prev, [id]: { ...cur, viewCount: cur.viewCount + 1 } };
          });
        } catch (e) {
          // Non-fatal: log but don't block UI. The view will retry next time the card mounts.
          console.warn('[study] recordStudyView failed', e);
        }
      })();
    }, VIEW_THRESHOLD_MS);
    return (): void => clearTimeout(timer);
  }, [current]);

  // Navigation ----------------------------------------------------------------
  const goPrev = useCallback((): void => {
    setIndex((i) => Math.max(0, i - 1));
  }, []);
  const goNext = useCallback((): void => {
    setIndex((i) => (items ? Math.min(items.length - 1, i + 1) : i));
  }, [items]);
  const exit = useCallback((): void => {
    globalThis.location.hash = '#/study';
  }, []);
  const toggleMarked = useCallback(
    (itemId: string): void => {
      const cur = progressByItem[itemId] ?? { viewCount: 0, marked: false };
      const next = !cur.marked;
      setProgressByItem((prev) => ({
        ...prev,
        [itemId]: { ...cur, marked: next },
      }));
      void (async (): Promise<void> => {
        try {
          await toggleStudyMarked({ userId: USER_ID, itemId, marked: next });
        } catch (e) {
          console.warn('[study] toggleStudyMarked failed', e);
          // Roll back on failure so UI matches DB.
          setProgressByItem((prev) => ({ ...prev, [itemId]: cur }));
        }
      })();
    },
    [progressByItem],
  );

  // Keyboard handler ----------------------------------------------------------
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      // Ignore if user is typing in an input (none in this page today, but future-proof).
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goNext();
      } else if (e.key === ' ' || e.key === 'Enter') {
        if (current) {
          e.preventDefault();
          toggleMarked(current.id);
        }
      } else if (e.key === 'Escape' || e.key === 'q' || e.key === 'Q') {
        e.preventDefault();
        exit();
      }
    };
    globalThis.addEventListener('keydown', handler);
    return (): void => globalThis.removeEventListener('keydown', handler);
  }, [current, goPrev, goNext, exit, toggleMarked]);

  // Render --------------------------------------------------------------------
  if (error) return <ErrorPanel message={error} />;
  if (!items) return <LoadingPanel />;
  if (items.length === 0) return <EmptyPanel mode={mode} />;
  if (!current) return <LoadingPanel />;

  const liveProgress = progressByItem[current.id] ?? {
    viewCount: current.viewCount,
    marked: current.marked,
  };
  const studied = liveProgress.viewCount >= 1 || liveProgress.marked;

  return (
    <div style={pageWrap}>
      <Header
        index={index}
        total={items.length}
        packId={packId}
        mode={mode}
        studiedBadge={studied}
        markedExplicitly={liveProgress.marked}
      />
      <Card item={current} marked={liveProgress.marked} />
      <Footer
        canPrev={index > 0}
        canNext={index < items.length - 1}
        marked={liveProgress.marked}
        onPrev={goPrev}
        onNext={goNext}
        onToggleMarked={() => toggleMarked(current.id)}
        onExit={exit}
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Subcomponents
// ──────────────────────────────────────────────────────────────────────

function Header({
  index,
  total,
  packId,
  mode,
  studiedBadge,
  markedExplicitly,
}: {
  index: number;
  total: number;
  packId: string;
  mode: StudyMode;
  studiedBadge: boolean;
  markedExplicitly: boolean;
}): JSX.Element {
  const modeLabel = mode === 'reviewed' ? '复习模式' : mode === 'new' ? '只看新词' : '学习模式';
  return (
    <div className="r-group" style={{ padding: '8px 12px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span
            style={{
              fontFamily: 'var(--pix-display)',
              fontSize: 16,
              color: 'var(--kt2-accent)',
            }}
          >
            {index + 1} / {total}
          </span>
          <span className="r-label" style={{ fontSize: 8 }}>
            {packId} · {modeLabel}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6, fontSize: 11 }}>
          {studiedBadge && (
            <span
              style={{
                padding: '2px 8px',
                background: markedExplicitly ? 'var(--kt2-accent-2)' : 'var(--kt2-accent)',
                color: 'var(--kt2-bg)',
                fontFamily: 'var(--pix-display)',
                letterSpacing: '0.04em',
              }}
            >
              {markedExplicitly ? '✓ 已掌握' : '✓ 已学过'}
            </span>
          )}
          <span className="r-label" style={{ fontSize: 8 }}>
            ← / → 翻页 · Space 标记 · Esc 退出
          </span>
        </div>
      </div>
    </div>
  );
}

function Card({ item, marked }: { item: StudyItemRow; marked: boolean }): JSX.Element {
  const meaning = item.meaningsZh.join(' / ');
  const tags = item.tags.filter((t) => t !== 'draft' && t !== 'foundation');

  return (
    <div
      className="r-raise"
      style={{
        padding: 24,
        background: 'var(--kt2-panel-2)',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        overflow: 'auto',
        borderColor: marked ? 'var(--kt2-accent-2)' : undefined,
      }}
    >
      <div style={{ textAlign: 'center', paddingTop: 12 }}>
        <div
          style={{
            fontSize: 56,
            fontFamily: 'var(--pix-display), serif',
            color: 'var(--kt2-fg-bright)',
            letterSpacing: '0.08em',
            lineHeight: 1.1,
          }}
        >
          {item.surface}
        </div>
        <div
          style={{
            marginTop: 12,
            fontSize: 28,
            color: 'var(--kt2-accent)',
            fontFamily: 'var(--pix-display), serif',
          }}
        >
          {item.kana}
        </div>
        <div
          style={{
            marginTop: 6,
            fontSize: 16,
            color: 'var(--kt2-fg-dim)',
            fontFamily: 'monospace',
          }}
        >
          {item.romaji.join(' · ')}
        </div>
      </div>

      <MetaRow item={item} extraTags={tags} />

      <div className="r-sink" style={{ padding: 14 }}>
        <div className="r-label" style={{ fontSize: 8, marginBottom: 6 }}>
          意思 (Meaning)
        </div>
        <div style={{ fontSize: 18, color: 'var(--kt2-fg-bright)', lineHeight: 1.5 }}>
          {meaning || '(no Chinese gloss)'}
        </div>
      </div>

      {item.examples.length > 0 && (
        <div className="r-sink" style={{ padding: 14 }}>
          <div className="r-label" style={{ fontSize: 8, marginBottom: 8 }}>
            例句 (Examples)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {item.examples.map((ex) => (
              <div key={ex.id}>
                <div style={{ fontSize: 16, color: 'var(--kt2-fg-bright)', lineHeight: 1.5 }}>
                  {ex.ja}
                </div>
                {ex.kana && (
                  <div
                    style={{
                      fontSize: 13,
                      color: 'var(--kt2-fg-dim)',
                      lineHeight: 1.4,
                      marginTop: 2,
                    }}
                  >
                    {ex.kana}
                  </div>
                )}
                <div
                  style={{
                    fontSize: 13,
                    color: 'var(--kt2-accent)',
                    lineHeight: 1.4,
                    marginTop: 2,
                  }}
                >
                  {ex.zh}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MetaRow({ item, extraTags }: { item: StudyItemRow; extraTags: string[] }): JSX.Element {
  const chips: string[] = [];
  if (item.pos) chips.push(item.pos);
  if (item.jlpt) chips.push(item.jlpt);
  for (const t of extraTags.slice(0, 6)) chips.push(t);
  if (chips.length === 0) return <div />;
  return (
    <div
      style={{
        display: 'flex',
        gap: 6,
        flexWrap: 'wrap',
        justifyContent: 'center',
        fontSize: 11,
        color: 'var(--kt2-fg-dim)',
      }}
    >
      {chips.map((c, i) => (
        <span
          key={`${c}-${String(i)}`}
          style={{
            padding: '2px 8px',
            background: 'var(--kt2-sunken)',
            borderRadius: 2,
            fontFamily: 'var(--pix-font)',
          }}
        >
          {c}
        </span>
      ))}
    </div>
  );
}

function Footer({
  canPrev,
  canNext,
  marked,
  onPrev,
  onNext,
  onToggleMarked,
  onExit,
}: {
  canPrev: boolean;
  canNext: boolean;
  marked: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToggleMarked: () => void;
  onExit: () => void;
}): JSX.Element {
  return (
    <div
      className="r-group"
      style={{
        padding: '10px 12px',
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="r-btn" onClick={onPrev} disabled={!canPrev}>
          ← 上一个
        </button>
        <button className="r-btn" onClick={onNext} disabled={!canNext}>
          下一个 →
        </button>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          className={`r-btn ${marked ? 'primary' : ''}`}
          onClick={onToggleMarked}
          aria-pressed={marked}
        >
          {marked ? '✓ 已掌握(撤销)' : '标记已学'}
        </button>
        <button className="r-btn" onClick={onExit}>
          <PixIcon name="close" /> 退出
        </button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Resume helpers (localStorage)
// ──────────────────────────────────────────────────────────────────────

function resumeKey(packId: string, mode: StudyMode): string {
  return `${RESUME_KEY_PREFIX}${packId}:${mode}`;
}

function readResumeIndex(packId: string, mode: StudyMode): number {
  try {
    const raw = globalThis.localStorage?.getItem(resumeKey(packId, mode));
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

function writeResumeIndex(packId: string, mode: StudyMode, index: number): void {
  try {
    globalThis.localStorage?.setItem(resumeKey(packId, mode), String(index));
  } catch {
    /* quota / privacy mode — silent */
  }
}

// ──────────────────────────────────────────────────────────────────────
// Layout / state panels
// ──────────────────────────────────────────────────────────────────────

const pageWrap: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: 10,
  height: '100%',
  minHeight: 0,
};

function Group({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div className="r-group">
      <div className="title">{title}</div>
      {children}
    </div>
  );
}

function LoadingPanel(): JSX.Element {
  return (
    <div style={pageWrap}>
      <Group title="▌ 学习模式">
        <div style={{ color: 'var(--kt2-fg-dim)' }}>读取词条中...</div>
      </Group>
    </div>
  );
}

function EmptyPanel({ mode }: { mode: StudyMode }): JSX.Element {
  const msg =
    mode === 'reviewed'
      ? '该词包还没有任何学过的词。先回去用「继续学习」走一遍。'
      : mode === 'new'
        ? '该词包所有词都已经学过了 — 试试切到「复习已学」。'
        : '该词包没有可显示的词条。检查 #/settings/packs 是否启用。';
  return (
    <div style={pageWrap}>
      <Group title="▌ 学习模式">
        <div style={{ fontSize: 14, color: 'var(--kt2-fg-dim)', lineHeight: 1.6 }}>{msg}</div>
        <div style={{ marginTop: 12 }}>
          <a href="#/study" className="r-btn" style={{ textDecoration: 'none' }}>
            ← 返回选词包
          </a>
        </div>
      </Group>
    </div>
  );
}

function ErrorPanel({ message }: { message: string }): JSX.Element {
  return (
    <div style={pageWrap}>
      <Group title="▌ ERR · 读取失败">
        <div className="kt-banner kt-banner--err">
          <span className="kt-banner__glyph">!</span>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>无法读取学习词条</div>
            <div style={{ fontSize: 13, opacity: 0.9 }}>{message}</div>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <a href="#/study" className="r-btn" style={{ textDecoration: 'none' }}>
            ← 返回选词包
          </a>
        </div>
      </Group>
    </div>
  );
}
