import type { EvaluationResult, TrainingTask, UserAttempt } from '@kana-typing/core';
import { describe, expect, it, vi } from 'vitest';

import { GameBridgeImpl } from '../src/bridge/GameBridge';

function adapter(): {
  requestNextTask: ReturnType<typeof vi.fn>;
  submitAttempt: ReturnType<typeof vi.fn>;
  finishSession: ReturnType<typeof vi.fn>;
} {
  return {
    requestNextTask: vi.fn(() => Promise.resolve(null)),
    submitAttempt: vi.fn((a: UserAttempt) =>
      Promise.resolve({ attemptId: a.id } as unknown as EvaluationResult),
    ),
    finishSession: vi.fn(() => Promise.resolve()),
  };
}

describe('GameBridgeImpl', () => {
  it('forwards on/emit for matching event types', () => {
    const bridge = new GameBridgeImpl(adapter());
    const handler = vi.fn();
    const off = bridge.on('scene.ready', handler);
    bridge.emit({ type: 'scene.ready', sceneId: 's' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ type: 'scene.ready', sceneId: 's' });
    off();
    bridge.emit({ type: 'scene.ready', sceneId: 's' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not fire handlers of other types', () => {
    const bridge = new GameBridgeImpl(adapter());
    const handler = vi.fn();
    bridge.on('scene.ready', handler);
    bridge.emit({ type: 'task.spawned', task: {} as TrainingTask });
    expect(handler).not.toHaveBeenCalled();
  });

  it('survives a listener that unsubscribes itself during emit', () => {
    const bridge = new GameBridgeImpl(adapter());
    const a = vi.fn();
    const off = bridge.on('scene.ready', () => off());
    bridge.on('scene.ready', a);
    bridge.emit({ type: 'scene.ready', sceneId: 's' });
    expect(a).toHaveBeenCalledTimes(1);
  });

  it('isolates a throwing listener so sibling listeners still run', () => {
    const bridge = new GameBridgeImpl(adapter());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sibling = vi.fn();
    bridge.on('scene.ready', () => {
      throw new Error('listener boom');
    });
    bridge.on('scene.ready', sibling);

    bridge.emit({ type: 'scene.ready', sceneId: 's' });

    expect(sibling).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('forwards requestNextTask / submitAttempt / finishSession to the adapter', async () => {
    const a = adapter();
    const bridge = new GameBridgeImpl(a);
    await bridge.requestNextTask();
    expect(a.requestNextTask).toHaveBeenCalled();

    await bridge.submitAttempt({ id: 'x' } as UserAttempt);
    expect(a.submitAttempt).toHaveBeenCalledWith({ id: 'x' });

    await bridge.finishSession('completed');
    expect(a.finishSession).toHaveBeenCalledWith('completed');
  });

  describe('external input channel', () => {
    it('delivers commit and cancel events to subscribers', () => {
      const bridge = new GameBridgeImpl(adapter());
      const handler = vi.fn();
      bridge.onExternalInput(handler);

      bridge.emitExternalInput({ type: 'external.commit', value: 'やくそく' });
      bridge.emitExternalInput({ type: 'external.cancel' });

      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenNthCalledWith(1, { type: 'external.commit', value: 'やくそく' });
      expect(handler).toHaveBeenNthCalledWith(2, { type: 'external.cancel' });
    });

    it('honours unsubscribe', () => {
      const bridge = new GameBridgeImpl(adapter());
      const handler = vi.fn();
      const off = bridge.onExternalInput(handler);
      off();
      bridge.emitExternalInput({ type: 'external.commit', value: 'a' });
      expect(handler).not.toHaveBeenCalled();
    });

    it('isolates a throwing external handler so siblings still run', () => {
      const bridge = new GameBridgeImpl(adapter());
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const sibling = vi.fn();
      bridge.onExternalInput(() => {
        throw new Error('external listener boom');
      });
      bridge.onExternalInput(sibling);

      bridge.emitExternalInput({ type: 'external.commit', value: 'a' });

      expect(sibling).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });

    it('keeps regular and external channels independent', () => {
      const bridge = new GameBridgeImpl(adapter());
      const sceneReady = vi.fn();
      const external = vi.fn();
      bridge.on('scene.ready', sceneReady);
      bridge.onExternalInput(external);

      bridge.emit({ type: 'scene.ready', sceneId: 's' });
      expect(sceneReady).toHaveBeenCalledTimes(1);
      expect(external).not.toHaveBeenCalled();

      bridge.emitExternalInput({ type: 'external.commit', value: 'a' });
      expect(external).toHaveBeenCalledTimes(1);
      // sceneReady still at 1 — channels don't cross.
      expect(sceneReady).toHaveBeenCalledTimes(1);
    });
  });
});
