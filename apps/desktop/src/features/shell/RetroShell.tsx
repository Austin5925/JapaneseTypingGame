import { useEffect, useState, type JSX, type ReactNode } from 'react';

import { PixIcon, type PixIconName } from '../style/PixIcon';

/**
 * Stable union of "where are we" identifiers the shell uses to highlight the
 * sidebar. App.tsx maps the hash route to one of these.
 */
export type RetroActiveKey =
  | 'home'
  | 'today'
  | 'mistakes'
  | 'library'
  | 'settings'
  | 'settings-packs'
  | 'diagnostic'
  | 'game-mole'
  | 'game-speed-chase'
  | 'result'
  | 'dev'
  | 'dev-input'
  | 'dev-eval';

interface NavItem {
  key: RetroActiveKey;
  label: string;
  href: string;
  icon: PixIconName;
  badge?: string;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: '训练',
    items: [
      { key: 'home', label: '首页', href: '#/', icon: 'home' },
      { key: 'today', label: '今日训练', href: '#/today', icon: 'today' },
      { key: 'game-mole', label: '鼹鼠的故事', href: '#/game/mole', icon: 'mole' },
      { key: 'game-speed-chase', label: '生死时速', href: '#/game/speed-chase', icon: 'bolt' },
      { key: 'diagnostic', label: '水平测评', href: '#/diagnostic', icon: 'target' },
    ],
  },
  {
    title: '学习',
    items: [
      { key: 'mistakes', label: '错题本', href: '#/mistakes', icon: 'mistakes' },
      { key: 'library', label: '题库', href: '#/library', icon: 'library' },
    ],
  },
  {
    title: '系统',
    items: [{ key: 'settings', label: '设置', href: '#/settings', icon: 'settings' }],
  },
];

export interface RetroShellProps {
  active: RetroActiveKey | null;
  /** Title shown in the toolbar's tb-label slot, e.g. `C:\\KANA\\HOME`. */
  title?: string;
  /** Right-most status bar segment (keyboard hints / scene status). */
  status?: string;
  children: ReactNode;
}

/**
 * 金山-style admin shell — the chrome around every page.
 *
 * Structure (see retro.css `.r-app` for the 5-row grid):
 *   titlebar (22px)  → product name + decorative window controls
 *   menubar  (28px)  → 文件 / 编辑 / 视图 / 训练 / 帮助 (cosmetic — no real menus)
 *   toolbar  (32px)  → action icons + breadcrumb tb-label + streak/today
 *   sidebar  (200px) | main (1fr)
 *   statusbar (22px) → ready / version / dev links / lang / clock
 *
 * Visual fidelity targets devdocs/design-handoff/retro-shell.jsx::RetroShell.
 * The PixIcon glyphs are stubbed (see PixIcon) until C5 ships the real
 * SVG component.
 */
export function RetroShell(props: RetroShellProps): JSX.Element {
  const { active, title, status, children } = props;
  const clock = useTickingClock();

  return (
    <div className="r-app">
      <div className="r-titlebar">
        <span>KANA-TYPE.EXE — 假名打字通 v0.7.0 [离线模式]</span>
        <div className="icons">
          <span>_</span>
          <span>□</span>
          <span>×</span>
        </div>
      </div>

      <div className="r-menubar">
        {[
          ['F', '文件'],
          ['E', '编辑'],
          ['V', '视图'],
          ['T', '训练'],
          ['H', '帮助'],
        ].map(([k, n]) => (
          <span key={n} className="item">
            <u>{k}</u>
            {n!.slice(1)}
          </span>
        ))}
        <span style={{ marginLeft: 'auto' }} className="item">
          [F1] 帮助
        </span>
      </div>

      <div className="r-toolbar">
        <span className="tb-btn r-raise">
          <PixIcon name="play" />
        </span>
        <span className="tb-btn r-raise">
          <PixIcon name="pause" />
        </span>
        <span className="tb-sep" />
        <span className="tb-btn r-raise">
          <PixIcon name="save" />
        </span>
        <span className="tb-btn r-raise">
          <PixIcon name="chart" />
        </span>
        <span className="tb-sep" />
        <span className="tb-btn r-raise">
          <PixIcon name="mistakes" />
        </span>
        <span className="tb-btn r-raise">
          <PixIcon name="library" />
        </span>
        <span className="tb-sep" />
        <span className="tb-label">{title ?? '工作台'}</span>
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            paddingRight: 4,
          }}
        >
          <span className="tb-label" style={{ color: 'var(--kt2-accent)' }}>
            ● 离线模式
          </span>
        </div>
      </div>

      <aside className="r-sidebar r-sink" style={{ gridRow: '4 / 5' }}>
        {NAV_GROUPS.map((group) => (
          <div className="grp" key={group.title}>
            <div className="grp-title">{group.title}</div>
            {group.items.map((item) => (
              <a
                key={item.key}
                href={item.href}
                className={`nav ${active === item.key ? 'active' : ''}`}
                style={{ textDecoration: 'none' }}
              >
                <PixIcon name={item.icon} />
                <span>{item.label}</span>
                {item.badge !== undefined && <span className="badge">{item.badge}</span>}
              </a>
            ))}
          </div>
        ))}
      </aside>

      <main className="r-main r-grid" style={{ gridRow: '4 / 5', overflow: 'auto' }}>
        {children}
      </main>

      <footer className="r-statusbar">
        <span className="seg">就绪</span>
        <span className="seg">v0.7.0 · master</span>
        <span className="grow" />
        <span className="seg">
          <a href="#/dev" style={{ color: 'inherit' }}>
            dev
          </a>
        </span>
        <span className="seg">
          <a href="#/dev/input" style={{ color: 'inherit' }}>
            dev/input
          </a>
        </span>
        <span className="seg">
          <a href="#/dev/eval" style={{ color: 'inherit' }}>
            dev/eval
          </a>
        </span>
        <span className="seg">{status ?? 'F1=帮助 Esc=退出'}</span>
        <span className="seg">JP</span>
        <span className="seg">{clock}</span>
      </footer>
    </div>
  );
}

function useTickingClock(): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = globalThis.setInterval(() => setNow(Date.now()), 1000);
    return () => globalThis.clearInterval(id);
  }, []);
  const d = new Date(now);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
