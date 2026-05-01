import { describe, expect, it, vi } from 'vitest';

// Mock the Tauri invoke layer so we can run GameSessionService against an
// in-memory fake. The hoisted vi.fn() handles each accept their own override
// per test via `mockImplementationOnce` / `mockResolvedValueOnce`.
const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  finishSession: vi.fn(),
  getProgress: vi.fn(),
  recordAttemptResult: vi.fn(),
}));
vi.mock('../../tauri/invoke', () => ({
  createSession: mocks.createSession,
  finishSession: mocks.finishSession,
  getProgress: mocks.getProgress,
  recordAttemptResult: mocks.recordAttemptResult,
}));

import { GameSessionService } from './GameSessionService';

function makeService(): GameSessionService {
  mocks.createSession.mockReset();
  mocks.finishSession.mockReset();
  mocks.getProgress.mockReset();
  mocks.recordAttemptResult.mockReset();
  mocks.createSession.mockImplementation((input: { id: string }) =>
    Promise.resolve({
      id: input.id,
      userId: 'default-user',
      gameType: 'mole_story',
      targetDurationMs: 60_000,
      status: 'open',
      startedAt: new Date().toISOString(),
      finishedAt: null,
    }),
  );
  mocks.finishSession.mockResolvedValue(undefined);
  return new GameSessionService();
}

describe('GameSessionService.finish idempotency', () => {
  it('is a noop on a session that is already finished', async () => {
    const svc = makeService();
    await svc.create({ gameType: 'mole_story' });
    await svc.finish('finished');
    expect(mocks.finishSession).toHaveBeenCalledTimes(1);

    await svc.finish('finished');
    expect(mocks.finishSession).toHaveBeenCalledTimes(1); // not called again
  });

  it('does not double-fire the RPC for concurrent finish() calls', async () => {
    // Both this idempotency guard and the GamePage timer/scene-finished bridge can race —
    // protect against a second finish() entering while the first is still mid-await.
    const svc = makeService();
    await svc.create({ gameType: 'mole_story' });

    let resolveRpc: (() => void) | undefined;
    mocks.finishSession.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRpc = resolve;
        }),
    );

    const a = svc.finish('finished');
    const b = svc.finish('finished');
    // Let the second call's microtask run; it should have hit the `finishing` guard
    // and resolved without queueing a second RPC.
    await Promise.resolve();
    expect(mocks.finishSession).toHaveBeenCalledTimes(1);

    resolveRpc?.();
    await Promise.all([a, b]);
    expect(mocks.finishSession).toHaveBeenCalledTimes(1);
  });

  it('throws when finish() is called before create()', async () => {
    const svc = makeService();
    await expect(svc.finish('finished')).rejects.toThrow(/not yet created/);
  });

  it('passes the status string through to the RPC', async () => {
    const svc = makeService();
    await svc.create({ gameType: 'mole_story' });
    await svc.finish('aborted');
    expect(mocks.finishSession).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'aborted' }),
    );
  });
});
