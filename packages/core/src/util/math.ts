/**
 * Clamp a number to the inclusive range [min, max]. NaN is preserved (returned as-is) so
 * callers can detect upstream divide-by-zero rather than silently clamping it to a boundary.
 */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return value;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** ISO timestamp shifted by `days` days (positive = future, negative = past). */
export function addDays(base: Date, days: number): Date {
  const out = new Date(base.getTime());
  out.setTime(out.getTime() + days * 86_400_000);
  return out;
}

export function addMinutes(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * 60_000);
}

/**
 * Exponentially-weighted moving average. Returns the new average when adding `sample` to a
 * running average. `previous === undefined` returns `sample` (fresh start). Weight defaults to
 * 0.3 — recent samples count for ~30% of the next reading, matching the sluggish update we
 * want for reaction time so a single fluke doesn't move the user's averageReactionTimeMs much.
 */
export function ewma(previous: number | undefined, sample: number, weight = 0.3): number {
  if (previous === undefined || Number.isNaN(previous)) return sample;
  return previous * (1 - weight) + sample * weight;
}
