/**
 * The shopper's session token.
 *
 * Deliberately NOT the admin session. Same algorithm, different audience and a
 * different key, derived from `ADMIN_SESSION_SECRET` with HKDF so a deployment
 * has one secret to manage and the two tokens still cannot be swapped: a
 * customer token presented to the admin verifier fails on the signature, before
 * anything looks at its claims.
 *
 * Not `server-only` and free of `next/headers`, so it can be exercised
 * directly; `session.ts` owns the cookie.
 */
import { hkdfSync } from 'node:crypto';

import { type JWTPayload, jwtVerify, SignJWT } from 'jose';

export const CUSTOMER_COOKIE_NAME = 'cms_customer';
const ISSUER = 'cms';
const AUDIENCE = 'cms-customer';

/** How long a shopper stays signed in. Longer than an admin session — the
 *  blast radius is one person's own orders, and a shop that signs people out
 *  every hour is a shop with no returning customers. */
export const CUSTOMER_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface CustomerClaims {
  customerId: number;
  email: string;
  /** Compared against the database on every account request; see the schema. */
  tokenVersion: number;
}

function getKey(): Uint8Array {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'ADMIN_SESSION_SECRET is missing or shorter than 32 characters. ' +
        'Generate one with `openssl rand -base64 48` and set it in .env.local.'
    );
  }
  // A separate key for a separate audience: one secret to rotate, two tokens
  // that can never be mistaken for each other.
  return new Uint8Array(hkdfSync('sha256', secret, 'cms-customer-session', 'customer', 32));
}

export async function signCustomerToken(
  claims: CustomerClaims,
  opts: { expiresAt?: number } = {}
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ ...claims } as unknown as JWTPayload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(opts.expiresAt ?? now + CUSTOMER_SESSION_TTL_SECONDS)
    .sign(getKey());
}

/** Claims, or `null` for anything that is not a currently valid customer token. */
export async function verifyCustomerToken(token: string): Promise<CustomerClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getKey(), { issuer: ISSUER, audience: AUDIENCE });
    if (
      typeof payload.customerId === 'number' &&
      typeof payload.email === 'string' &&
      typeof payload.tokenVersion === 'number'
    ) {
      return {
        customerId: payload.customerId,
        email: payload.email,
        tokenVersion: payload.tokenVersion,
      };
    }
    return null;
  } catch {
    return null;
  }
}
