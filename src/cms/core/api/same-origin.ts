/**
 * CSRF belt: verify a state-changing request originates from our own site.
 *
 * The session cookie is `sameSite=lax`, so cross-site form POSTs already can't
 * carry it; this is defence in depth. Improved over v1 (BACKEND.md §13.9): a
 * missing `NEXT_PUBLIC_SITE_URL` now logs a loud warning instead of silently
 * disabling the check.
 */
/**
 * NOTE for local development: this compares against `NEXT_PUBLIC_SITE_URL`, so
 * that value must name the port the instance actually serves on. Two instances
 * run from this checkout — `npm run dev` on :3002 and `npm run dev:qa` on :3003
 * — and when the variable was left pointing at a third port EVERY write from
 * the admin UI came back 403 "Cross-origin request rejected", while the same
 * write over plain HTTP (no Origin header) succeeded. `dev:qa` therefore sets
 * the variable to its own URL, and `.env.local` carries the `dev` one.
 */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  // No Origin header → non-browser client (curl, server-to-server). The guard's
  // cookie requirement still applies; there's nothing to compare here.
  if (!origin) return true;

  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (!site) {
    // Fail CLOSED in production. A misconfigured deployment used to disable this
    // belt entirely and say so only in a server log nobody reads — the one
    // environment where the check matters most was the one that silently lost
    // it. Refusing the write is loud, immediate and recoverable; the fix is one
    // environment variable. Development still passes through, because there the
    // warning IS read and a hard failure only obstructs.
    console.warn(
      '[cms] NEXT_PUBLIC_SITE_URL is not set — same-origin check cannot run. ' +
        'Set it so cross-origin writes are rejected.',
    );
    return process.env.NODE_ENV !== 'production';
  }

  try {
    return new URL(origin).origin === new URL(site).origin;
  } catch {
    return false;
  }
}
