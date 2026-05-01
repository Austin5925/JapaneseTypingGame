import { useEffect, useState, type CSSProperties, type JSX, type ReactNode } from 'react';

import { PixIcon } from '../features/style/PixIcon';
import { listContentPacks, setPackEnabled, type ContentPackRow } from '../tauri/invoke';

/**
 * v0.7 P0-4 · `#/settings/packs`. Lists every imported content pack with
 * its quality / version / item count / enabled state, lets the user
 * toggle enabled, and points to the CLI for new imports.
 *
 * In-app file-picker import is intentionally deferred to v0.7.x — wiring
 * the Tauri `dialog` plugin + capabilities + Zod boundary validation is
 * a separate sprint. The `pnpm content:import` CLI is the day-1 import
 * path; this page is the day-1 management UI.
 */
export function ContentPacksPage(): JSX.Element {
  const [packs, setPacks] = useState<ContentPackRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load(): Promise<void> {
    try {
      setPacks(await listContentPacks());
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function toggle(pack: ContentPackRow): Promise<void> {
    if (pendingId) return;
    setPendingId(pack.id);
    try {
      await setPackEnabled({ packId: pack.id, enabled: !pack.enabled });
      // Refetch instead of optimistic update — keeps display in sync with
      // any DB-side trigger / future cascade.
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPendingId(null);
    }
  }

  if (error) return <ErrorPanel message={error} />;
  if (!packs) return <LoadingPanel />;

  const totalItems = packs.reduce((sum, p) => sum + p.itemCount, 0);
  const enabledCount = packs.filter((p) => p.enabled).length;

  return (
    <div style={pageGrid}>
      <Group title={`▌ 内容包管理 · ${packs.length} 个 · ${totalItems} 词`}>
        <div
          style={{
            fontSize: 13,
            color: 'var(--kt2-fg-dim)',
            lineHeight: 1.5,
            marginBottom: 14,
          }}
        >
          » 当前启用 <span style={{ color: 'var(--kt2-accent)' }}>{enabledCount}</span> /{' '}
          {packs.length} 个包
          <br />» 导入新包目前用 CLI:
          <code className="kt-mono" style={{ marginLeft: 4 }}>
            pnpm content:import &lt;file.json&gt;
          </code>
          <br />» 应用内 file-picker 导入 (P0-4 增强) 留 v0.7.x
        </div>

        {packs.length === 0 ? (
          <div
            style={{
              padding: 20,
              textAlign: 'center',
              color: 'var(--kt2-fg-dim)',
              fontSize: 13,
            }}
          >
            » 还没有任何内容包
            <br />» 用 <code className="kt-mono">pnpm content:import</code> 导入 JSON pack
          </div>
        ) : (
          <div
            className="r-sink"
            style={{ background: 'var(--kt2-sunken)', overflow: 'auto', flex: 1 }}
          >
            <table className="r-list">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>启用</th>
                  <th>包名 / id</th>
                  <th style={{ width: 80 }}>版本</th>
                  <th style={{ width: 80, textAlign: 'right' }}>词数</th>
                  <th style={{ width: 100 }}>quality</th>
                  <th style={{ width: 130 }}>导入时间</th>
                </tr>
              </thead>
              <tbody>
                {packs.map((p) => (
                  <tr key={p.id} className="zebra">
                    <td>
                      <button
                        type="button"
                        onClick={() => void toggle(p)}
                        disabled={pendingId === p.id}
                        title={p.enabled ? '点击禁用' : '点击启用'}
                        style={{
                          all: 'unset',
                          cursor: pendingId === p.id ? 'progress' : 'pointer',
                          padding: 2,
                          display: 'inline-flex',
                          alignItems: 'center',
                        }}
                      >
                        <span className={`r-chk ${p.enabled ? 'on' : ''}`} />
                      </button>
                    </td>
                    <td>
                      <div style={{ color: 'var(--kt2-fg-bright)', fontSize: 14 }}>{p.name}</div>
                      <div
                        className="kt-mono"
                        style={{
                          fontSize: 11,
                          color: 'var(--kt2-fg-dim)',
                          marginTop: 2,
                        }}
                      >
                        {p.id}
                      </div>
                    </td>
                    <td className="kt-mono" style={{ fontSize: 12 }}>
                      {p.version}
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        fontFamily: 'var(--pix-display)',
                        fontSize: 9,
                        color: 'var(--kt2-accent)',
                      }}
                    >
                      {p.itemCount}
                    </td>
                    <td>
                      <span className="r-tag" style={{ color: qualityColor(p.quality) }}>
                        {p.quality}
                      </span>
                    </td>
                    <td
                      style={{
                        fontSize: 11,
                        color: 'var(--kt2-fg-dim)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {formatDate(p.importedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="r-btn"
            onClick={() => void load()}
            disabled={pendingId !== null}
          >
            <PixIcon name="save" /> 刷新
          </button>
          <a href="#/settings" className="r-btn" style={{ textDecoration: 'none' }}>
            ← 回设置
          </a>
        </div>
      </Group>
    </div>
  );
}

function qualityColor(q: string): string {
  switch (q) {
    case 'official':
      return 'var(--kt2-accent)';
    case 'verified':
      return 'var(--kt2-link)';
    case 'user_imported':
      return 'var(--kt2-accent-2)';
    case 'needs_review':
      return 'var(--kt2-danger)';
    default:
      return 'var(--kt2-fg-dim)';
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(
    d.getHours(),
  ).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
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
      <Group title="▌ 内容包管理">
        <div style={{ color: 'var(--kt2-fg-dim)' }}>读取已导入包...</div>
      </Group>
    </div>
  );
}

function ErrorPanel({ message }: { message: string }): JSX.Element {
  return (
    <div style={pageGrid}>
      <Group title="▌ ERR · 内容包">
        <div className="kt-banner kt-banner--err">
          <span className="kt-banner__glyph">!</span>
          <div style={{ fontSize: 13 }}>{message}</div>
        </div>
      </Group>
    </div>
  );
}
