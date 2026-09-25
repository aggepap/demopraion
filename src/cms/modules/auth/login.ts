import 'server-only';

import { eq } from 'drizzle-orm';

import { getDb, schema } from '../../db';
import { verifyPassword } from './password';
import { setSessionCookie, type SessionClaims } from './session';

/**
 * A real bcrypt hash of a value nobody knows, compared against when the account
 * does not exist. Its only job is to cost the same as a genuine comparison.
 */
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.7Zw8Wq9y3rE0aVQ0Zx0nQ0oV1oJm2Hy';

/**
 * What the password step concluded.
 *
 * `mfa` and `enroll` are neither successes nor failures — the credentials were
 * right and the sign-in is unfinished — which is why this discriminates on
 * `status` rather than the `ok` boolean it used to carry. A boolean forced
 * every caller to treat "give me your code" as one of the two, and both
 * readings are wrong in a way that ends with a session cookie.
 */
export type LoginResult =
  | { status: 'ok'; user: SessionClaims }
  | { status: 'mfa'; userId: number; email: string; method: 'totp' | 'email' }
  | { status: 'enroll'; userId: number; email: string }
  | { status: 'fail'; reason: 'invalid_credentials' | 'disabled' | 'no_roles' };

interface Credentials {
  claims: SessionClaims;
  mfaMethod: string | null;
}

type CredentialResult =
  | { ok: true; credentials: Credentials }
  | { ok: false; reason: 'invalid_credentials' | 'disabled' | 'no_roles' };

/**
 * Check email + password and resolve the account's permissions. **Issues
 * nothing** — no cookie, no `last_login_at`.
 *
 * That separation is the whole seam a second factor needs. This function used
 * to end by calling `setSessionCookie`, which meant there was no point in the
 * flow at which the password had been accepted but the user was not yet signed
 * in.
 */
async function verifyCredentials(email: string, password: string): Promise<CredentialResult> {
  const db = getDb();

  const [user] = await db
    .select()
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.email, email.trim().toLowerCase()))
    .limit(1);

  // Always run one bcrypt comparison, whatever the account turns out to be.
  //
  // Returning early for an unknown or disabled email skipped the ~cost-12 hash
  // that dominates this request's latency, so the response time told an
  // attacker which addresses exist — the identical error message did not hide
  // that. Comparing against a dummy hash keeps the two paths the same length.
  const passwordOk = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);

  if (!user) return { ok: false, reason: 'invalid_credentials' };
  if (user.disabledAt) return { ok: false, reason: 'disabled' };
  if (!passwordOk) return { ok: false, reason: 'invalid_credentials' };

  const roleRows = await db
    .select({ permissions: schema.adminRoles.permissions })
    .from(schema.adminUserRoles)
    .innerJoin(schema.adminRoles, eq(schema.adminRoles.id, schema.adminUserRoles.roleId))
    .where(eq(schema.adminUserRoles.userId, user.id));

  if (roleRows.length === 0) return { ok: false, reason: 'no_roles' };

  const permissions = Array.from(new Set(roleRows.flatMap((row) => row.permissions ?? [])));

  return {
    ok: true,
    credentials: {
      claims: {
        userId: user.id,
        email: user.email,
        name: user.name,
        locale: user.locale,
        permissions,
      },
      mfaMethod: user.mfaMethod,
    },
  };
}

/**
 * Issue the session: stamp `last_login_at` and set the cookie.
 *
 * `last_login_at` moved here from the credential check deliberately. A sign-in
 * that stalls at the code prompt is not a sign-in, and recording it as one
 * would quietly corrupt the only column an operator has for "is this account
 * still in use?".
 */
export async function issueSession(claims: SessionClaims): Promise<void> {
  await getDb()
    .update(schema.adminUsers)
    .set({ lastLoginAt: new Date() })
    .where(eq(schema.adminUsers.id, claims.userId));
  await setSessionCookie(claims);
}

/**
 * Re-read an account's claims after a second factor has been accepted.
 *
 * The challenge cookie carries only an id — permissions are deliberately not
 * baked into it, so a role revoked while someone sat at the code prompt does
 * not travel into the session they end up with.
 */
export async function claimsForUser(userId: number): Promise<SessionClaims | null> {
  const db = getDb();
  const [user] = await db
    .select()
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.id, userId))
    .limit(1);
  if (!user || user.disabledAt) return null;

  const roleRows = await db
    .select({ permissions: schema.adminRoles.permissions })
    .from(schema.adminUserRoles)
    .innerJoin(schema.adminRoles, eq(schema.adminRoles.id, schema.adminUserRoles.roleId))
    .where(eq(schema.adminUserRoles.userId, user.id));
  if (roleRows.length === 0) return null;

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    locale: user.locale,
    permissions: Array.from(new Set(roleRows.flatMap((row) => row.permissions ?? []))),
  };
}

/**
 * Authenticate email + password, and set the session cookie **only when there
 * is no second factor left to satisfy**.
 *
 * `requireMfa` is the site-wide policy, passed in rather than read here: the
 * setting lives in `core/settings` and the route is where the other
 * cross-cutting reads for this endpoint already happen.
 *
 * Rate limiting is applied at the login *route* (createRoute rateLimit),
 * fixing v1's unthrottled login (BACKEND.md §13.8).
 */
export async function loginWithPassword(
  email: string,
  password: string,
  opts: { requireMfa?: boolean } = {},
): Promise<LoginResult> {
  const result = await verifyCredentials(email, password);
  if (!result.ok) return { status: 'fail', reason: result.reason };

  const { claims, mfaMethod } = result.credentials;

  if (mfaMethod === 'totp' || mfaMethod === 'email') {
    return { status: 'mfa', userId: claims.userId, email: claims.email, method: mfaMethod };
  }
  if (opts.requireMfa) {
    return { status: 'enroll', userId: claims.userId, email: claims.email };
  }

  await issueSession(claims);
  return { status: 'ok', user: claims };
}
