/**
 * A star rating.
 *
 * The number is in the accessible name and the stars are hidden from assistive
 * technology: five separate star glyphs read aloud as "star star star star
 * star", which is worse than useless.
 */
export function ReviewStars({ rating }: { rating: number }) {
  const rounded = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <p className="text-warm-gold-deep text-sm" aria-label={`${rounded} out of 5`}>
      <span aria-hidden>{'★'.repeat(rounded)}</span>
      <span aria-hidden className="text-border-soft">
        {'★'.repeat(5 - rounded)}
      </span>
    </p>
  );
}
