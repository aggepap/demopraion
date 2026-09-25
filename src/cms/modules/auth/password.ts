/**
 * Password hashing. Ported unchanged from v1. Not `server-only` — the
 * create-admin CLI uses it outside a request context.
 */
import bcrypt from 'bcryptjs';

import { MIN_PASSWORD_LENGTH } from './password-policy';

const BCRYPT_COST = 12;

export { MIN_PASSWORD_LENGTH };

export async function hashPassword(plaintext: string): Promise<string> {
  if (plaintext.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  return bcrypt.hash(plaintext, BCRYPT_COST);
}

export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  if (!plaintext || !hash) return false;
  try {
    return await bcrypt.compare(plaintext, hash);
  } catch {
    return false;
  }
}
