import { useEffect, useMemo, useState, type CSSProperties, type JSX, type ReactNode } from 'react';

import { PixIcon } from '../features/style/PixIcon';
import { listItems, listProgress, type DevItemRow, type ProgressDto } from '../tauri/invoke';

interface LibraryRow {
  item: DevItemRow;
  progressByDimension: Map<string, ProgressDto>;
}

const DIMENSION_COLUMNS: Array<{ key: string; label: string }> = [
  { key: 'kanji_reading', label: '汉字读音' },
  { key: 'kana_typing', label: '假名打字' },
  { key: 'meaning_recall', label: '词义' },
];

/**
 * Sprint 5 library / 词条图鉴 (`#/library`), retro-skinned in C8.
 *
 * Single .r-group containing a retro toolbar (filter button row + search
 * input placeholder + total count) and an .r-list zebra table. Each row
 * renders surface / kana / jlpt + a .kt-mastery--{state} chip per skill
 * dimension (kanji_reading / kana_typing / meaning_recall).
 *
 * Filtering by JLPT / pack and search are stubbed — controls render but
 * don't yet narrow the list. They light up in v0.7+ once content packs
 * land (P0-4).
 */
export function LibraryPage(): JSX.Element {
  const [items, setItems] = useState<DevItemRow[] | null>(null);
  const [progress, setProgress] = useState<ProgressDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        const [its, prog] = await Promise.all([
          listItems({ limit: 500 }),
          listProgress({ userId: 'default-user', limit: 2000 }),
        ]);
        setItems(its);
        setProgress(prog);
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, []);

  const rows: LibraryRow[] = useMemo(() => {
    if (!items || !progress) return [];
    const byItem = new Map<string, Map<string, ProgressDto>>();
    for (const p of progress) {
      let inner = byItem.get(p.itemId);
      if (!inner) {
        inner = new Map();
        byItem.set(p.itemId, inner);
      }
      inner.set(p.skillDimension, p);
    }
    return items.map((it) => ({ item: it, progressByDimension: byItem.get(it.id) ?? new Map() }));
  }, [items, progress]);

  if (error) return <ErrorPanel message={error} />;
  if (!items || !progress) return <LoadingPanel />;

  return (
    <div style={pageGrid}>
      <Group title={`▌ 题库 · ${items.length} 词`}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, alignItems: 'center' }}>
          <button className="r-btn primary">全部</button>
          <button className="r-btn" disabled>
            JLPT
          </button>
          <button className="r-btn" disabled>
            自定义
          </button>
          <input
            className="r-input"
            placeholder="搜索 (v0.7+)"
            disabled
            style={{ marginLeft: 'auto', width: 220 }}
          />
          <button className="r-btn" disabled>
            <PixIcon name="save" /> 导入
          </button>
        </div>
        <div
          className="r-sink"
          style={{ background: 'var(--kt2-sunken)', flex: 1, overflow: 'auto' }}
        >
          <table className="r-list">
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th style={{ width: 100 }}>词面</th>
                <th style={{ width: 130 }}>假名</th>
                <th>意思</th>
                <th style={{ width: 60 }}>JLPT</th>
                {DIMENSION_COLUMNS.map((d) => (
                  <th key={d.key} style={{ width: 110 }}>
                    {d.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.item.id} className="zebra">
                  <td style={{ color: 'var(--kt2-fg-dim)' }}>
                    {(i + 1).toString().padStart(3, '0')}
                  </td>
                  <td className="r-cjk" style={{ fontSize: 16, color: 'var(--kt2-fg-bright)' }}>
                    {r.item.surface}
                  </td>
                  <td className="r-cjk" style={{ color: 'var(--kt2-accent)' }}>
                    {r.item.kana}
                  </td>
                  <td style={{ color: 'var(--kt2-fg)' }}>
                    {r.item.meaningsZh.length > 0 ? (
                      r.item.meaningsZh.join('、')
                    ) : (
                      <span style={{ color: 'var(--kt2-fg-dim)' }}>—</span>
                    )}
                  </td>
                  <td>
                    {r.item.jlpt ? (
                      <span className="r-tag" style={{ color: 'var(--kt2-accent-2)' }}>
                        {r.item.jlpt.toUpperCase()}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--kt2-fg-dim)' }}>—</span>
                    )}
                  </td>
                  {DIMENSION_COLUMNS.map((d) => (
                    <td key={d.key}>
                      <MasteryCell p={r.progressByDimension.get(d.key)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div
          style={{
            marginTop: 6,
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            fontSize: 12,
            color: 'var(--kt2-fg-dim)',
          }}
        >
          <span>
            共 {items.length} 词,显示前 {rows.length} 条
          </span>
          <span style={{ marginLeft: 'auto' }} />
          <a href="#/" className="r-btn" style={{ textDecoration: 'none' }}>
            <PixIcon name="home" /> 回首页
          </a>
        </div>
      </Group>
    </div>
  );
}

function MasteryCell({ p }: { p: ProgressDto | undefined }): JSX.Element {
  if (!p) {
    return (
      <span className="kt-mastery kt-mastery--new" title="尚未尝试">
        new
      </span>
    );
  }
  const stateClass = `kt-mastery kt-mastery--${p.state}`;
  return (
    <span
      className={stateClass}
      title={`state=${p.state}, mastery=${p.masteryScore.toFixed(0)}, exposures=${p.exposureCount}`}
    >
      {p.state} · {p.masteryScore.toFixed(0)}
    </span>
  );
}

const pageGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr',
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
      <Group title="▌ 题库">
        <div style={{ color: 'var(--kt2-fg-dim)' }}>加载词条...</div>
      </Group>
    </div>
  );
}

function ErrorPanel({ message }: { message: string }): JSX.Element {
  return (
    <div style={pageGrid}>
      <Group title="▌ ERR · 题库读取失败">
        <div className="kt-banner kt-banner--err">
          <span className="kt-banner__glyph">!</span>
          <div style={{ fontSize: 13 }}>{message}</div>
        </div>
      </Group>
    </div>
  );
}
