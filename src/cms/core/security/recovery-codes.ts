/**
 * One-time recovery codes — the way back in when the authenticator is gone.
 *
 * These are shown exactly once, at enrollment, and stored only as bcrypt
 * hashes; there is no route that can display them again. That is the whole
 * point of the mechanism, and it is why the two decisions below are about
 * transcription rather than cryptography: a code the user cannot read off the
 * screen and type back correctly is not a recovery path.
 *
 * Pure, and no `server-only` — the CLI escape hatch (`db:reset-mfa`) runs
 * outside a request context, exactly like `modules/auth/password.ts`.
 */
import { randomBytes } from 'node:crypto';

/**
 * The generator alphabet: A–Z and 2–9 with `0 O 1 I L 8 B` removed.
 *
 * Those are the pairs that get misread off a screen. A recovery code is
 * transcribed by hand, usually by someone who has just lost their phone, and an
 * ambiguous glyph turns a valid code into a failed sign-in that the user has no
 * way to distinguish from a wrong one. 29 characters over 8 positions is still
 * ~5e11 combinations, on top of a password the attacker also needs.
 */
const ALPHABET = 'ACDEFGHJKMNPQRSTUVWXYZ2345679';

/** Characters per code, split into two groups for legibility. */
const CODE_LENGTH = 8;
const GROUP_SIZE = 4;

/** How many codes an enrollment hands out. */
export const RECOVERY_CODE_COUNT = 10;

/**
 * Draw one character without modulo bias.
 *
 * `byte % 29` would make the first few letters of the alphabet measurably more
 * likely than the last few. It is a small bias and it would never be noticed,
 * which is precisely why it is worth not having.
 */
function randomChar(): string {
  const limit = 256 - (256 % ALPHABET.length);
  for (;;) {
    const [byte] = randomBytes(1);
    if (byte < limit) return ALPHABET[byte % ALPHABET.length];
  }
}

/** `count` fresh codes, formatted `XXXX-XXXX`. Distinct within the batch. */
export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    let raw = '';
    for (let i = 0; i < CODE_LENGTH; i++) raw += randomChar();
    codes.add(`${raw.slice(0, GROUP_SIZE)}-${raw.slice(GROUP_SIZE)}`);
  }
  return [...codes];
}

/**
 * The form a code is hashed and compared in.
 *
 * Separators and case are stripped because the code makes a round trip through
 * a screen, a piece of paper and a keyboard — or a clipboard that picks up the
 * surrounding whitespace, or a mobile keyboard that lowercases the first
 * letter. Only characters the generator can actually emit survive, so this
 * cannot fold two distinct codes onto the same value.
 */
export function normalizeRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Bring a short one-time code up to a length `hashPassword` will accept.
 *
 * Both kinds of one-time code in this codebase are stored with the same bcrypt
 * helper the passwords use — one hashing primitive, not two — and that helper
 * refuses anything under `MIN_PASSWORD_LENGTH` (10). A recovery code normalises
 * to 8 characters and a mailed code is 6, so both need this.
 *
 * Skipping it is not a subtle failure: enrollment switched the second factor on
 * and then threw while writing the recovery codes, leaving the user with a 500,
 * no codes on screen, and an account that now demanded a factor they had no way
 * back from.
 *
 * The padding character is `.`, which is outside BOTH alphabets — the recovery
 * generator's and the digits a mailed code is drawn from. Padding with `0`
 * looked equivalent and is not: `0` is a legal digit, so `123456` and
 * `12345600` pad to the same string and would verify against each other's
 * hash. A character neither kind of code can contain makes that collision
 * impossible rather than merely unlikely.
 *
 * The padding is constant, so it tells an attacker nothing they did not
 * already know.
 */
const PAD_CHAR = '.';

export function padForHash(value: string): string {
  return value.padEnd(10, PAD_CHAR);
}
