/**
 * The site's two `next/font` instances, in one place.
 *
 * They were declared inline in `src/app/[locale]/layout.tsx`, which was fine
 * while that was the only layout that owned a `<body>`. The questionnaire kiosk
 * is a second one, and two separate `Fraunces(...)`/`Inter(...)` call sites emit
 * two independent `@font-face` sets and preload hints that drift apart the first
 * time a weight or a subset changes.
 *
 * Note the subsets: Inter carries `greek`, Fraunces does not — Fraunces has no
 * Greek glyphs at all, so `--font-display` falls back per-glyph to Georgia for
 * Greek headings across the whole EL site. That is long-standing behaviour, not
 * something introduced here; the kiosk, being Greek-only, simply does not load
 * Fraunces so it is not shipping a serif that renders nothing.
 */
import { Fraunces, Inter } from 'next/font/google';

export const fraunces = Fraunces({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-fraunces',
  display: 'swap',
});

export const inter = Inter({
  subsets: ['latin', 'latin-ext', 'greek'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
});
