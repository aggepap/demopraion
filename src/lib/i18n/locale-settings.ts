import 'server-only';

import { resolveLocaleSettings, type LocaleSettings } from '@/cms/core';

import { defaultLocale, locales } from './config';

/**
 * Effective language enablement bound to the app's routing config — the
 * no-argument form used by the public site, SEO, and admin pages. Delegates to
 * the CMS-core resolver (which reads the `i18n.locales` setting); this thin
 * wrapper keeps the site→config coupling out of `src/cms` (reusable core).
 */
export function getLocaleSettings(): Promise<LocaleSettings> {
  return resolveLocaleSettings({ locales, defaultLocale });
}
