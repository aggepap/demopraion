import 'server-only';

import { type JWTPayload, jwtVerify, SignJWT } from 'jose';
import { cookies } from 'next/headers';

import { sessionIdleSeconds, type SessionTiming } from './session-idle';

/**
 * Stateless JWT session (HS256, jose) in an httpOnly cookie. Ported from v1
 * `src/admin/lib/auth/session.ts` with a site-agnostic cookie name.
 *
 * The JWT carries identity + a permissions snapshot (for fast page-chrome
 * rendering). Security-critical API checks re-load permissions from the DB
 * (see `guards.ts`), so a stale snapshot never grants access it shouldn't.
 *
 * ## Two deadlines
 *
 * `exp` rides the IDLE window and is pushed forward as the user works; the
 * `abs` claim is the absolute cap from sign-in and is never extended. See
 * `session-idle.ts` for why both are needed. `exp` is always <= `abs`, so jose's
 * own expiry check fires first and the `abs` check below is a belt.
 */
const COOKIE_NAME = 'cms_session';
const ISSUER = 'cms';
const AUDIENCE = 'cms-admin';

export interface SessionClaims {
  userId: number;
  email: string;
  name: string;
  permissions: string[];
  locale: string;
}

function getSecret(): Uint8Array {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'ADMIN_SESSION_SECRET is missing or shorter than 32 characters. ' +
        'Generate one with `openssl rand -base64 48` and set it in .env.local.',
    );
  }
  return new TextEncoder().encode(secret);
}

/**
 * The ABSOLUTE lifetime — how long a session may live from sign-in however
 * active the user is. Unchanged in meaning; it is simply no longer the only
 * clock.
 */
function getTtlSeconds(): number {
  const hours = Number(process.env.ADMIN_SESSION_TTL_HOURS ?? 8);
  return Math.max(1, Math.floor(hours * 3600));
}

/**
 * Sign a session.
 *
 * `absoluteExpiry` is carried across a refresh so a renewed token inherits the
 * ORIGINAL cap rather than starting a new one — that is the difference between
 * a sliding session and one that lives forever.
 */
export async function signSession(
  claims: SessionClaims,
  opts: { absoluteExpiry?: number; expiresAt?: number } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const abs = opts.absoluteExpiry ?? now + getTtlSeconds();
  const exp = Math.min(opts.expiresAt ?? now + sessionIdleSeconds(), abs);

  return new SignJWT({ ...claims, abs } as unknown as JWTPayload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(exp)
    .sign(getSecret());
}

/** Claims plus the two timestamps the idle logic needs. */
export interface SessionState extends SessionTiming {
  claims: SessionClaims;
}

/**
 * Verify a session and return its claims AND its timing.
 *
 * The timing is what `requireApiAuth` needs to decide whether to slide the
 * window forward. `verifySession` stays as it was for every caller that only
 * wants to know who this is.
 */
export async function verifySessionState(token: string): Promise<SessionState | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), { issuer: ISSUER, audience: AUDIENCE });
    if (
      typeof payload.userId === 'number' &&
      typeof payload.email === 'string' &&
      typeof payload.name === 'string' &&
      Array.isArray(payload.permissions) &&
      typeof payload.locale === 'string'
    ) {
      const now = Math.floor(Date.now() / 1000);
      const issuedAt = typeof payload.iat === 'number' ? payload.iat : now;
      /*
       * A token with no `abs` is one issued before this feature existed. It is
       * otherwise valid and its holder is signed in, so it is honoured — but
       * given a cap starting now rather than an unbounded one. Treating a
       * missing cap as "no cap" would leave every pre-existing session
       * permanently renewable.
       */
      const absoluteExpiry =
        typeof payload.abs === 'number' ? payload.abs : issuedAt + getTtlSeconds();
      if (now >= absoluteExpiry) return null;

      return {
        issuedAt,
        absoluteExpiry,
        claims: {
          userId: payload.userId,
          email: payload.email,
          name: payload.name,
          permissions: (payload.permissions as unknown[]).filter(
            (p): p is string => typeof p === 'string',
          ),
          locale: payload.locale,
        },
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function verifySession(token: string): Promise<SessionClaims | null> {
  return (await verifySessionState(token))?.claims ?? null;
}

export async function setSessionCookie(
  claims: SessionClaims,
  opts: { absoluteExpiry?: number; expiresAt?: number } = {},
): Promise<void> {
  const token = await signSession(claims, opts);
  const now = Math.floor(Date.now() / 1000);
  const abs = opts.absoluteExpiry ?? now + getTtlSeconds();
  const exp = Math.min(opts.expiresAt ?? now + sessionIdleSeconds(), abs);

  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    // Matches the token's own `exp`. A cookie that outlives its JWT is a
    // request that looks authenticated to the browser and is rejected by the
    // server, which reads to the user as a random logout.
    maxAge: Math.max(1, exp - now),
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export async function readSessionCookie(): Promise<SessionClaims | null> {
  return (await readSessionState())?.claims ?? null;
}

export async function readSessionState(): Promise<SessionState | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionState(token);
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
