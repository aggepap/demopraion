'use client';

import { Fragment } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { usePathname } from '@/lib/i18n/routing';
import { cn } from '@/lib/utils';

interface LanguageSwitcherProps {
  /** Tone — 'light' for soft-pearl headers, 'dark' for navy footers/overlays. */
  tone?: 'light' | 'dark';
  className?: string;
  /** Locales live on the public site, in display order (from admin settings). */
  locales: string[];
  /** The main (URL-unprefixed) locale. */
  mainLocale: string;
}

/**
 * Language switcher rendered from the admin-managed public locale set.
 * Preserves the current pathname (slugs are English in every language, see
 * specs/02 rule 10) so a click only swaps the locale prefix.
 *
 * Uses plain `<a>` tags with manually composed URLs — neither next-intl's
 * `<Link locale="…">` (was emitting `/el/<path>` for the default-locale
 * link, then proxy-redirecting to `/<path>` with a broken RSC fetch
 * inflight) nor `next/link` (kept the client router's locale context
 * "warm" so the destination locale rendered with the previous locale's
 * messages until a full reload).
 *
 * Plain anchors guarantee:
 *   - the URL goes straight to the canonical form (no /el/ redirect hop)
 *   - the browser does a full document load on locale switch, so the
 *     proxy runs fresh and the entire next-intl context (messages,
 *     active locale, `<html lang>`) re-initialises cleanly
 *
 * Trade-off: ~500ms extra on the locale switch click. Acceptable —
 * users switch locale rarely, and the alternative (broken EL routing)
 * is worse.
 */
export function LanguageSwitcher({ tone = 'light', className, locales, mainLocale }: LanguageSwitcherProps) {
  const locale = useLocale();
  const pathname = usePathname(); // locale-stripped (e.g. `/cases`, not `/en/cases`)
  const t = useTranslations('ui');

  // A single link is no choice — hide the switcher entirely.
  if (locales.length < 2) return null;

  // Paranoid safeguard — strip a leading public-locale prefix if next-intl's
  // `usePathname()` ever returns an unstripped path (shouldn't happen per
  // docs, but inexpensive to defend against).
  const prefixRe = new RegExp(`^/(${locales.join('|')})(?=/|$)`);
  const stripped = pathname.replace(prefixRe, '') || '/';

  // The main locale lives at the un-prefixed root per `localePrefix:
  // 'as-needed'`; every other locale carries its `/<locale>` prefix. Special-
  // case the home path so a non-main locale links to `/<locale>` and not
  // `/<locale>/` (a trailing slash would 308-redirect — same RSC-fetch hazard
  // the plain-anchor approach exists to avoid).
  const hrefFor = (l: string) =>
    l === mainLocale ? stripped : stripped === '/' ? `/${l}` : `/${l}${stripped}`;

  const activeClass = tone === 'dark' ? 'text-soft-pearl font-semibold' : 'text-midnight-navy font-semibold';
  const idleClass = tone === 'dark'
    ? 'text-soft-pearl/60 hover:text-soft-pearl'
    : 'text-text-muted hover:text-midnight-navy';
  const dividerClass = tone === 'dark' ? 'text-soft-pearl/30' : 'text-text-light';

  return (
    <nav
      aria-label={t('languageSwitchAria')}
      className={cn('flex items-center gap-2 font-body text-sm', className)}
    >
      {locales.map((l, i) => (
        <Fragment key={l}>
          {i > 0 ? <span aria-hidden className={dividerClass}>|</span> : null}
          <a
            href={hrefFor(l)}
            hrefLang={l}
            aria-current={locale === l ? 'page' : undefined}
            className={cn('transition-colors duration-200', locale === l ? activeClass : idleClass)}
          >
            {l.toUpperCase()}
          </a>
        </Fragment>
      ))}
    </nav>
  );
}
