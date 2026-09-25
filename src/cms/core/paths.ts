/**
 * The public origin, with any trailing slash removed.
 *
 * Read from the environment rather than imported from site code: `src/cms` must
 * not reach into `@/lib`, and a relative-path escape would evade the lint rule
 * that says so rather than satisfy it. Returns '' when unset, which yields a
 * relative URL — wrong for an email or a gateway callback, but not a crash.
 */
export function siteOrigin(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '');
}

/**
 * Whether the deploy at `origin` is the live site.
 *
 * `NEXT_PUBLIC_SITE_URL` alone cannot say: staging sets it too. It has to be
 * compared against the one origin that IS production — `config.productionOrigin`,
 * already normalised by `defineConfig`. No production origin configured means
 * no deploy is production, which is the safe answer for robots.txt.
 */
export function isProductionHost(origin: string, productionOrigin: string | null): boolean {
  if (!origin || !productionOrigin) return false;
  return origin.replace(/\/$/, '') === productionOrigin;
}

/**
 * Prefix for a locale's public URLs: '' for the site's default locale (routing is
 * `localePrefix: 'as-needed'`, so the default is unprefixed) and for a missing
 * one, `/<locale>` otherwise.
 *
 * Which locale is the default is the SITE's choice — `config.defaultLocale` — so
 * every caller passes it. This used to assume Greek, which sent every emailed
 * order-return and payment link on an English-first site to the wrong language.
 */
export function localePrefix(locale: string | null | undefined, defaultLocale: string): string {
  const resolved = localeOrDefault(locale, defaultLocale);
  return resolved === defaultLocale ? '' : `/${resolved}`;
}

/** The locale to store or render in: the given one, or the site default when missing or blank. */
export function localeOrDefault(locale: string | null | undefined, defaultLocale: string): string {
  const trimmed = locale?.trim();
  return trimmed ? trimmed : defaultLocale;
}

/**
 * A single URL slug: letters, digits, `-` and `_`, nothing else.
 *
 * The constraint is not cosmetic. `next.config.ts` interpolates this same value
 * into a path-to-regexp `source` to scope the admin's security headers, and it
 * cannot import this module (the `@/*` alias does not exist yet when the config
 * is loaded), so the rule is written out there as well. Keep the two in step.
 */
const ADMIN_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;

let warnedBadAdminPath = false;

/**
 * Admin path helpers. The admin segment is configurable via `ADMIN_PATH`
 * (default `admin`) so a site can move the admin behind an obscure prefix.
 */
export function getAdminPath(): string {
  const raw = process.env.ADMIN_PATH?.trim().replace(/^\/+|\/+$/g, '');
  if (!raw) return 'admin';
  if (!ADMIN_SEGMENT_PATTERN.test(raw)) {
    /*
     * Fall back rather than honour it.
     *
     * A segment containing `:`, `(`, `*`, a space or a further slash either
     * breaks the header rule in `next.config.ts` or makes it match something
     * that is not the admin — and it fails SILENTLY: the admin still renders,
     * at a path its CSP and COEP headers no longer cover. Refusing keeps the
     * page and the headers that protect it on the same path.
     */
    if (!warnedBadAdminPath) {
      warnedBadAdminPath = true;
      console.warn(
        `[cms] ADMIN_PATH ${JSON.stringify(raw)} is not a plain URL slug ` +
          '([A-Za-z0-9_-]) — falling back to "admin".',
      );
    }
    return 'admin';
  }
  return raw;
}

export function isAdminPath(pathname: string): boolean {
  const admin = getAdminPath();
  return pathname === `/${admin}` || pathname.startsWith(`/${admin}/`);
}

export function isAdminApiPath(pathname: string): boolean {
  return pathname.startsWith('/api/cms/');
}

/**
 * Coerce a caller-supplied `?redirect=` value to a same-site path.
 *
 * Rejecting only a leading `//` is not enough. Browsers resolve a URL before
 * they follow it, and two shapes survive that check but still leave the site:
 *   `/\evil.com`      — for http(s) a backslash acts as an authority separator,
 *                       so this resolves exactly like `//evil.com`
 *   `/<TAB>/evil.com` — tab, CR and LF are stripped from URLs, leaving `//evil.com`
 *
 * Anything that is not a plain relative path falls back to `/`.
 */
export function safeRedirectPath(raw: string | null | undefined): string {
  if (!raw) return '/';
  // Drop every C0 control character and DEL, the ones a browser would strip
  // for us after this check had already passed.
  const cleaned = Array.from(raw)
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code > 0x20 && code !== 0x7f;
    })
    .join('');
  if (!cleaned.startsWith('/') || cleaned.startsWith('//') || cleaned.includes('\\')) return '/';
  return cleaned;
}
