import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';

import { routing } from './routing';

/**
 * Loads UI messages for the current request's locale.
 *
 * Page copy itself does NOT live in messages/* JSON — that comes from
 * typed content modules under src/content/. The next-intl messages bundle
 * is used only for header/footer/nav strings and similar shell UI.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../../../messages/${locale}.json`)).default,
  };
});
