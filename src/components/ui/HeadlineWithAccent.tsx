/**
 * Editorial section-headline primitive — shared across the home,
 * marketing, and pulse page redesigns (and any future page that follows
 * EDITORIAL_ARCHITECTURE.md).
 *
 * Renders `{before}<em>{accent}</em>{after}` with the accent word in
 * italic gold. `tone` switches the gold shade so the accent stays
 * legible on dark (navy) section backgrounds — `text-warm-gold` on navy,
 * `text-warm-gold-deep` on light surfaces.
 *
 * Whitespace is owned by the surrounding strings — `accent` is the bare
 * word, `before` carries its trailing space, `after` its leading space
 * or punctuation.
 */

/** Headline split into the plain text around an italic-gold accent word.
 *  Content files type their per-section headline fields with this shape
 *  (often locally named `SectionHeadline` — structurally identical, so
 *  either name works as a prop value). */
export interface AccentHeadline {
  before: string;
  accent: string;
  after: string;
}

interface HeadlineWithAccentProps {
  headline: AccentHeadline;
  /** `light` (default) → warm-gold-dark accent; `dark` → warm-gold accent
   *  for navy section backgrounds. */
  tone?: 'light' | 'dark';
}

export function HeadlineWithAccent({ headline, tone = 'light' }: HeadlineWithAccentProps) {
  // Light tone uses warm-gold-deep (#8B6420) for AA contrast on soft-pearl.
  // Italic accents render across a range of sizes (h1 → h3); the deepest
  // gold is the only shade that passes WCAG 4.5:1 even at the small end
  // of that range. Dark tone (warm-gold on navy) already exceeds 7:1.
  const accentColor = tone === 'dark' ? 'text-warm-gold' : 'text-warm-gold-deep';
  return (
    <>
      {headline.before}
      <em className={`italic font-display ${accentColor}`}>{headline.accent}</em>
      {headline.after}
    </>
  );
}

/** Flatten an AccentHeadline to a single plain string — used where the
 *  headline value needs to appear in a non-JSX context (breadcrumb names,
 *  OG image titles, meta tags, etc.). */
export function flattenAccentHeadline(headline: AccentHeadline): string {
  return `${headline.before}${headline.accent}${headline.after}`;
}
