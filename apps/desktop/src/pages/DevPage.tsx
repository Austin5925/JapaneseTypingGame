import { useEffect, useState, type JSX } from 'react';

import { getDbInfo, listItems, seedTestPack, type DbInfo, type DevItemRow } from '../tauri/invoke';

interface AsyncState<T> {
  status: 'idle' | 'loading' | 'ok' | 'error';
  data?: T;
  error?: string;
}

export function DevPage(): JSX.Element {
  const [info, setInfo] = useState<AsyncState<DbInfo>>({ status: 'idle' });
  const [items, setItems] = useState<AsyncState<DevItemRow[]>>({ status: 'idle' });
  const [seedState, setSeedState] = useState<AsyncState<{ packId: string; itemsUpserted: number }>>(
    { status: 'idle' },
  );

  async function refreshInfo(): Promise<void> {
    setInfo({ status: 'loading' });
    try {
      const data = await getDbInfo();
      setInfo({ status: 'ok', data });
    } catch (err) {
      setInfo({ status: 'error', error: (err as Error).message ?? String(err) });
    }
  }

  async function refreshItems(): Promise<void> {
    setItems({ status: 'loading' });
    try {
      const data = await listItems({ limit: 50 });
      setItems({ status: 'ok', data });
    } catch (err) {
      setItems({ status: 'error', error: (err as Error).message ?? String(err) });
    }
  }

  async function onSeed(): Promise<void> {
    setSeedState({ status: 'loading' });
    try {
      const data = await seedTestPack();
      setSeedState({ status: 'ok', data });
      await refreshInfo();
      await refreshItems();
    } catch (err) {
      setSeedState({ status: 'error', error: (err as Error).message ?? String(err) });
    }
  }

  useEffect(() => {
    void refreshInfo();
    void refreshItems();
  }, []);

  return (
    <section style={{ padding: '1.5rem', maxWidth: '960px', margin: '0 auto' }}>
      <h1>Dev Tools</h1>
      <p style={{ color: 'var(--muted)' }}>
        Sprint 0 scaffold smoke test: seed a test content pack into SQLite, then read items back
        through Tauri commands.
      </p>

      <section style={{ marginTop: '1.5rem' }}>
        <h2>Database</h2>
        <button onClick={() => void refreshInfo()} disabled={info.status === 'loading'}>
          Refresh DB info
        </button>
        {info.status === 'error' && <p style={{ color: 'var(--err)' }}>error: {info.error}</p>}
        {info.status === 'ok' && info.data && (
          <ul>
            <li>
              path: <code>{info.data.path}</code>
            </li>
            <li>
              migrations applied: <code>{info.data.appliedMigrations.join(', ') || '(none)'}</code>
            </li>
            <li>
              learning_items count: <code>{String(info.data.itemCount)}</code>
            </li>
          </ul>
        )}
      </section>

      <section style={{ marginTop: '1.5rem' }}>
        <h2>Seed test pack</h2>
        <p style={{ color: 'var(--muted)' }}>
          Loads <code>content/official/n5-basic-mini.json</code> (10 items, embedded at build time).
        </p>
        <button onClick={() => void onSeed()} disabled={seedState.status === 'loading'}>
          Seed
        </button>
        {seedState.status === 'error' && (
          <p style={{ color: 'var(--err)' }}>error: {seedState.error}</p>
        )}
        {seedState.status === 'ok' && seedState.data && (
          <p style={{ color: 'var(--ok)' }}>
            seeded {seedState.data.itemsUpserted} items into pack {seedState.data.packId}
          </p>
        )}
      </section>

      <section style={{ marginTop: '1.5rem' }}>
        <h2>Items in DB</h2>
        <button onClick={() => void refreshItems()} disabled={items.status === 'loading'}>
          Reload
        </button>
        {items.status === 'error' && <p style={{ color: 'var(--err)' }}>error: {items.error}</p>}
        {items.status === 'ok' && items.data && (
          <table>
            <thead>
              <tr>
                <th>id</th>
                <th>surface</th>
                <th>kana</th>
                <th>romaji</th>
                <th>jlpt</th>
              </tr>
            </thead>
            <tbody>
              {items.data.map((it) => (
                <tr key={it.id}>
                  <td>
                    <code>{it.id}</code>
                  </td>
                  <td>{it.surface}</td>
                  <td>{it.kana}</td>
                  <td>{it.romaji.join(' / ')}</td>
                  <td>{it.jlpt ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </section>
  );
}
