import { useEffect, useState, type JSX } from 'react';

import { getDbInfo, type DbInfo } from '../tauri/invoke';

/**
 * Sprint 5 settings page (`#/settings`). Minimal placeholder — content-pack management,
 * input-method preference, and training-time-budget controls land in v0.7+. For now we
 * surface the DB path so users know where their data lives, and link to the dev tools.
 */
export function SettingsPage(): JSX.Element {
  const [info, setInfo] = useState<DbInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        setInfo(await getDbInfo());
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, []);

  return (
    <section style={{ padding: '1.5rem', maxWidth: '720px', margin: '0 auto' }}>
      <h1>设置</h1>
      {error && <p style={{ color: 'var(--err)' }}>{error}</p>}
      {info && (
        <ul>
          <li>
            数据库路径：<code>{info.path}</code>
          </li>
          <li>
            已应用迁移：<code>{info.appliedMigrations.join(', ')}</code>
          </li>
          <li>
            词条数量：<code>{info.itemCount}</code>
          </li>
        </ul>
      )}
      <p style={{ color: 'var(--muted)', marginTop: '1.5rem' }}>
        内容包管理、输入法偏好、训练时长设置在 v0.7+ 上线。
      </p>
      <p>
        <a href="#/dev">→ 开发者工具</a>
      </p>
      <p>
        <a href="#/">← 回 home</a>
      </p>
    </section>
  );
}
