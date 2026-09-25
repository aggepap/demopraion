/**
 * One-time email links: "confirm your address" and "set a new password".
 *
 * The secret in the link is the credential, so the database stores only its
 * sha256 — a leaked table must not hand an attacker a working reset link for
 * every account. sha256 rather than bcrypt on purpose: the token is 256 bits of
 * randomness, so there is nothing to slow down guessing of, and the lookup has
 * to be a single indexed read.
 */
import { createHash, randomBytes } from 'node:crypto';

import type { CustomerTokenPurpose } from '../../db/adapters/mysql/schema/customers';

export type { CustomerTokenPurpose };

/**
 * How long each link lives. A reset link takes over an account, so it is
 * measured in an hour; a verification link is sent once at registration and
 * often opened the next morning.
 */
export const CUSTOMER_TOKEN_TTL_SECONDS: Record<CustomerTokenPurpose, number> = {
  verify_email: 24 * 60 * 60,
  reset_password: 60 * 60,
};

export interface CustomerTokenRow {
  id: number;
  customerId: number;
  purpose: CustomerTokenPurpose;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
}

export function hashCustomerToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** A fresh secret (URL-safe, for an email link) and the hash to store. */
export function newCustomerToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashCustomerToken(token) };
}

export function tokenExpiry(purpose: CustomerTokenPurpose, now: Date): Date {
  return new Date(now.getTime() + CUSTOMER_TOKEN_TTL_SECONDS[purpose] * 1000);
}

/** Single use and time-limited: both checks live here so no caller forgets one. */
export function isTokenUsable(row: CustomerTokenRow | null | undefined, now: Date): boolean {
  if (!row) return false;
  if (row.usedAt !== null) return false;
  return row.expiresAt.getTime() > now.getTime();
}
