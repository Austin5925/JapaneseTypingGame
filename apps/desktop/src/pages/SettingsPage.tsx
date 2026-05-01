import { useEffect, useState, type CSSProperties, type JSX, type ReactNode } from 'react';

import { PixIcon } from '../features/style/PixIcon';
import { getDbInfo, type DbInfo } from '../tauri/invoke';

/**
 * Sprint 5 settings page (`#/settings`), retro-skinned in C8.
 *
 * Two-column layout (180px / 1fr) inside .r-main:
 *   Left  ▌ 分类 — nav list (数据信息 active; 训练参数 / 外观 / 关于 stubbed
 *           and disabled; v0.7+ scope per plan).
 *   Right ▌ 数据信息 — DB path / applied migrations / item count, plus a
 *           link to the dev tools.
 *
 * Real toggles (theme / accent / density / training-time-budget / pack
 * management) land in P1-3 (training preferences) and P0-4 (content packs).
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

  const sections = [
    { id: 'data', label: '数据信息', enabled: true },
    { id: 'packs', label: '内容包', enabled: true, href: '#/settings/packs' },
    { id: 'train', label: '训练参数', enabled: false },
    { id: 'theme', label: '外观皮肤', enabled: false },
    { id: 'about', label: '关于 / 版本', enabled: false },
  ];

  return (
    <div style={pageGrid}>
      <Group title="▌ 分类">
        <div style={{ display: 'flex', flexDirection: 'column', fontSize: 14 }}>
          {sections.map((s, i) => {
            const linkable = s.enabled && 'href' in s && s.href;
            const inner = (
              <div
                className={s.enabled ? 'nav active' : 'nav'}
                style={{
                  padding: '5px 8px',
                  display: 'flex',
                  gap: 6,
                  alignItems: 'center',
                  background:
                    s.id === 'data'
                      ? 'linear-gradient(180deg, #1f4a42 0%, #14342f 100%)'
                      : 'transparent',
                  color:
                    s.id === 'data' ? '#e9fff0' : s.enabled ? 'var(--kt2-fg)' : 'var(--kt2-fg-dim)',
                  border: s.id === 'data' ? '1px solid #2e6e62' : '1px solid transparent',
                  opacity: s.enabled ? 1 : 0.55,
                  cursor: linkable ? 'pointer' : s.enabled ? 'default' : 'not-allowed',
                }}
              >
                {String(i + 1).padStart(2, '0')}. {s.label}
                {linkable && <span style={{ marginLeft: 'auto' }}>→</span>}
              </div>
            );
            if (linkable) {
              return (
                <a key={s.id} href={s.href} style={{ textDecoration: 'none', color: 'inherit' }}>
                  {inner}
                </a>
              );
            }
            return <div key={s.id}>{inner}</div>;
          })}
        </div>
        <div className="r-label" style={{ marginTop: 14 }}>
          其他模块在 v0.7+ 上线
        </div>
      </Group>

      <Group title="▌ 数据信息">
        {error && (
          <div className="kt-banner kt-banner--err" style={{ marginBottom: 12 }}>
            <span className="kt-banner__glyph">!</span>
            <div style={{ fontSize: 13 }}>{error}</div>
          </div>
        )}
        {info ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <InfoRow label="数据库路径">
              <code className="kt-mono" style={{ fontSize: 12, color: 'var(--kt2-fg-bright)' }}>
                {info.path}
              </code>
            </InfoRow>
            <InfoRow label="已应用迁移">
              <span className="kt-mono" style={{ fontSize: 12, color: 'var(--kt2-accent)' }}>
                {info.appliedMigrations.length} 项 ·{' '}
                <span style={{ color: 'var(--kt2-fg-dim)' }}>
                  {info.appliedMigrations.join(', ')}
                </span>
              </span>
            </InfoRow>
            <InfoRow label="词条数量">
              <span
                style={{
                  fontFamily: 'var(--pix-display)',
                  fontSize: 18,
                  color: 'var(--kt2-accent)',
                  textShadow: '0 0 6px var(--kt2-accent)',
                }}
              >
                {info.itemCount}
              </span>
            </InfoRow>
          </div>
        ) : (
          !error && <div style={{ color: 'var(--kt2-fg-dim)' }}>读取数据库信息中...</div>
        )}

        <div className="kt-pix-divider" style={{ margin: '20px 0 16px' }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <a href="#/dev" className="r-btn" style={{ textDecoration: 'none' }}>
            <PixIcon name="save" /> 开发者工具
          </a>
          <a href="#/" className="r-btn" style={{ textDecoration: 'none' }}>
            <PixIcon name="home" /> 回首页
          </a>
        </div>
      </Group>
    </div>
  );
}

const pageGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '180px 1fr',
  gap: 10,
  padding: 10,
  height: '100%',
};

function Group({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div className="r-group">
      <div className="title">{title}</div>
      {children}
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div
      style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12, alignItems: 'baseline' }}
    >
      <span className="r-label" style={{ fontSize: 8 }}>
        {label}
      </span>
      <div>{children}</div>
    </div>
  );
}
