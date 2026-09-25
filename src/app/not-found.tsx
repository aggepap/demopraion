import Link from 'next/link';

import { defaultLocale } from '@/lib/i18n/config';

import styles from './not-found.module.css';

/**
 * Root-level 404 fallback.
 *
 * Rendered ONLY for requests that never resolve a locale — for example
 * paths with a file extension (`/something.weird`) that the i18n proxy
 * excludes via its matcher, and any `[locale]` value that's not in
 * `generateStaticParams()` (rejected by `dynamicParams = false`).
 *
 * In-locale 404s (`/en/...`, `/...`) go through `[locale]/[...rest]/page.tsx`
 * which redirects to `/page-not-found` — a regular route inside the locale
 * layout, so it carries Header, Footer, and the full branded UI.
 *
 * This file owns its own `<html>`/`<body>` because it renders OUTSIDE the
 * `[locale]/layout.tsx` chain, so it takes the site's main language for `lang`.
 * Pattern matches next-intl's `example-app-router` reference implementation.
 *
 * Styles ship as a CSS module (`not-found.module.css`) rather than inline
 * `style={{}}` so the page renders cleanly under a strict CSP without
 * needing `style-src 'unsafe-inline'`.
 */
export default function GlobalNotFound() {
  return (
    <html lang={defaultLocale}>
      <body className={styles.body}>
        <main className={styles.main}>
          <p className={styles.eyebrow}>404</p>
          <h1 className={styles.heading}>Page not found</h1>
          <p className={styles.subline}>
            <Link href="/" className={styles.link}>
              Return home
            </Link>
          </p>
        </main>
      </body>
    </html>
  );
}
