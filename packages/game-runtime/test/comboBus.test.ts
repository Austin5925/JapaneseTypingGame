import { describe, expect, it, vi } from 'vitest';

import {
  comboLevel,
  createComboBus,
  LEVEL_THRESHOLD,
  type ComboEvent,
} from '../src/feedback/comboBus';

describe('comboLevel', () => {
  it('returns 0 below the first threshold', () => {
    expect(comboLevel(0)).toBe(0);
    expect(comboLevel(LEVEL_THRESHOLD - 1)).toBe(0);
  });

  it('returns 1 at exactly the first threshold', () => {
    expect(comboLevel(LEVEL_THRESHOLD)).toBe(1);
  });

  it('returns 2 at the second threshold', () => {
    expect(comboLevel(LEVEL_THRESHOLD * 2)).toBe(2);
  });
});

describe('createComboBus', () => {
  it('starts with zero state', () => {
    const bus = createComboBus();
    expect(bus.state).toEqual({ count: 0, peak: 0, lastEventAt: 0 });
  });

  it('increments count on correct, resets on wrong', () => {
    const bus = createComboBus();
    bus.record(true, 100);
    bus.record(true, 200);
    expect(bus.state.count).toBe(2);
    bus.record(false, 300);
    expect(bus.state.count).toBe(0);
  });

  it('tracks monotonic peak', () => {
    const bus = createComboBus();
    for (let i = 0; i < 7; i++) bus.record(true, i);
    bus.record(false, 100); // resets count, peak survives
    expect(bus.state.peak).toBe(7);
    expect(bus.state.count).toBe(0);
    bus.record(true, 200);
    bus.record(true, 300);
    expect(bus.state.peak).toBe(7); // smaller streak doesn't lower peak
  });

  it('emits increment events with correct count + level', () => {
    const bus = createComboBus();
    const events: ComboEvent[] = [];
    bus.subscribe((e) => events.push(e));
    bus.record(true);
    bus.record(true);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: 'increment', count: 1, level: 0, surge: false });
    expect(events[1]).toMatchObject({ type: 'increment', count: 2, level: 0, surge: false });
  });

  it('marks surge=true exactly on the level crossing', () => {
    const bus = createComboBus();
    const events: ComboEvent[] = [];
    bus.subscribe((e) => events.push(e));
    for (let i = 0; i < LEVEL_THRESHOLD * 2; i++) bus.record(true);
    const surges = events.filter((e) => e.type === 'increment' && e.surge);
    expect(surges).toHaveLength(2);
    // First surge at count = LEVEL_THRESHOLD (level 0 → 1)
    expect(surges[0]).toMatchObject({ count: LEVEL_THRESHOLD, level: 1, surge: true });
    // Second surge at count = 2*LEVEL_THRESHOLD (level 1 → 2)
    expect(surges[1]).toMatchObject({ count: LEVEL_THRESHOLD * 2, level: 2, surge: true });
  });

  it('emits a reset event carrying the previous count + current peak', () => {
    const bus = createComboBus();
    const events: ComboEvent[] = [];
    bus.subscribe((e) => events.push(e));
    bus.record(true);
    bus.record(true);
    bus.record(true);
    bus.record(false);
    const last = events[events.length - 1]!;
    expect(last).toEqual({ type: 'reset', previousCount: 3, peak: 3 });
  });

  it('subscribers can unsubscribe', () => {
    const bus = createComboBus();
    const events: ComboEvent[] = [];
    const off = bus.subscribe((e) => events.push(e));
    bus.record(true);
    off();
    bus.record(true);
    expect(events).toHaveLength(1);
  });

  it('multiple subscribers all fire', () => {
    const bus = createComboBus();
    const a: ComboEvent[] = [];
    const b: ComboEvent[] = [];
    bus.subscribe((e) => a.push(e));
    bus.subscribe((e) => b.push(e));
    bus.record(true);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it('a throwing handler does not break the others', () => {
    const bus = createComboBus();
    const ok: ComboEvent[] = [];
    bus.subscribe(() => {
      throw new Error('boom');
    });
    bus.subscribe((e) => ok.push(e));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    bus.record(true);
    warn.mockRestore();
    expect(ok).toHaveLength(1);
  });

  it('reset() clears count + peak', () => {
    const bus = createComboBus();
    for (let i = 0; i < 6; i++) bus.record(true);
    bus.reset();
    expect(bus.state).toMatchObject({ count: 0, peak: 0 });
  });

  it('exposes state as a copy (caller mutations do not leak)', () => {
    const bus = createComboBus();
    bus.record(true);
    const snapshot = bus.state;
    snapshot.count = 999;
    expect(bus.state.count).toBe(1);
  });
});
