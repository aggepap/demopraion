/**
 * Where the admin lives, publicly and on disk.
 *
 * The pages are at `src/app/admin/**` — a folder name, fixed at build time —
 * while the URL segment comes from `ADMIN_PATH` (see `getAdminPath()`). The
 * proxy bridges the two: `/<ADMIN_PATH>/**` is rewritten to the `/admin/**`
 * route tree, and when the segment has been moved, a direct `/admin/**`
 * request is treated as the ordinary public path it now is (so it ends on the
 * site's not-found page, like any other unknown URL, rather than revealing
 * the admin behind it).
 *
 * Every link and redirect the admin emits goes through `adminHref()` with the
 * resolved segment. Client components cannot read `ADMIN_PATH` (it is not a
 * `NEXT_PUBLIC_` variable), so the server resolves it and hands it down as an
 * `adminPath` prop, the same way `IdleLogout` and `LoginForm` receive it.
 *
 * Pure string functions: the proxy, server pages and client components all
 * import this file.
 */

/** The segment the route tree is filed under: `src/app/admin`. */
export const ADMIN_ROUTE_SEGMENT = 'admin';

/**
 * `/<adminPath>` followed by `path`, e.g. `adminHref('cms', 'article/12')` →
 * `/cms/article/12`. A leading slash on `path` is optional; a query string
 * (`orders?status=paid`) is passed through untouched.
 */
export function adminHref(adminPath: string, path = ''): string {
  const root = `/${adminPath.replace(/^\/+|\/+$/g, '')}`;
  const rest = path.replace(/^\/+/, '');
  if (!rest) return root;
  return /^[?#]/.test(rest) ? `${root}${rest}` : `${root}/${rest}`;
}

/** Whether `pathname` is `/<segment>` or below it (whole segments only). */
function under(pathname: string, segment: string): boolean {
  return pathname === `/${segment}` || pathname.startsWith(`/${segment}/`);
}

export type AdminRequest =
  /** An admin URL; `internal` is the matching path in the `/admin` route tree. */
  | { kind: 'admin'; internal: string }
  /** The route tree's own path while the admin has been moved elsewhere. */
  | { kind: 'hidden' }
  /** Nothing to do with the admin. */
  | { kind: 'site' };

/** Classify a request path against the configured admin segment. */
export function resolveAdminRequest(pathname: string, adminPath: string): AdminRequest {
  if (under(pathname, adminPath)) {
    return {
      kind: 'admin',
      internal: `/${ADMIN_ROUTE_SEGMENT}${pathname.slice(adminPath.length + 1)}`,
    };
  }
  if (adminPath !== ADMIN_ROUTE_SEGMENT && under(pathname, ADMIN_ROUTE_SEGMENT)) {
    return { kind: 'hidden' };
  }
  return { kind: 'site' };
}
