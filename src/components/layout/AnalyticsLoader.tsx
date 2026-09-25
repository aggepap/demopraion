'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import Script from 'next/script';
import { Suspense, useEffect, useRef } from 'react';

import { ANALYTICS_CATEGORY_KEY } from '@/cms/core/cookies/defaults';
import { resolveGaId } from '@/cms/core/settings/analytics';
import { useCategoryConsent } from '@/components/layout/CookieBanner';

/**
 * GA4 loader, consent-gated and SPA-aware.
 *
 * Only injects gtag when ALL three conditions hold:
 *   1. A measurement ID resolves — the `analytics.gaMeasurementId` setting,
 *      or the NEXT_PUBLIC_GA_MEASUREMENT_ID build-time fallback (`resolveGaId`).
 *   2. The visitor has granted the `analytics` cookie category (via
 *      `useCategoryConsent`, which falls back to the blanket consent flag when no
 *      such category is declared in the admin's catalogue).
 *   3. NODE_ENV is "production" — never load in dev/preview.
 *
 * The hook is backed by `useSyncExternalStore`, so a same-session
 * "Accept all" enables analytics without a reload, and a "Reject" /
 * cleared choice unmounts the scripts.
 *
 * SPA navigation: App Router route changes don't reload the page, so
 * gtag.js only auto-sends the FIRST page_view (from the `config` call).
 * `GaPageviews` fires a manual page_view on every subsequent pathname /
 * query change so client-side navigations are tracked too.
 */

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag: (...args: unknown[]) => void;
  }
}

/**
 * Sends a GA4 page_view on client-side route changes.
 *
 * The initial load is already counted by `gtag('config', …)`, so we skip
 * the first effect run to avoid double-counting it. Reads search params,
 * hence wrapped in <Suspense> by the caller (App Router requirement —
 * keeps statically rendered pages from opting into dynamic rendering).
 */
/**
 * Query parameters that must never reach Google Analytics.
 *
 * `t` is the booking payment link's bearer token. `paymentLinkUrl()` puts it in
 * the URL because the provider's return leg has to carry it back, and the token
 * deliberately stays live until a payment is credited — so it is a working
 * credential for as long as the booking is unpaid. GA4's `config` command sends
 * an automatic page_view built from `location.href`, and `GaPageviews` sends
 * `page_location` on every client navigation, so the whole payment URL — token
 * included — was going to Google and into the GA UI for anyone with account
 * access. Whoever read it there could open the booking and see the customer's
 * name, email, dates and amount.
 *
 * The page already carries `robots: noindex`, so the URL was known to be
 * sensitive; nothing had stopped it reaching analytics.
 */
const SENSITIVE_QUERY_PARAMS = ['t', 'token'] as const;

/** A URL safe to report to analytics: sensitive values replaced, not dropped, so
 *  the shape of the page is still visible in reports. */
export function scrubUrl(href: string): string {
  try {
    const url = new URL(href);
    for (const key of SENSITIVE_QUERY_PARAMS) {
      if (url.searchParams.has(key)) url.searchParams.set(key, 'redacted');
    }
    return url.toString();
  } catch {
    // A URL that will not parse is not one we can safely report.
    return '';
  }
}

/** The same rule for the `page_path` string, which is built from the raw query. */
export function scrubQuery(query: string): string {
  const params = new URLSearchParams(query);
  for (const key of SENSITIVE_QUERY_PARAMS) {
    if (params.has(key)) params.set(key, 'redacted');
  }
  return params.toString();
}

function GaPageviews() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isFirstRun = useRef(true);

  useEffect(() => {
    // The `config` command already reported the entry page_view in the
    // correct order (after gtag.js initialised); skip it here.
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    if (typeof window.gtag !== 'function') return;

    const query = scrubQuery(searchParams?.toString() ?? '');
    const path = query ? `${pathname}?${query}` : pathname;

    window.gtag('event', 'page_view', {
      page_path: path,
      page_location: scrubUrl(window.location.href),
      page_title: document.title,
    });
  }, [pathname, searchParams]);

  return null;
}

/**
 * `gaId` comes from the admin-managed `analytics.gaMeasurementId` setting
 * (passed by the layout); it falls back to the build-time env var for
 * backward compatibility. Empty → analytics off.
 */
export function AnalyticsLoader({ gaId: gaIdProp }: { gaId?: string } = {}) {
  // The same resolution the cookie declaration uses, so the policy can never
  // say less than the loader does.
  const gaId = resolveGaId(gaIdProp);
  /*
   * The `analytics` category, not the blanket flag.
   *
   * A visitor who accepted marketing and refused analytics used to get GA anyway,
   * because there was only one global yes/no and the admin's categories governed
   * nothing (F-065). `useCategoryConsent` falls back to the blanket flag when no such
   * category is declared, so a site with an empty catalogue behaves as before.
   */
  const analyticsAllowed = useCategoryConsent(ANALYTICS_CATEGORY_KEY);

  if (!gaId) return null;
  if (process.env.NODE_ENV !== 'production') return null;
  if (!analyticsAllowed) return null;

  /*
   * Never interpolated raw, even though the setting is validated on the way in.
   *
   * This is the one place in the app where an admin-supplied string lands inside a
   * script tag instead of being rendered as text, and it used to go in unescaped:
   * a value containing a quote closed the string literal and the rest executed, for
   * every visitor who accepted cookies (F-063). The write boundary now refuses
   * anything that is not a `G-` id, but a row stored before that guard existed —
   * or set straight in the database — must not be able to execute either. So the
   * value goes through `JSON.stringify`, which produces a quoted, escaped literal,
   * and the URL through `encodeURIComponent`.
   *
   * `JSON.stringify` alone is not enough for a *script* sink, though. It escapes
   * quotes, backslashes and control characters — which is what a JS string
   * literal needs — but it leaves `<` untouched, and the HTML parser ends
   * a script element at the literal bytes `</script`, without caring that they
   * sit inside a string. A value of `</script><script>…` would therefore close
   * this element and open an attacker's, the exact breakout the quoting above
   * was meant to stop. Escaping `<` closes it, and matches what `jsonLd()` in
   * `src/lib/seo/schemas.ts` already does for the JSON-LD blocks.
   */
  const gaLiteral = JSON.stringify(gaId).replace(/</g, '\\u003c');

  return (
    <>
      <Script
        id="ga4-src"
        src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`}
        strategy="afterInteractive"
      />
      {/*
        The `config` command's page_view is the one that mattered.
        GA4 sends an automatic page_view from `config` unless told otherwise, built
        from `location.href` — and `GaPageviews` deliberately skips the first run to
        avoid double-counting it, so the entry hit (the one that lands when the
        customer opens the payment link) was the single event nothing scrubbed.
        `page_location` is therefore passed explicitly here, cleaned by the same
        rule as the client-side events. The scrub is written out as inline JS
        because it has to run in the browser before gtag reads the URL; the list of
        parameters comes from `SENSITIVE_QUERY_PARAMS` so there is still only one
        place to add to.
      */}
      <Script id="ga4-init" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
function siteScrub(h){try{var u=new URL(h);${JSON.stringify(SENSITIVE_QUERY_PARAMS)}.forEach(function(k){if(u.searchParams.has(k))u.searchParams.set(k,'redacted');});return u.toString();}catch(e){return '';}}
gtag('js', new Date());
gtag('config', ${gaLiteral}, { anonymize_ip: true, page_location: siteScrub(location.href) });`}
      </Script>
      <Suspense fallback={null}>
        <GaPageviews />
      </Suspense>
    </>
  );
}
