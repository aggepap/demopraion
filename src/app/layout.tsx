import type { ReactNode } from 'react';

/**
 * Root pass-through layout.
 *
 * The "real" root layout lives at `src/app/[locale]/layout.tsx` and owns
 * `<html>` and `<body>` for every locale-matched request.
 *
 * Next.js requires every `not-found.tsx` to have a sibling layout. Since
 * we have `src/app/not-found.tsx` for unmatched URLs (e.g. requests the
 * i18n proxy excludes via the file-extension matcher), the framework
 * needs THIS file to render that fallback. Returning `children` keeps it
 * a zero-overhead passthrough so `[locale]/layout.tsx` remains the
 * sole owner of `<html>`/`<body>` for normal pages.
 *
 * Pattern source: next-intl `example-app-router` (examples/.../src/app/layout.tsx).
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
