import { hasLocale } from 'next-intl';

import { routing } from './routing';

/**
 * Where an in-locale URL with nothing behind it should go.
 *
 * Not `notFound()`. On Next 16 + Turbopack a `notFound()` thrown from a
 * dynamic segment renders through the framework's HTTP-error document, which
 * sits outside `[locale]/layout.tsx` — no CSS bundle, an empty server-rendered
 * body, no header or footer. `/page-not-found` is a real route with the full
 * chrome and `robots: noindex`, so the 307 → 200 is never indexed. The long
 * form of this reasoning, with what was measured, is in `[...rest]/page.tsx`.
 *
 * Both the catch-all and the `[slug]` CMS page route need it, and they must
 * agree, so the prefix logic lives here rather than in each of them.
 */
export function pageNotFoundPath(locale: string): string {
  const valid = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  // Greek is the default and has no URL prefix under `localePrefix: 'as-needed'`.
  const prefix = valid === routing.defaultLocale ? '' : `/${valid}`;
  return `${prefix}/page-not-found`;
}
