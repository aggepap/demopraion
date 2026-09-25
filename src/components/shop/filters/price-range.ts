/**
 * The price slider's arithmetic, kept out of the component so it can be tested
 * on its own — the same split as `variant-gallery.ts`.
 */

export interface PriceBounds {
  min: number;
  max: number;
}

export interface PriceRange {
  min: number | undefined;
  max: number | undefined;
}

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

const usable = (value: number | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/**
 * A range inside the bounds, with the handles unable to cross. A minimum above
 * the maximum is a filter that can never match anything, so the maximum is
 * pushed up to meet it rather than the pair being rejected.
 */
export function clampRange(range: PriceRange, bounds: PriceBounds): PriceBounds {
  const min = clamp(usable(range.min, bounds.min), bounds.min, bounds.max);
  const max = clamp(usable(range.max, bounds.max), bounds.min, bounds.max);
  return { min, max: Math.max(min, max) };
}

/** How far a Page key moves: a tenth of the range, at least 1. */
function pageStep(bounds: PriceBounds): number {
  return Math.max(1, Math.round((bounds.max - bounds.min) / 10));
}

/**
 * The value a key produces, or `null` for a key the slider does not use — so
 * the component only calls `preventDefault` on keys it actually handled, and
 * Tab still moves on.
 */
export function stepFromKey(value: number, key: string, bounds: PriceBounds): number | null {
  const page = pageStep(bounds);
  const moved = (() => {
    switch (key) {
      case 'ArrowRight':
      case 'ArrowUp':
        return value + 1;
      case 'ArrowLeft':
      case 'ArrowDown':
        return value - 1;
      case 'PageUp':
        return value + page;
      case 'PageDown':
        return value - page;
      case 'Home':
        return bounds.min;
      case 'End':
        return bounds.max;
      default:
        return null;
    }
  })();
  return moved === null ? null : clamp(moved, bounds.min, bounds.max);
}

/**
 * The URL parameters for a chosen range. An end left at the bound writes
 * nothing: pinning the prices that happened to be on screen would quietly
 * filter out the next product priced outside them.
 */
export function rangeToParams(
  range: PriceBounds,
  bounds: PriceBounds
): { price_min: string | null; price_max: string | null } {
  return {
    price_min: range.min > bounds.min ? String(range.min) : null,
    price_max: range.max < bounds.max ? String(range.max) : null,
  };
}

/** Where a value sits along the track, as a percentage. */
export function positionPercent(value: number, bounds: PriceBounds): number {
  const span = bounds.max - bounds.min;
  return span <= 0 ? 0 : ((value - bounds.min) / span) * 100;
}
