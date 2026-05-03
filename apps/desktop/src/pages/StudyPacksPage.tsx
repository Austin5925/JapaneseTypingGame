import { useEffect, useState, type CSSProperties, type JSX, type ReactNode } from 'react';

import { PixIcon } from '../features/style/PixIcon';
import { listStudyPacks, type StudyPackSummary } from '../tauri/invoke';

const USER_ID = 'default-user';

/**
 * v0.9.0 Study mode entry — list all enabled content packs with study progress, and let the
 * user enter the card view in either "继续学习" (all) or "复习已学" (reviewed) mode.
 */
export function StudyPacksPage(): JSX.Element {
  const [packs, setPacks] = useState<StudyPackSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        const rows = await listStudyPacks(USER_ID);
        // Sort: most "still to learn" on top, so the user has a natural next-up.
        rows.sort((a, b) => b.totalCount - b.studiedCount - (a.totalCount - a.studiedCount));
        setPacks(rows);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  if (error) return <ErrorPanel message={error} />;
  if (!packs) return <LoadingPanel />;
  if (packs.length === 0) return <EmptyPanel />;

  return (
    <div style={pageGrid}>
      <Group title="▌ 学习模式 · 选择词包">
        <div
          style={{ fontSize: 14, color: 'var(--kt2-fg-dim)', lineHeight: 1.6, marginBottom: 12 }}
        >
          » 在玩游戏前先在这里浏览每个词条的意思与例句。学习不计时、不评分。
          <br />» 翻页时进度自动保存,下次回到同一个词包会从上次离开的位置继续。
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {packs.map((p) => (
            <PackRow key={p.packId} pack={p} />
          ))}
        </div>
      </Group>
    </div>
  );
}

function PackRow({ pack }: { pack: StudyPackSummary }): JSX.Element {
  const remaining = Math.max(0, pack.totalCount - pack.studiedCount);
  const pct = pack.totalCount > 0 ? (pack.studiedCount / pack.totalCount) * 100 : 0;
  const continueLabel = pack.studiedCount === 0 ? '从头学' : `继续学习(还剩 ${remaining})`;

  return (
    <div className="r-raise" style={{ padding: 12, background: 'var(--kt2-panel-2)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 6,
          gap: 12,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: 'var(--pix-display)',
              fontSize: 13,
              color: 'var(--kt2-fg-bright)',
              letterSpacing: '0.04em',
            }}
          >
            {pack.name}
          </div>
          <div className="r-label" style={{ fontSize: 7, marginTop: 2 }}>
            {pack.packId}
          </div>
        </div>
        <div
          style={{
            fontFamily: 'var(--pix-display)',
            fontSize: 14,
            color: 'var(--kt2-accent)',
          }}
        >
          {pack.studiedCount} / {pack.totalCount}
        </div>
      </div>

      {pack.description && (
        <div
          style={{
            fontSize: 13,
            color: 'var(--kt2-fg-dim)',
            lineHeight: 1.5,
            marginBottom: 8,
          }}
        >
          {pack.description}
        </div>
      )}

      <div className="r-progress" style={{ height: 10, marginBottom: 8 }}>
        <div
          className="fill"
          style={{
            width: `${Math.max(pct, 1)}%`,
            background:
              pct >= 100
                ? 'repeating-linear-gradient(90deg,#7ee787 0,#7ee787 6px,#5fc870 6px,#5fc870 8px)'
                : 'repeating-linear-gradient(90deg,#6cb9ff 0,#6cb9ff 6px,#3a7fcc 6px,#3a7fcc 8px)',
          }}
        />
      </div>

      {pack.jlptBreakdown.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            flexWrap: 'wrap',
            marginBottom: 10,
            fontSize: 12,
            color: 'var(--kt2-fg-dim)',
          }}
        >
          {pack.jlptBreakdown.map(([jlpt, count]) => (
            <span
              key={jlpt}
              style={{
                padding: '2px 6px',
                background: 'var(--kt2-sunken)',
                borderRadius: 2,
                fontFamily: 'var(--pix-font)',
              }}
            >
              {jlpt} × {count}
            </span>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <a
          href={`#/study?pack=${encodeURIComponent(pack.packId)}`}
          className="r-btn primary"
          style={{ textDecoration: 'none' }}
        >
          <PixIcon name="play" /> {continueLabel}
        </a>
        <a
          href={`#/study?pack=${encodeURIComponent(pack.packId)}&mode=reviewed`}
          className="r-btn"
          style={{
            textDecoration: 'none',
            opacity: pack.studiedCount === 0 ? 0.5 : 1,
            pointerEvents: pack.studiedCount === 0 ? 'none' : 'auto',
          }}
        >
          <PixIcon name="library" /> 复习已学({pack.studiedCount})
        </a>
      </div>
    </div>
  );
}

const pageGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr',
  gap: 10,
  padding: 10,
  height: '100%',
  overflow: 'auto',
};

function Group({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div className="r-group">
      <div className="title">{title}</div>
      {children}
    </div>
  );
}

function LoadingPanel(): JSX.Element {
  return (
    <div style={pageGrid}>
      <Group title="▌ 学习模式">
        <div style={{ color: 'var(--kt2-fg-dim)' }}>读取词包中...</div>
      </Group>
    </div>
  );
}

function EmptyPanel(): JSX.Element {
  return (
    <div style={pageGrid}>
      <Group title="▌ 学习模式 · 没有可学的词包">
        <div style={{ fontSize: 14, color: 'var(--kt2-fg-dim)', lineHeight: 1.6 }}>
          数据库里没有 enabled 的内容包。先去{' '}
          <a href="#/dev" className="kt-link">
            dev
          </a>{' '}
          页面 seed 一份,或检查{' '}
          <a href="#/settings/packs" className="kt-link">
            设置 → 词包
          </a>
          。
        </div>
      </Group>
    </div>
  );
}

function ErrorPanel({ message }: { message: string }): JSX.Element {
  return (
    <div style={pageGrid}>
      <Group title="▌ ERR · 读取失败">
        <div className="kt-banner kt-banner--err">
          <span className="kt-banner__glyph">!</span>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>无法获取学习词包</div>
            <div style={{ fontSize: 13, opacity: 0.9 }}>{message}</div>
          </div>
        </div>
      </Group>
    </div>
  );
}
