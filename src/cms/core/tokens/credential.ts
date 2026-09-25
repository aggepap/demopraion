/**
 * Parsing the credential Product Manager hands over.
 *
 * Praion never generates one of these — PM mints it and shows it once, and this
 * is the code that accepts the paste. Two forms are understood:
 *
 *   1. the **setup string** — unpadded base64url of
 *      `{"key_id":…,"secret":…,"site_url":…}`, which is what PM's
 *      `CmsConnectionController::setupCredentials()` emits;
 *   2. a bare **`pmk_<keyId>_<secret>`**, which is the same credential written
 *      the way PM's own connection form and error messages spell it.
 *
 * Accepting both costs one branch and saves an operator who has the key but has
 * already spent the one-time reveal.
 *
 * ## The key id is hex, and that is load-bearing
 *
 * `pmk_<keyId>_<secret>` is split on `_`, and base64url's alphabet *contains*
 * `_`. A base64url key id would have made roughly one credential in sixteen
 * unparseable. PM enforces the identical regex in `App\Support\Pm\PraionCredential`.
 *
 * Pure functions, no `server-only` — the import route and the tests both use them.
 */

/** 12 lowercase hex chars. Matches PM's `PraionCredential::PATTERN`. */
export const KEY_ID_PATTERN = /^[0-9a-f]{12}$/;

/** 32–128 base64url chars. PM mints 43 (32 random bytes). */
export const SECRET_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

/** The whole credential as one string. */
export const CREDENTIAL_PATTERN = /^pmk_([0-9a-f]{12})_([A-Za-z0-9_-]{32,128})$/;

export interface ParsedCredential {
  keyId: string;
  secret: string;
  /** Present only when the paste was a setup string; used to refuse a wrong-site paste. */
  siteUrl: string | null;
}

/**
 * The one error type this module throws, so the import route can turn any
 * failure into a message an operator can act on rather than a stack trace.
 */
export class CredentialParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialParseError';
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Accept either supported form and return the two halves.
 *
 * Throws `CredentialParseError` with operator-facing wording — never echoing the
 * pasted value back, because the thing that failed to parse may still be a live
 * secret and error messages end up in logs and screenshots.
 */
export function parseCredential(input: string): ParsedCredential {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new CredentialParseError('Paste the setup string from Product Manager.');
  }

  const direct = CREDENTIAL_PATTERN.exec(trimmed);
  if (direct) {
    return { keyId: direct[1], secret: direct[2], siteUrl: null };
  }

  // Not a bare key, so it should be a setup string. A value that merely *starts*
  // with `pmk_` is a mangled key rather than base64url, and saying so is more
  // useful than "could not decode".
  if (trimmed.startsWith('pmk_')) {
    throw new CredentialParseError(
      'That looks like a Praion API key but it is not complete. Copy the whole value, ' +
        'including the "pmk_" prefix and everything after it.',
    );
  }

  let decoded: string;
  try {
    decoded = Buffer.from(trimmed, 'base64url').toString('utf8');
  } catch {
    throw new CredentialParseError('That is not a valid setup string from Product Manager.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    throw new CredentialParseError('That is not a valid setup string from Product Manager.');
  }

  if (!isRecord(parsed)) {
    throw new CredentialParseError('That is not a valid setup string from Product Manager.');
  }

  const keyId = typeof parsed.key_id === 'string' ? parsed.key_id : '';
  const secret = typeof parsed.secret === 'string' ? parsed.secret : '';
  const siteUrl = typeof parsed.site_url === 'string' ? parsed.site_url : null;

  if (!KEY_ID_PATTERN.test(keyId) || !SECRET_PATTERN.test(secret)) {
    throw new CredentialParseError(
      'That setup string is malformed. Generate a new one in Product Manager and paste it again.',
    );
  }

  return { keyId, secret, siteUrl };
}

/**
 * Do two origins refer to the same site?
 *
 * Compared on origin alone, lowercased, ignoring a trailing slash and any path —
 * PM stores a `base_url` that an operator may have typed with or without one.
 * A genuinely different host still fails, which is the case that matters: a
 * setup string pasted into the wrong site should be refused here rather than
 * discovered later as an unexplained signature mismatch.
 */
export function sameSite(a: string, b: string): boolean {
  try {
    const left = new URL(a);
    const right = new URL(b);
    return left.protocol === right.protocol && left.host.toLowerCase() === right.host.toLowerCase();
  } catch {
    return false;
  }
}
