import { useEffect, useMemo, useState, type JSX } from 'react';

import { ErrorTagChip } from '../features/style/ErrorTagChip';
import {
  aggregateRecentErrorTags,
  listRecentAttempts,
  type AttemptEventRow,
  type ErrorTagAggregateRow,
} from '../tauri/invoke';

interface GroupedMistakes {
  tag: string;
  attempts: AttemptEventRow[];
  count: number;
}

/**
 * Sprint 5 mistakes book (`#/mistakes`). Lists recent wrong attempts grouped by error tag.
 * No per-tag drill flow yet (that's Sprint 5+ — wire `pushFront` from a tag-filtered task
 * queue when a future "review this tag" CTA is added). For now the page surfaces enough
 * information for the user to see what they keep getting wrong.
 */
export function MistakesPage(): JSX.Element {
  const [tagAgg, setTagAgg] = useState<ErrorTagAggregateRow[] | null>(null);
  const [recentWrong, setRecentWrong] = useState<AttemptEventRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        const [agg, attempts] = await Promise.all([
          aggregateRecentErrorTags({ userId: 'default-user', days: 30, limit: 30 }),
          // Pull a wider window so per-tag detail lines up with the 30-day aggregate. A
          // proper SQL filter (date range or tag-FTS join) lands in v0.7 once the
          // attempt-event table grows past a few thousand rows.
          listRecentAttempts({ userId: 'default-user', limit: 1000 }),
        ]);
        setTagAgg(agg);
        setRecentWrong(attempts.filter((a) => !a.isCorrect));
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, []);

  const grouped: GroupedMistakes[] = useMemo(() => {
    if (!tagAgg || !recentWrong) return [];
    return tagAgg.map((row) => ({
      tag: row.tag,
      count: row.count,
      attempts: recentWrong.filter((a) => a.errorTags.includes(row.tag)).slice(0, 8),
    }));
  }, [tagAgg, recentWrong]);

  if (error) {
    return (
      <section style={{ padding: '2rem', maxWidth: '720px', margin: '0 auto' }}>
        <h1>错题本</h1>
        <p style={{ color: 'var(--err)' }}>{error}</p>
      </section>
    );
  }
  if (!tagAgg || !recentWrong) {
    return (
      <section style={{ padding: '2rem', maxWidth: '720px', margin: '0 auto' }}>
        <p>Loading…</p>
      </section>
    );
  }

  return (
    <section style={{ padding: '1.5rem', maxWidth: '960px', margin: '0 auto' }}>
      <h1>错题本</h1>
      <p style={{ color: 'var(--muted)' }}>
        近 30 天的错误按错误类型分组。专项训练 CTA 在 v0.7+ 接入。
      </p>

      {grouped.length === 0 ? (
        <p style={{ color: 'var(--muted)', marginTop: '1.5rem' }}>
          没有可显示的错误。先打几局再回来看。
        </p>
      ) : (
        grouped.map((g) => (
          <section key={g.tag} style={{ marginTop: '1.5rem' }}>
            <h2>
              <code>{g.tag}</code> · {g.count} 次
            </h2>
            {g.attempts.length === 0 ? (
              <p style={{ color: 'var(--muted)' }}>
                聚合显示该标签出现 {g.count} 次，但近 200 条记录中未找到对应明细（旧记录已被裁掉）。
              </p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>item</th>
                    <th>mode</th>
                    <th>reaction</th>
                    <th>tags</th>
                    <th>time</th>
                  </tr>
                </thead>
                <tbody>
                  {g.attempts.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <code>{r.itemId}</code>
                      </td>
                      <td>
                        <code>{r.answerMode}</code>
                      </td>
                      <td>
                        <code>{r.reactionTimeMs} ms</code>
                      </td>
                      <td>
                        {r.errorTags.length === 0 ? (
                          <span style={{ color: 'var(--fg-tertiary)' }}>—</span>
                        ) : (
                          <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                            {r.errorTags.map((t) => (
                              <ErrorTagChip key={t} tag={t} />
                            ))}
                          </span>
                        )}
                      </td>
                      <td>
                        <code>{new Date(r.createdAt).toLocaleString()}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        ))
      )}

      <p style={{ marginTop: '1.5rem' }}>
        <a href="#/">← 回 home</a>
      </p>
    </section>
  );
}
