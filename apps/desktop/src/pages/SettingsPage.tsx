import { useEffect, useState, type CSSProperties, type JSX, type ReactNode } from 'react';

import {
  readMoleDifficultyPreference,
  writeMoleDifficultyPreference,
} from '../features/preferences';
import { PixIcon } from '../features/style/PixIcon';
import { APP_VERSION } from '../features/version';
import { getDbInfo, type DbInfo } from '../tauri/invoke';

import type { MoleDifficulty } from './GamePage';

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
            // Layout-only inline style; visual state (active vs hover) lives on the
            // `.nav` / `.nav.active` CSS so retro.css's light-theme overrides apply.
            const itemStyle: CSSProperties = {
              padding: '5px 8px',
              display: 'flex',
              gap: 6,
              alignItems: 'center',
              width: '100%',
              textAlign: 'left',
              cursor: 'pointer',
              border: '1px solid transparent',
            };
            const className = `nav${isActive ? ' active' : ''}`;
            if (s.href) {
              return (
                <a key={s.id} href={s.href} style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div className={className} style={itemStyle}>
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
                className={className}
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
      <InfoRow label="鼹鼠的故事">
        <span>会话 60 秒 · 单题 6 秒 · 看汉字打 romaji。</span>
      </InfoRow>
      <InfoRow label="生死时速">
        <span>会话最长 80 秒(被追上 / 抵达终点都会提前结束)· 真实 IME 输入。</span>
      </InfoRow>
      <InfoRow label="激流勇进">
        <span>会话 90 秒 · 单题 18 秒 · 拖拽 chunk 拼出语序。</span>
      </InfoRow>
      <InfoRow label="太空大战">
        <span>会话 60 秒 · 单题 6 秒 · 14 题 · 4 选 1 同音 / 近形辨析。</span>
      </InfoRow>
      <InfoRow label="拯救苹果">
        <span>会话 60 秒 · 单题 6 秒 · 听 TTS 选 kana,长音 / 促音 / 浊音辨别。</span>
      </InfoRow>
      <InfoRow label="Boss 关">
        <span>会话 180 秒 · 3 段 × 4 题混合关,combo 跨段共享。</span>
      </InfoRow>
      <InfoRow label="鼹鼠难度">
        <MoleDifficultyChooser />
      </InfoRow>
    </div>
  );
}

const MOLE_DIFFICULTY_OPTIONS: Array<{ value: MoleDifficulty; label: string }> = [
  { value: 'easy', label: '简单 · 8.0s' },
  { value: 'normal', label: '普通 · 6.0s' },
  { value: 'hard', label: '困难 · 4.5s' },
];

function MoleDifficultyChooser(): JSX.Element {
  // v0.9.2: 这里只保存偏好,不再跳转到游戏。点击后立即写 localStorage,下次进入鼹鼠
  // (从首页 / nav / 直接 #/game/mole)无 url override 时会读这里的值。
  const [chosen, setChosen] = useState<MoleDifficulty>(
    () => readMoleDifficultyPreference() ?? 'normal',
  );
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      {MOLE_DIFFICULTY_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`r-btn${chosen === opt.value ? ' primary' : ''}`}
          onClick={() => {
            writeMoleDifficultyPreference(opt.value);
            setChosen(opt.value);
          }}
          aria-pressed={chosen === opt.value}
        >
          {opt.label}
        </button>
      ))}
      <span className="r-label" style={{ fontSize: 8, marginLeft: 4 }}>
        点击保存,下次进入鼹鼠自动套用
      </span>
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
        <span style={{ lineHeight: 1.6 }}>
          假名打字通是一款<strong>日语输入反射训练器</strong>,目标用户是已经学过五十音、 正在攻
          N5–N2 的中文母语日语学习者。它不教你认识假名,而是把"我认识这个词"推进到 "我能快速打出来 /
          听出来 / 用出来"——通过 5 个反应类小游戏 + 学习模式卡片 + 错题回流形成闭环。
        </span>
      </InfoRow>
      <InfoRow label="架构">
        <span style={{ lineHeight: 1.6 }}>
          Tauri v2 桌面壳 + Vite + React 19 前端 + Phaser 3 游戏 scene + 本地 SQLite (better-sqlite3
          / rusqlite)持久化。完全离线,无后端账号,数据存在本机
          <code className="kt-mono" style={{ marginLeft: 4, color: 'var(--kt2-fg-bright)' }}>
            local-data/kana_typing.sqlite
          </code>
          。
        </span>
      </InfoRow>
      <InfoRow label="发布">
        <span style={{ lineHeight: 1.6 }}>
          0.x 试错阶段,版本号紧密跟随每一批可玩功能;1.0 会在桌面 MVP 判定可分发时发出。 源码托管在{' '}
          <code className="kt-mono">Austin5925/JapaneseTypingGame</code>, public 仓库,CI 跑全栈 gate
          (typecheck / lint / format / test / build / cargo fmt / clippy / test)。当前 Tauri bundle
          与仓库 tag 同步在
          <span className="kt-mono" style={{ marginLeft: 4, color: 'var(--kt2-accent)' }}>
            v{APP_VERSION}
          </span>
          。
        </span>
      </InfoRow>
      <InfoRow label="致谢">
        <span style={{ lineHeight: 1.6 }}>
          内容包基于公开 JLPT 词汇大纲 + 母语者审订;判题用 wanakana 做 romaji ↔ kana
          round-trip;打字反馈使用 Web Audio API 合成的 8-bit 风格 SFX。
        </span>
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
