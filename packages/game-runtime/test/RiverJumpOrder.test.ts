import { describe, expect, it } from 'vitest';

import {
  buildAcceptedChunkOrders,
  isAcceptedChunkPrefix,
  isCompleteAcceptedOrder,
  pickNextAcceptedChunkId,
} from '../src/scenes/riverJumpOrder';

describe('RiverJump accepted-order helpers', () => {
  it('keeps canonical order first and de-duplicates accepted alternates', () => {
    const orders = buildAcceptedChunkOrders(
      ['c1', 'c2', 'c3'],
      [
        ['c2', 'c1', 'c3'],
        ['c1', 'c2', 'c3'],
      ],
    );
    expect(orders).toEqual([
      ['c1', 'c2', 'c3'],
      ['c2', 'c1', 'c3'],
    ]);
  });

  it('allows a non-canonical first chunk when it starts an accepted alternate order', () => {
    const orders = buildAcceptedChunkOrders(['c1', 'c2', 'c3'], [['c2', 'c1', 'c3']]);
    expect(isAcceptedChunkPrefix(orders, ['c2'])).toBe(true);
    expect(pickNextAcceptedChunkId(orders, [], ['c2'])).toBe('c2');
    expect(pickNextAcceptedChunkId(orders, ['c2'], ['c1'])).toBe('c1');
  });

  it('rejects prefixes that are not part of any accepted order', () => {
    const orders = buildAcceptedChunkOrders(['c1', 'c2', 'c3'], [['c2', 'c1', 'c3']]);
    expect(isAcceptedChunkPrefix(orders, ['c3'])).toBe(false);
  });

  it('only completes on a full canonical or accepted alternate order', () => {
    const orders = buildAcceptedChunkOrders(['c1', 'c2', 'c3'], [['c2', 'c1', 'c3']]);
    expect(isCompleteAcceptedOrder(orders, ['c2', 'c1'])).toBe(false);
    expect(isCompleteAcceptedOrder(orders, ['c2', 'c1', 'c3'])).toBe(true);
  });
});
