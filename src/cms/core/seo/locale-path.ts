/**
 * The path key of the per-path SEO tables (`seo_meta`, `pm_head_payloads`).
 *
 * Both are unique on `(path, locale)`, and every reader asks with the path as the
 * main language spells it — unprefixed — plus the locale: `/foo` + `en`, never
 * `/en/foo` + `en` (see `localizedMetadata`). A document's `canonicalPath` is the
 * public URL, which IS prefixed outside the main language, so a writer that keys
 * a row by it stores it where no page will ever look. Pure, so it can be tested.
 */

/** `/en/foo` + `en` → `/foo`. The main language's paths are returned unchanged. */
export function localeKeyedPath(path: string, locale: string, defaultLocale: string): string {
  if (locale === defaultLocale) return path;
  const prefix = `/${locale}`;
  if (path === prefix) return '/';
  return path.startsWith(`${prefix}/`) ? path.slice(prefix.length) : path;
}

/**
 * The paths a lookup should accept for `(path, locale)`: the proper key first,
 * then the locale-prefixed form rows were stored under before writers were fixed.
 * Harmless for the main language, where no prefixed row exists.
 */
export function localeKeyedPathCandidates(path: string, locale: string): string[] {
  return [path, path === '/' ? `/${locale}` : `/${locale}${path}`];
}
