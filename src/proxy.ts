/**
 * Edge proxy for i18n routing.
 *
 * Renamed from `middleware.ts` for Next 16 — the `middleware` file convention
 * is deprecated in favor of `proxy`. The `proxy` file runs on the Node.js
 * runtime (edge runtime is not supported in proxy). next-intl's routing
 * helper works the same regardless of file name.
 *
 * Next 16 also recommends naming the exported function `proxy`, even when
 * using a default export.
 */
import { NextResponse, type NextRequest } from 'next/server';
import createMiddleware from 'next-intl/middleware';

import { resolveAdminRequest } from './cms/admin/admin-path';
import { ADMIN_PATH_HEADER, requestedAdminPath } from './cms/core/admin-deep-link';
import { getAdminPath } from './cms/core/paths';
import { bumpRedirectHit, resolveRedirect } from './cms/core/seo/resolve';
import { routing } from './lib/i18n/routing';

// The `Link: rel="alternate" hreflang` HTTP header is disabled via
// `alternateLinks: false` on the routing config (see routing.ts) — hreflang
// ships only as HTML `<link>` tags to avoid duplicate annotations.
const intl = createMiddleware(routing);

/**
 * Admin-managed SEO redirects run first (Node runtime → DB access is allowed
 * in the proxy). A matching active redirect short-circuits with its status
 * code; otherwise the request continues through i18n routing. Resolution is
 * fail-open, so a redirect lookup error never blocks a request.
 */
export default async function proxy(request: NextRequest) {
  /*
   * The admin takes an early exit, before the redirect lookup and before i18n.
   *
   * It is here at all for two reasons. A server layout is handed no pathname,
   * so the shell's auth guard had no way to put the requested path in `?next=`
   * and every deep link signed you in at the dashboard; this is the only place
   * that knows the URL, so it stamps it. And the admin's URL segment is
   * `ADMIN_PATH` while its pages are filed under `src/app/admin`, a name fixed
   * at build time — so a moved admin is rewritten onto that route tree here.
   *
   * Getting out early is the point. The admin has never been subject to
   * admin-managed SEO redirects or locale routing — it was excluded from the
   * matcher entirely — and returning before `resolveRedirect` keeps both true
   * while also sparing every admin request a database round trip.
   *
   * The segment is read at request time (`getAdminPath()`); the matcher cannot
   * follow it, being fixed at build time. It does not need to: a custom segment
   * is an ordinary path the site matcher already sends here, and the literal
   * `/admin` entries below keep the default reaching this branch too.
   */
  const { pathname } = request.nextUrl;
  const admin = resolveAdminRequest(pathname, getAdminPath());
  if (admin.kind === 'admin') {
    // Set, not merged — the value steers a post-login redirect, so a request
    // arriving with its own copy must not be able to choose the destination.
    // It carries the PUBLIC path, which is what `?next=` must send you back to.
    const headers = new Headers(request.headers);
    headers.set(ADMIN_PATH_HEADER, requestedAdminPath(request.nextUrl));
    if (admin.internal === pathname) return NextResponse.next({ request: { headers } });
    const target = request.nextUrl.clone();
    target.pathname = admin.internal;
    return NextResponse.rewrite(target, { request: { headers } });
  }
  if (admin.kind === 'hidden') {
    /*
     * The route tree's own `/admin` path while the admin has moved. A plain
     * 404, decided here: it must not reach the pages (that would serve the
     * admin at its old address) and must not reach locale routing either,
     * which could redirect it to `/<locale>/admin` or rewrite it into the
     * site. `/admin` stays outside i18n whatever `ADMIN_PATH` says.
     */
    return new NextResponse(null, { status: 404 });
  }

  const match = await resolveRedirect(pathname);
  if (match) {
    void bumpRedirectHit(match.id);
    const target = /^https?:\/\//.test(match.target)
      ? match.target
      : new URL(match.target, request.nextUrl.origin).toString();
    return NextResponse.redirect(target, match.statusCode);
  }
  return intl(request);
}

export const config = {
  /*
   * Skip Next internals, API routes, the CMS admin, and any path with a file
   * extension (favicons, og images). Everything else passes through i18n routing
   * and, before that, the redirect resolver above.
   *
   * Each exclusion is anchored to a whole path segment — `api/`, `api` at the end,
   * and so on. Written as bare words, the lookahead matched them as plain text
   * prefixes, so `/administration-old`, `/administrators` and `/api-reference`
   * were treated as though they were the admin or the API: no locale routing, and
   * no redirect on them was ever honoured. An admin could author a rule for such a
   * path, see it listed as active, and never see it fire, with nothing to explain
   * why (F-050).
   */
  matcher: [
    '/((?!api(?:/|$)|admin(?:/|$)|_next(?:/|$)|_vercel(?:/|$)|.*\\..*).*)',
    /*
     * The admin is listed separately rather than by relaxing the negative
     * lookahead above. That expression carries the F-050 fix and is easy to
     * break; adding an entry leaves it untouched, and keeps the two jobs
     * legible — everything else routes, the admin only gets stamped.
     *
     * Literal `admin` on purpose even when `ADMIN_PATH` moves the admin: a
     * matcher is fixed at build time, a custom segment already reaches the
     * proxy through the site matcher, and `/admin` must still reach it so the
     * proxy can answer it with a 404 instead of letting the pages serve it.
     */
    '/admin',
    '/admin/:path*',
  ],
};
