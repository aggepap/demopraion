/**
 * Read-only star rating. Server-safe (pure SVG, no state). Supports a
 * fractional `value` (e.g. 4.3) by clipping a gold overlay over grey stars, so
 * the average reads honestly rather than rounding to whole stars.
 */
export function ReviewStars({
  value,
  size = 16,
  className = '',
}: {
  value: number;
  size?: number;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(5, value));
  const pct = (clamped / 5) * 100;
  const stars = '★★★★★';
  return (
    <span
      className={`relative inline-block leading-none ${className}`}
      style={{ fontSize: size }}
      role="img"
      aria-label={`${clamped.toFixed(1)} out of 5`}
    >
      <span className="text-border-soft">{stars}</span>
      <span
        className="absolute inset-0 overflow-hidden text-warm-gold-deep"
        style={{ width: `${pct}%` }}
        aria-hidden="true"
      >
        {stars}
      </span>
    </span>
  );
}
