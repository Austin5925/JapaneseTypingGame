import { describe, expect, it } from 'vitest';

import {
  APPLE_RESCUE_BASKET_HALF_WIDTH,
  APPLE_RESCUE_BASKET_WIDTH,
  appleRescueLaneX,
} from '../src/scenes/appleRescueLayout';

describe('AppleRescue layout', () => {
  it('spreads the three apple lanes a little wider while keeping the center lane', () => {
    expect([
      appleRescueLaneX(0, 3, 800),
      appleRescueLaneX(1, 3, 800),
      appleRescueLaneX(2, 3, 800),
    ]).toEqual([240, 400, 560]);
  });

  it('keeps the catch board 10% narrower than the original 120px width', () => {
    expect(APPLE_RESCUE_BASKET_WIDTH).toBe(108);
    expect(APPLE_RESCUE_BASKET_HALF_WIDTH).toBe(54);
  });
});
