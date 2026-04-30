import { useEffect, useMemo, useState, type JSX } from 'react';

import { listItems, listProgress, type DevItemRow, type ProgressDto } from '../tauri/invoke';

interface LibraryRow {
  item: DevItemRow;
  progressByDimension: Map<string, ProgressDto>;
}

/**
 * Sprint 5 library / 词条图鉴 (`#/library`). Lists the items in the user's pack with their
 * mastery state in each skill dimension. Sprint 5+ will add filtering by JLPT / tag / pack;
 * for now it's a flat table.
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

  if (error) {
    return (
      <section style={{ padding: '2rem', maxWidth: '720px', margin: '0 auto' }}>
        <h1>词条图鉴</h1>
        <p style={{ color: 'var(--err)' }}>{error}</p>
      </section>
    );
  }
  if (!items || !progress) {
    return (
      <section style={{ padding: '2rem', maxWidth: '720px', margin: '0 auto' }}>
        <p>Loading…</p>
      </section>
    );
  }

  return (
    <section style={{ padding: '1.5rem', maxWidth: '1100px', margin: '0 auto' }}>
      <h1>词条图鉴</h1>
      <p style={{ color: 'var(--muted)' }}>
        共 {items.length} 个词条；右侧三栏展示主要技能维度的当前掌握度。
      </p>
      <table style={{ marginTop: '1rem' }}>
        <thead>
          <tr>
            <th>id</th>
            <th>surface</th>
            <th>kana</th>
            <th>jlpt</th>
            <th>kanji_reading</th>
            <th>kana_typing</th>
            <th>meaning_recall</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.item.id}>
              <td>
                <code>{r.item.id}</code>
              </td>
              <td>{r.item.surface}</td>
              <td>{r.item.kana}</td>
              <td>{r.item.jlpt ?? '—'}</td>
              <td>
                <MasteryCell p={r.progressByDimension.get('kanji_reading')} />
              </td>
              <td>
                <MasteryCell p={r.progressByDimension.get('kana_typing')} />
              </td>
              <td>
                <MasteryCell p={r.progressByDimension.get('meaning_recall')} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ marginTop: '1.5rem' }}>
        <a href="#/">← 回 home</a>
      </p>
    </section>
  );
}

function MasteryCell({ p }: { p: ProgressDto | undefined }): JSX.Element {
  if (!p) return <span style={{ color: 'var(--muted)' }}>—</span>;
  return (
    <code title={`state=${p.state}, exposures=${p.exposureCount}`}>
      {p.masteryScore.toFixed(0)} ({p.state})
    </code>
  );
}
