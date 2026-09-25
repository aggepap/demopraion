/**
 * Booking references and payment tokens — pure, so both are testable and
 * neither depends on the database.
 *
 * A reference (`BKG-2026-7F3K9QMX`) is a public identifier: it goes in emails,
 * on invoices, and gets read out over the phone. A payment token is a bearer
 * credential. They are generated separately and deliberately: a credential you
 * say out loud is not a credential.
 */
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

/**
 * Crockford base32 — no I, L, O or U.
 *
 * The vowel is dropped so the alphabet cannot spell a word by accident, and the
 * ambiguous letters because these get read aloud and written down: 0/O and 1/I/L
 * are the pairs people actually get wrong.
 */
export const REFERENCE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function randomChars(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += REFERENCE_ALPHABET[bytes[i] % REFERENCE_ALPHABET.length];
  }
  return out;
}

/** The random half of a reference. 8 chars of a 32-letter alphabet ≈ 40 bits. */
export function referenceSuffix(length = 8): string {
  return randomChars(length);
}

/**
 * A booking reference: `BKG-<year>-<random>`.
 *
 * The year is there so a human can date a reference at a glance; the random part
 * is what makes it unguessable. Deliberately NOT sequential — a sequential
 * number tells every customer how many bookings the business has taken, and lets
 * anyone enumerate the others.
 */
export function formatBookingReference(year: number, suffix = referenceSuffix()): string {
  return `BKG-${year}-${suffix}`;
}

const REFERENCE_RE = /^BKG-\d{4}-[0-9A-HJKMNP-TV-Z]{6,16}$/;

export function isBookingReference(value: unknown): boolean {
  return typeof value === 'string' && REFERENCE_RE.test(value.trim().toUpperCase());
}

/** Normalise what someone typed: references are read off paper and re-keyed. */
export function normalizeReference(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * A payment-link token: 20 random bytes ≈ 160 bits, base32-encoded.
 *
 * Stored only as a hash (see `hashToken`), so a database dump or a stray log
 * line does not yield a working payment link.
 */
export function paymentToken(): string {
  return randomChars(32);
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Constant-time comparison of two hex digests.
 *
 * Constant-time because a plain `===` leaks how much of a guessed token was
 * right through how long the comparison took. Length is checked first, since
 * `timingSafeEqual` throws on a mismatch — that check leaks only the length,
 * which is fixed and public anyway.
 */
export function tokenMatches(candidateHash: string, storedHash: string | null | undefined): boolean {
  if (!storedHash || candidateHash.length !== storedHash.length) return false;
  try {
    return timingSafeEqual(Buffer.from(candidateHash, 'hex'), Buffer.from(storedHash, 'hex'));
  } catch {
    return false;
  }
}

/** Is a stored payment token still usable? */
export function isTokenLive(
  storedHash: string | null | undefined,
  expiresAt: Date | null | undefined,
  now = new Date(),
): boolean {
  if (!storedHash) return false;
  return !expiresAt || expiresAt.getTime() > now.getTime();
}
