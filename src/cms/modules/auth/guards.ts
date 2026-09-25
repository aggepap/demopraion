import 'server-only';

import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';

import { getAdminPath } from '../../core/paths';
import { getCurrentUser, loadUserPermissions, type CurrentUser } from './current-user';
import { hasPerm, PERMISSIONS } from './permissions';
import { decideSessionRefresh, sessionIdleSeconds } from './session-idle';
import { readSessionState, setSessionCookie } from './session';

/**
 * Auth guards for pages and API routes.
 *
 * API guards re-load permissions from the DB (via `loadUserPermissions`) rather
 * than trusting the JWT snapshot, so a revoked role takes effect immediately
 * (BACKEND.md §13.13). They return a `NextResponse` to short-circuit, which the
 * route factory's `guard` slot passes straight through.
 */

// ── Page guards (server components / layouts) ──

export async function requireAuth(currentPath?: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    const next = currentPath ? `?next=${encodeURIComponent(currentPath)}` : '';
    redirect(`/${getAdminPath()}/login${next}`);
  }
  return user;
}

export async function requirePerm(key: string, currentPath?: string): Promise<CurrentUser> {
  const user = await requireAuth(currentPath);
  const fresh = await loadUserPermissions(user.userId);
  if (!fresh || !hasPerm(fresh.permissions, key)) {
    redirect(`/${getAdminPath()}/403`);
  }
  return { ...user, permissions: fresh.permissions };
}

// ── API guards (route handlers / createRoute `guard`) ──

const unauthorizedResponse = () =>
  NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

/**
 * `cms.access` — "may use the admin at all" — for the API as for the screens.
 *
 * It used to be enforced only by the shell layout, so a role without it but
 * with, say, `cms.content.read` was refused every screen yet could call the
 * matching endpoints directly. The permission's own description ("Without it
 * every screen refuses them") promised more than the API delivered.
 */
export function adminApiAccessDenied(permissions: readonly string[]): NextResponse | null {
  if (hasPerm(permissions, PERMISSIONS.access)) return null;
  return NextResponse.json({ ok: false, error: 'forbidden', missing: PERMISSIONS.access }, { status: 403 });
}

/**
 * API guard, and the one place the idle window is pushed forward.
 *
 * Sliding the session here rather than in the page guards is not a preference:
 * `cookies().set()` only works in a route handler or server action, and
 * `requireAuth`/`requirePerm` run inside server components where it throws. So
 * an API request is the only server-side event that can renew a session — which
 * is exactly why the admin shell also sends a keepalive on real user activity
 * (see `IdleLogout`), or somebody reading a long page without triggering a
 * fetch would be signed out mid-sentence.
 *
 * Requires `cms.access` (see `adminApiAccessDenied`). `allowWithoutAccess` is
 * for sign-out only: a session whose role lost `cms.access` must still be able
 * to end itself.
 */
export async function requireApiAuth(
  opts: { allowWithoutAccess?: boolean } = {},
): Promise<CurrentUser | NextResponse> {
  const state = await readSessionState();
  if (!state) return unauthorizedResponse();

  const decision = decideSessionRefresh(state, Math.floor(Date.now() / 1000), sessionIdleSeconds());
  if (decision.action === 'expired') return unauthorizedResponse();

  const fresh = await loadUserPermissions(state.claims.userId);
  if (!fresh) return unauthorizedResponse(); // disabled or deleted since sign-in

  if (!opts.allowWithoutAccess) {
    const denied = adminApiAccessDenied(fresh.permissions);
    if (denied) return denied;
  }

  if (decision.action === 'refresh') {
    /*
     * Re-signed with the FRESH permissions and the ORIGINAL absolute cap. Fresh
     * permissions because we have just read them anyway and the snapshot in the
     * token is what renders the page chrome; the original cap because
     * inheriting it is the difference between a sliding session and one that
     * never ends.
     */
    await setSessionCookie(
      { ...state.claims, permissions: fresh.permissions },
      { absoluteExpiry: state.absoluteExpiry, expiresAt: decision.expiresAt },
    );
  }

  return {
    ...state.claims,
    permissions: fresh.permissions,
    sessionExpiresAt:
      decision.action === 'refresh'
        ? decision.expiresAt
        : Math.min(state.issuedAt + sessionIdleSeconds(), state.absoluteExpiry),
  };
}

export async function requireApiPerm(key: string): Promise<CurrentUser | NextResponse> {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!hasPerm(auth.permissions, key)) {
    return NextResponse.json({ ok: false, error: 'forbidden', missing: key }, { status: 403 });
  }
  return auth;
}
