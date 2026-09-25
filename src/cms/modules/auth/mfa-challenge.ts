import 'server-only';

import { type JWTPayload, jwtVerify, SignJWT } from 'jose';
import { cookies } from 'next/headers';

/**
 * The half-authenticated state between "password accepted" and "second factor
 * accepted".
 *
 * ## Why a separate token, not a flag on the session
 *
 * Whatever the browser holds between the two steps is proof that the password
 * step passed. If that proof can be presented as a session cookie, the second
 * factor is decorative — moving one cookie's value into another would skip it.
 * So this is its own JWT with its own AUDIENCE: `verifySession` rejects a
 * challenge and `verifyMfaChallenge` rejects a session, both at the signature
 * layer, before any claim is read.
 *
 * ## Why the same secret
 *
 * `ADMIN_SESSION_SECRET`, not a new variable, for the reason
 * `core/email/unsubscribe.ts` already gives: every additional required env var
 * is a deploy that can half-work. Domain separation here comes from the
 * audience, which is checked cryptographically, not from key material.
 *
 * Ten minutes because a token that proves a password is correct is a
 * credential, and reading a code off a phone does not take longer than that.
 */
const COOKIE_NAME = 'cms_mfa';
const ISSUER = 'cms';
const AUDIENCE = 'cms-admin-mfa';

export const MFA_CHALLENGE_COOKIE_NAME = COOKIE_NAME;
export const MFA_CHALLENGE_TTL_SECONDS = 10 * 60;

/** What the challenge is for: completing a login, or completing a forced enrollment. */
export type MfaChallengePurpose = 'verify' | 'enroll';

export interface MfaChallengeClaims {
  userId: number;
  email: string;
  purpose: MfaChallengePurpose;
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

export async function signMfaChallenge(
  claims: MfaChallengeClaims,
  ttlSeconds: number = MFA_CHALLENGE_TTL_SECONDS,
): Promise<string> {
  return (
    new SignJWT(claims as unknown as JWTPayload)
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt()
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      // Absolute epoch seconds rather than a relative `${n}s` string, so the
      // tests can mint an already-expired token and assert it is refused.
      .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
      .sign(getSecret())
  );
}

/**
 * Verify a challenge token. Returns `null` for anything that is not one.
 *
 * The claim shape is checked by hand, exactly as `session.ts` does: a field
 * that is not validated is a field whoever holds the signing key — or finds a
 * way to make us sign something — gets to choose. `purpose` in particular gates
 * which routes the token opens, so an unknown value must be a rejection rather
 * than a value that falls through a switch.
 */
export async function verifyMfaChallenge(token: string): Promise<MfaChallengeClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret(), { issuer: ISSUER, audience: AUDIENCE });
    if (
      typeof payload.userId === 'number' &&
      typeof payload.email === 'string' &&
      (payload.purpose === 'verify' || payload.purpose === 'enroll')
    ) {
      return { userId: payload.userId, email: payload.email, purpose: payload.purpose };
    }
    return null;
  } catch {
    return null;
  }
}

export async function setMfaChallengeCookie(claims: MfaChallengeClaims): Promise<void> {
  const token = await signMfaChallenge(claims);
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MFA_CHALLENGE_TTL_SECONDS,
  });
}

export async function clearMfaChallengeCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export async function readMfaChallengeCookie(): Promise<MfaChallengeClaims | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyMfaChallenge(token);
}
