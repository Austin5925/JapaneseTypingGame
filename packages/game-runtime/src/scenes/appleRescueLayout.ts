export const APPLE_RESCUE_BASKET_HALF_WIDTH = 54;
export const APPLE_RESCUE_BASKET_WIDTH = APPLE_RESCUE_BASKET_HALF_WIDTH * 2;

export function appleRescueLaneX(index: number, total: number, widthPx: number): number {
  if (total <= 1) return widthPx / 2;
  if (total === 2) {
    return [widthPx * 0.38, widthPx * 0.62][index] ?? widthPx / 2;
  }
  if (total === 3) {
    return [widthPx * 0.3, widthPx * 0.5, widthPx * 0.7][index] ?? widthPx / 2;
  }
  const margin = widthPx * 0.18;
  const usable = widthPx - margin * 2;
  return margin + (usable / (total - 1)) * index;
}
