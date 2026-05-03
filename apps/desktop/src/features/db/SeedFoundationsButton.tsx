import { useState, type JSX } from 'react';

import { seedTestPack } from '../../tauri/invoke';

export function SeedFoundationsButton(): JSX.Element {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSeed = async (): Promise<void> => {
    setBusy(true);
    setStatus('正在写入 foundations packs...');
    try {
      const result = await seedTestPack();
      setStatus(`已写入 ${String(result.itemsUpserted)} 条,重新载入...`);
      globalThis.location.reload();
    } catch (err) {
      setStatus(`seed 失败: ${(err as Error).message}`);
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
      <button
        className="r-btn primary"
        type="button"
        onClick={() => void handleSeed()}
        disabled={busy}
      >
        ▶ 立即 seed 全部 foundations 包
      </button>
      {status ? (
        <div
          style={{
            fontFamily: 'var(--pix-font)',
            fontSize: 12,
            color: status.startsWith('seed 失败') ? 'var(--kt2-danger)' : 'var(--kt2-fg-dim)',
          }}
        >
          {status}
        </div>
      ) : null}
    </div>
  );
}
