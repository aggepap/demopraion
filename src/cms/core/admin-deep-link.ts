/**
 * The requested admin path, carried from middleware to the shell layout.
 *
 * A deep link into the admin has to survive the sign-in bounce: open
 * `/admin/orders` with no session and you should come back to `/admin/orders`,
 * not the dashboard. `requireAuth` has always emitted `?next=<path>` for that,
 * `LoginForm` reads it and `safeNextPath` hardens it — but the shell layout,
 * the only caller that covers every admin screen, had no way to know which path
 * was asked for. An App Router layout is handed no pathname, so it passed the
 * literal `'/admin'` and every deep link collapsed onto the dashboard.
 *
 * Middleware is the one place that does know, so it stamps the path here and
 * the layout reads it back. The header name lives in this module because both
 * halves must agree on it: spelled differently in either place, the layout
 * silently sees nothing and falls back to the dashboard — the exact bug this
 * fixes, and one that would leave every test but an end-to-end one green.
 *
 * The value is NOT trusted on arrival. Middleware overwrites whatever the
 * client sent, and the layout still runs it through `safeNextPath`, because it
 * ends up in a post-login redirect and a header a proxy could set must not
 * choose where a freshly-authenticated admin lands.
 */
export const ADMIN_PATH_HEADER = 'x-admin-pathname';

/** The path to preserve, query string included — `/admin/orders?status=paid`
 *  and `/admin/orders` are different screens to whoever bookmarked one. */
export function requestedAdminPath(url: { pathname: string; search: string }): string {
  return `${url.pathname}${url.search}`;
}
