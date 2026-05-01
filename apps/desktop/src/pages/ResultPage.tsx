import { useEffect, useState, type JSX } from 'react';

import { ErrorTagChip } from '../features/style/ErrorTagChip';
import { listAttemptsBySession, type AttemptEventRow } from '../tauri/invoke';

export interface ResultPageProps {
  sessionId: string;
}

interface Aggregates {
  total: number;
  correct: number;
  accuracy: number;
  avgReactionMs: number;
  topErrors: Array<{ tag: string; count: number }>;
  slowest: AttemptEventRow[];
}

/**
 * Sprint 3 result page. Reads the immutable attempt log filtered to this session and shows:
 *   - overall accuracy + average reaction time
 *   - top error tags
 *   - the 5 slowest attempts (Sprint 4 will swap this for "5 slowest kana" once the Mole
 *     scene tags attempts with kana metadata)
 *
 * The route `#/result/:sessionId` parses the id from the hash on mount.
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

  if (error) {
    return (
      <section style={{ padding: '2rem', maxWidth: '720px', margin: '0 auto' }}>
        <h1>Result error</h1>
        <p style={{ color: 'var(--err)' }}>{error}</p>
      </section>
    );
  }

  if (!attempts) {
    return (
      <section style={{ padding: '2rem', maxWidth: '720px', margin: '0 auto' }}>
        <p>Loading…</p>
      </section>
    );
  }

  const ag = aggregate(attempts);
  return (
    <section style={{ padding: '1.5rem', maxWidth: '960px', margin: '0 auto' }}>
      <h1>Session result</h1>
      <p style={{ color: 'var(--muted)' }}>session {props.sessionId}</p>

      <section style={{ marginTop: '1.5rem' }}>
        <h2>Overall</h2>
        <ul>
          <li>
            attempts: <code>{ag.total}</code>
          </li>
          <li>
            correct: <code>{ag.correct}</code>
          </li>
          <li>
            accuracy: <code>{ag.accuracy.toFixed(0)}%</code>
          </li>
          <li>
            avg reaction: <code>{ag.avgReactionMs.toFixed(0)} ms</code>
          </li>
        </ul>
      </section>

      <section style={{ marginTop: '1.5rem' }}>
        <h2>Top error tags</h2>
        {ag.topErrors.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>No errors — clean run.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>tag</th>
                <th>count</th>
              </tr>
            </thead>
            <tbody>
              {ag.topErrors.slice(0, 5).map((e) => (
                <tr key={e.tag}>
                  <td>
                    <code>{e.tag}</code>
                  </td>
                  <td>
                    <code>{e.count}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={{ marginTop: '1.5rem' }}>
        <h2>Slowest attempts</h2>
        {ag.slowest.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>No attempts logged.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>item</th>
                <th>correct</th>
                <th>reaction</th>
                <th>tags</th>
              </tr>
            </thead>
            <tbody>
              {ag.slowest.slice(0, 5).map((r) => (
                <tr key={r.id}>
                  <td>
                    <code>{r.itemId}</code>
                  </td>
                  <td style={{ color: r.isCorrect ? 'var(--ok)' : 'var(--err)' }}>
                    <code>{String(r.isCorrect)}</code>
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
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p style={{ marginTop: '1.5rem' }}>
        <a href="#/game/mole">play again</a> · <a href="#/">home</a>
      </p>
    </section>
  );
}

function aggregate(attempts: AttemptEventRow[]): Aggregates {
  const total = attempts.length;
  const correct = attempts.filter((a) => a.isCorrect).length;
  const accuracy = total === 0 ? 0 : (correct / total) * 100;
  const avgReactionMs =
    total === 0 ? 0 : attempts.reduce((sum, a) => sum + a.reactionTimeMs, 0) / total;
  const tagCounts = new Map<string, number>();
  for (const a of attempts) {
    for (const t of a.errorTags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  }
  const topErrors = [...tagCounts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
  const slowest = [...attempts].sort((a, b) => b.reactionTimeMs - a.reactionTimeMs);
  return { total, correct, accuracy, avgReactionMs, topErrors, slowest };
}
