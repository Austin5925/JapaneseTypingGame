import { useEffect, useState, type CSSProperties, type JSX, type ReactNode } from 'react';

import { PixIcon } from '../features/style/PixIcon';
import { APP_VERSION } from '../features/version';
import { getDbInfo, type DbInfo } from '../tauri/invoke';

type SettingsSectionId = 'data' | 'packs' | 'train' | 'theme' | 'about';
type ThemeChoice = 'dark' | 'light';

const THEME_STORAGE_KEY = 'kana-type-theme';

const sections: Array<{ id: SettingsSectionId; label: string; href?: string }> = [
  { id: 'data', label: '数据信息' },
  { id: 'packs', label: '内容包', href: '#/settings/packs' },
  { id: 'train', label: '训练参数' },
  { id: 'theme', label: '外观皮肤' },
  { id: 'about', label: '关于 / 版本' },
];

/**
 * Settings page (`#/settings`), retro-skinned in C8.
 *
 * v0.8.9 turned the previously disabled sections into usable panels. Content pack
 * management still owns its dedicated route because it has its own table workflow.
 */
export function SettingsPage(): JSX.Element {
  const [active, setActive] = useState<SettingsSectionId>('data');
  const [theme, setTheme] = useState<ThemeChoice>(readThemeChoice);
  const [info, setInfo] = useState<DbInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    globalThis.document?.documentElement.setAttribute('data-theme', theme);
    globalThis.localStorage?.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

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
    <div style={pageGrid}>
      <Group title="▌ 分类">
        <div style={{ display: 'flex', flexDirection: 'column', fontSize: 14 }}>
          {sections.map((s, i) => {
            const isActive = active === s.id;
            const itemStyle: CSSProperties = {
              padding: '5px 8px',
              display: 'flex',
              gap: 6,
              alignItems: 'center',
              width: '100%',
              textAlign: 'left',
              background: isActive
                ? 'linear-gradient(180deg, #1f4a42 0%, #14342f 100%)'
                : 'transparent',
              color: isActive ? '#e9fff0' : 'var(--kt2-fg)',
              border: isActive ? '1px solid #2e6e62' : '1px solid transparent',
              cursor: 'pointer',
            };
            if (s.href) {
              return (
                <a key={s.id} href={s.href} style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div className="nav" style={itemStyle}>
                    {String(i + 1).padStart(2, '0')}. {s.label}
                    <span style={{ marginLeft: 'auto' }}>→</span>
                  </div>
                </a>
              );
            }
            return (
              <button
                key={s.id}
                type="button"
                className="nav"
                onClick={() => setActive(s.id)}
                style={itemStyle}
              >
                {String(i + 1).padStart(2, '0')}. {s.label}
              </button>
            );
          })}
        </div>
        <div className="r-label" style={{ marginTop: 14 }}>
          所有设置板块已开放
        </div>
      </Group>

      <Group title={`▌ ${sectionTitle(active)}`}>
        {active === 'data' ? <DataSettings info={info} error={error} /> : null}
        {active === 'train' ? <TrainingSettings /> : null}
        {active === 'theme' ? <ThemeSettings theme={theme} onChange={setTheme} /> : null}
        {active === 'about' ? <AboutSettings /> : null}

        <div className="kt-pix-divider" style={{ margin: '20px 0 16px' }} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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

function DataSettings({ info, error }: { info: DbInfo | null; error: string | null }): JSX.Element {
  if (error) {
    return (
      <div className="kt-banner kt-banner--err" style={{ marginBottom: 12 }}>
        <span className="kt-banner__glyph">!</span>
        <div style={{ fontSize: 13 }}>{error}</div>
      </div>
    );
  }

  if (!info) {
    return <div style={{ color: 'var(--kt2-fg-dim)' }}>读取数据库信息中...</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <InfoRow label="数据库路径">
        <code className="kt-mono" style={{ fontSize: 12, color: 'var(--kt2-fg-bright)' }}>
          {info.path}
        </code>
      </InfoRow>
      <InfoRow label="已应用迁移">
        <span className="kt-mono" style={{ fontSize: 12, color: 'var(--kt2-accent)' }}>
          {info.appliedMigrations.length} 项 ·{' '}
          <span style={{ color: 'var(--kt2-fg-dim)' }}>{info.appliedMigrations.join(', ')}</span>
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
  );
}

function TrainingSettings(): JSX.Element {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <InfoRow label="标准局">
        <span>鼹鼠 / 生死时速 / 激流勇进 / 太空大战 / 拯救苹果均为 60 秒。</span>
      </InfoRow>
      <InfoRow label="Boss 关">
        <span>Boss 关为 90 秒，并按最近弱项自动切换段落。</span>
      </InfoRow>
      <InfoRow label="鼹鼠难度">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a
            className="r-btn"
            href="#/game/mole?difficulty=easy"
            style={{ textDecoration: 'none' }}
          >
            简单 · 8.0s
          </a>
          <a
            className="r-btn"
            href="#/game/mole?difficulty=normal"
            style={{ textDecoration: 'none' }}
          >
            普通 · 6.0s
          </a>
          <a
            className="r-btn"
            href="#/game/mole?difficulty=hard"
            style={{ textDecoration: 'none' }}
          >
            困难 · 4.5s
          </a>
        </div>
      </InfoRow>
    </div>
  );
}

function ThemeSettings({
  theme,
  onChange,
}: {
  theme: ThemeChoice;
  onChange: (theme: ThemeChoice) => void;
}): JSX.Element {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <InfoRow label="主题">
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className={theme === 'dark' ? 'r-btn primary' : 'r-btn'}
            onClick={() => onChange('dark')}
          >
            夜间 CRT
          </button>
          <button
            type="button"
            className={theme === 'light' ? 'r-btn primary' : 'r-btn'}
            onClick={() => onChange('light')}
          >
            明亮纸面
          </button>
        </div>
      </InfoRow>
      <InfoRow label="保存位置">
        <code className="kt-mono" style={{ fontSize: 12, color: 'var(--kt2-fg-bright)' }}>
          localStorage:{THEME_STORAGE_KEY}
        </code>
      </InfoRow>
    </div>
  );
}

function AboutSettings(): JSX.Element {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <InfoRow label="版本">
        <span className="kt-mono" style={{ color: 'var(--kt2-accent)' }}>
          v{APP_VERSION}
        </span>
      </InfoRow>
      <InfoRow label="定位">
        <span>日语输入反射训练器，桌面端优先，离线 SQLite 学习闭环。</span>
      </InfoRow>
      <InfoRow label="发布">
        <span>public repo release metadata 与 Tauri bundle 同步到 v{APP_VERSION}。</span>
      </InfoRow>
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

function sectionTitle(section: SettingsSectionId): string {
  switch (section) {
    case 'data':
      return '数据信息';
    case 'packs':
      return '内容包';
    case 'train':
      return '训练参数';
    case 'theme':
      return '外观皮肤';
    case 'about':
      return '关于 / 版本';
  }
}

function readThemeChoice(): ThemeChoice {
  const saved = globalThis.localStorage?.getItem(THEME_STORAGE_KEY);
  return saved === 'light' ? 'light' : 'dark';
}
