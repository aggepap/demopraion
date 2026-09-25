/**
 * Locale configuration.
 *
 * `Locale` is every language this codebase carries messages for; `locales` is
 * the set this site serves. They are kept apart so code that branches on a
 * locale still type-checks when a site serves only one of them. Must list the
 * same locales as `site.config.ts` (test/site/config.test.ts checks it).
 *
 * The default locale shows no URL prefix; the others live under /<locale>/*.
 */
export type Locale = 'el' | 'en';

export const locales: readonly Locale[] = ['el', 'en'];

export const defaultLocale: Locale = 'el';

export const localePrefix = 'as-needed' as const;
