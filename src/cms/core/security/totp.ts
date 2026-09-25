/**
 * RFC 6238 time-based one-time passwords, over `node:crypto`.
 *
 * ## Why not a library
 *
 * TOTP is HMAC-SHA1 over a 64-bit counter plus the dynamic truncation in RFC
 * 4226 §5.3 — the whole algorithm is the fifty lines below, and it is pinned by
 * published test vectors, so "did we get it right" is answerable without
 * trusting anyone. The rest of this core already prefers pure `node:crypto` for
 * exactly this class of thing (`tokens/crypto.ts`, `email/unsubscribe.ts`), and
 * an authenticator seed is not where a transitive dependency tree earns its
 * keep.
 *
 * ## Pure, and no `server-only`
 *
 * Split the way `security/captcha.ts` is: everything here is a function of its
 * arguments, so the unit tests exercise the real algorithm against the RFC
 * vectors. Reading the stored secret and recording the spent step are the
 * caller's job — see `core/routes/auth-mfa.ts`.
 */
import { createHmac, randomBytes } from 'node:crypto';

import { timingSafeEquals } from '../tokens/crypto';

/** RFC 4648 base32. No 0/1/8 — they are absent so O/I/B cannot be confused. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** The step width every authenticator app assumes. Not configurable for that reason. */
export const TOTP_STEP_SECONDS = 30;

/** Digits shown by the app, and expected back from the user. */
export const TOTP_DIGITS = 6;

/**
 * Steps either side of "now" that are still accepted.
 *
 * One, not more. Phone clocks drift by seconds, not minutes, and every extra
 * step is another thirty seconds during which a code someone else has seen is
 * still good. `lastStep` bounds that further — see `verifyTotp`.
 */
export const TOTP_WINDOW = 1;

/** Bytes of entropy in a generated secret. 160 bits, as RFC 4226 §4 R6 requires. */
const SECRET_BYTES = 20;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/**
 * Decode base32, forgiving the formatting a human introduces.
 *
 * Lowercase, the spaces authenticator setup screens put between groups of four,
 * and `=` padding are all stripped: the secret is displayed to be transcribed,
 * so refusing it back in the shape it was shown means telling a user that the
 * string they were just given is invalid. Anything else throws — silently
 * mapping an out-of-alphabet character would yield a key that is wrong in a way
 * nothing downstream can detect.
 */
export function base32Decode(input: string): Buffer {
  const clean = input.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
  if (clean.length === 0) return Buffer.alloc(0);

  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`Invalid base32 character: ${JSON.stringify(char)}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** A fresh base32 secret, ready to be shown in a QR code. */
export function generateTotpSecret(bytes: number = SECRET_BYTES): string {
  return base32Encode(randomBytes(bytes));
}

/**
 * The code for one counter step. `digits` is a parameter only so the tests can
 * check the RFC's 8-digit vectors; everything in the app uses the default.
 */
export function totpCode(secret: string, step: number, digits: number = TOTP_DIGITS): string {
  const key = base32Decode(secret);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));

  const digest = createHmac('sha1', key).update(counter).digest();
  // RFC 4226 §5.3 dynamic truncation. The high bit is masked off because the
  // 31-bit value must be positive on every platform.
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];

  // Padded, not trimmed: roughly one code in ten starts with a zero, and a
  // five-digit string will never match anything the user's phone shows.
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export type TotpResult = { ok: true; step: number } | { ok: false };

/**
 * Verify a submitted code against the secret.
 *
 * `lastStep` is the replay guard and the reason this returns the step it
 * matched: a code is live for up to `2 * TOTP_WINDOW + 1` steps — about ninety
 * seconds — which is long enough for one read over a shoulder, out of a proxy
 * log or off a screenshot to be used a second time. The caller persists the
 * accepted step and passes it back here, and anything at or below it is refused.
 *
 * Never throws. Every argument arrives from a request body or a database
 * column, and a throw on this path is a 500 on the sign-in page.
 */
export function verifyTotp(
  secret: string,
  code: string,
  nowMs: number,
  opts: { window?: number; lastStep?: number | null } = {},
): TotpResult {
  const digits = code.replace(/[\s-]/g, '');
  if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(digits)) return { ok: false };

  let key: Buffer;
  try {
    key = base32Decode(secret);
  } catch {
    return { ok: false };
  }
  // A corrupt or truncated column must fail closed. Verifying against a
  // zero-length key would accept a code anybody could compute.
  if (key.length === 0) return { ok: false };

  const window = opts.window ?? TOTP_WINDOW;
  const current = Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);
  const floor = opts.lastStep ?? null;

  for (let step = current - window; step <= current + window; step++) {
    if (floor !== null && step <= floor) continue;
    if (timingSafeEquals(digits, totpCode(secret, step))) return { ok: true, step };
  }
  return { ok: false };
}

/**
 * The `otpauth://` URI an authenticator app scans.
 *
 * Both halves of the `issuer:account` label are percent-encoded separately, and
 * the colon between them is left literal — that is the shape the Key URI format
 * specifies. Encoding the label as one string would escape the separator and
 * every app would read the whole thing as an account name; not encoding the
 * parts would let a site name containing `/` or `:` silently rewrite which
 * account the entry claims to be for.
 */
export function otpauthUri(opts: { secret: string; account: string; issuer: string }): string {
  const label = `${encodeURIComponent(opts.issuer)}:${encodeURIComponent(opts.account)}`;
  const params = [
    `secret=${opts.secret}`,
    `issuer=${encodeURIComponent(opts.issuer)}`,
    // Spelled out rather than left to defaults: some apps assume SHA1/6/30 and
    // some read the parameters, and a mismatch produces codes that never match.
    'algorithm=SHA1',
    `digits=${TOTP_DIGITS}`,
    `period=${TOTP_STEP_SECONDS}`,
  ];
  return `otpauth://totp/${label}?${params.join('&')}`;
}
