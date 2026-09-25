/**
 * Encryption at rest for API-token secrets, and the one constant-time
 * comparator the codebase should use.
 *
 * ## Why encrypted rather than hashed
 *
 * The usual answer for a stored credential is a one-way hash, and it does not
 * work here: HMAC verification has to recompute a signature *with* the secret,
 * so the plaintext has to come back. AES-256-GCM under an environment-held key
 * is the honest alternative — a stolen database dump alone yields nothing,
 * because the key was never in the database.
 *
 * GCM rather than CBC so the ciphertext is authenticated: a tampered row fails
 * to decrypt instead of silently yielding a different secret.
 *
 * Pure `node:crypto` and no `server-only`, so the unit tests can exercise it.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // GCM's standard nonce width
const TAG_BYTES = 16;

/** Minimum length for `CMS_TOKEN_ENCRYPTION_KEY`, matching `ADMIN_SESSION_SECRET`. */
export const MIN_KEY_LENGTH = 32;

/**
 * The encryption key, read lazily.
 *
 * Lazy rather than at module load for the same reason `session.ts` does it: a
 * module-scope throw takes down anything that imports the barrel, including
 * screens that have nothing to do with tokens. The bridge's own boot check
 * (`assertTokenEncryptionKey`) is what turns a missing key into a loud failure
 * at the point where it actually matters.
 */
function getKey(): Buffer {
  const raw = process.env.CMS_TOKEN_ENCRYPTION_KEY;
  if (!raw || raw.length < MIN_KEY_LENGTH) {
    throw new Error(
      `CMS_TOKEN_ENCRYPTION_KEY is missing or shorter than ${MIN_KEY_LENGTH} characters. ` +
        'The PM bridge cannot store or read API credentials without it. ' +
        'Note that changing it invalidates every token already imported.',
    );
  }
  // A 32-byte key from an arbitrary-length secret. sha256 rather than a KDF
  // because the input is already a high-entropy environment secret, not a
  // password — there is nothing to stretch.
  return createHash('sha256').update(raw, 'utf8').digest();
}

/**
 * Throw unless the environment can encrypt. Call this where the bridge boots so
 * a misconfigured deploy fails at startup rather than at the first push.
 */
export function assertTokenEncryptionKey(): void {
  getKey();
}

/**
 * `iv ‖ authTag ‖ ciphertext`, base64-encoded.
 *
 * Base64 text rather than raw bytes because drizzle types the `varbinary` column
 * as `string`. The column stays binary, which is what we want — no charset
 * conversion and no case-insensitive collation applied to a credential.
 */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

/**
 * Reverse of `encryptSecret`. Throws on a truncated or tampered value rather
 * than returning something wrong — a failed decrypt must never look like a
 * mismatched signature, because the two have completely different remedies.
 */
export function decryptSecret(stored: string | Buffer | Uint8Array): string {
  const buf =
    typeof stored === 'string'
      ? Buffer.from(stored, 'base64')
      : Buffer.isBuffer(stored)
        ? stored
        : Buffer.from(stored);
  if (buf.length <= IV_BYTES + TAG_BYTES) {
    throw new Error('Stored API token secret is truncated or corrupt.');
  }
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * Constant-time string comparison.
 *
 * Lifted here from the two divergent copies that existed in
 * `modules/commerce/abandoned.ts` and `modules/booking/payments.ts`. Three
 * implementations of a security primitive is three chances to get it wrong.
 *
 * Length is compared first and in variable time on purpose: `timingSafeEqual`
 * throws on a length mismatch, and the length of a credential is not the secret.
 */
export function timingSafeEquals(given: string | null | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
