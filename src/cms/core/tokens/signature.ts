/**
 * The PM-HMAC-SHA256 request signature.
 *
 * **This format is frozen.** Product Manager computes it byte-for-byte in
 * `App\Services\Pm\Cms\Praion\PraionRequestSigner::canonicalString()`; changing
 * either side alone breaks every call with an opaque 401. The golden vectors in
 * `test/core/pm-signature.test.ts` exist to make a drift fail there instead of
 * in production.
 *
 * ## Why sign at all, rather than send a bearer token
 *
 * A bearer token is a reusable write credential for every published page, spelled
 * out on every single request — in a proxy's access log, a WAF trace, an APM
 * payload capture, a HAR file, a `curl -v` pasted into a ticket. A signature
 * proves the sender knows the secret instead of containing it, expires in five
 * minutes, and cannot be replayed or tampered with even inside that window.
 *
 * ## What each component buys
 *
 * Each line blocks one specific rewrite of a captured request:
 *
 * - **method** — a `GET` cannot be replayed as a `PATCH`
 * - **host** — a signature for one site cannot be aimed at another
 * - **path + query** — a page number or document id cannot be altered
 * - **timestamp + nonce** — expiry and single use
 * - **body hash** — a proxy cannot change what gets written
 *
 * The algorithm label keeps a future scheme from ever colliding with this one.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** Frozen. Line 1 of every canonical string. */
export const ALGORITHM_LABEL = 'PM-HMAC-SHA256';

/** How far apart the two clocks may be before a request is refused. */
export const CLOCK_SKEW_SECONDS = 300;

export const HEADER_KEY_ID = 'x-pm-key-id';
export const HEADER_TIMESTAMP = 'x-pm-timestamp';
export const HEADER_NONCE = 'x-pm-nonce';
export const HEADER_SIGNATURE = 'x-pm-signature';

/** PM sends `bin2hex(random_bytes(16))` — exactly 32 lowercase hex chars. */
export const NONCE_PATTERN = /^[0-9a-f]{32}$/;

export interface CanonicalParts {
  method: string;
  /** Full request URL, exactly as received. */
  url: string;
  /** Raw body bytes as a string; `''` for GET. */
  body: string;
  timestamp: number;
  nonce: string;
}

/**
 * Build the seven-line canonical string, joined with `\n` and no trailing newline.
 *
 * The host keeps a non-default port because `example.test` and
 * `example.test:8443` are different origins and must not share a signature. PHP's
 * `parse_url` only reports a port when the URL spelled one out, and `URL` always
 * leaves `port` empty for the scheme's default — the two agree.
 *
 * The path and query are taken **verbatim**, never re-encoded: PM builds the
 * query with `http_build_query` and signs that exact text, so normalising it here
 * would change the bytes under the signature.
 */
export function canonicalString(parts: CanonicalParts): string {
  const url = new URL(parts.url);

  const host = url.port
    ? `${url.hostname.toLowerCase()}:${url.port}`
    : url.hostname.toLowerCase();

  // `url.search` includes the leading `?` and is empty when there is no query,
  // which matches PHP appending `'?'.$query` only for a non-empty query string.
  const pathQuery = `${url.pathname || '/'}${url.search}`;

  return [
    ALGORITHM_LABEL,
    parts.method.toUpperCase(),
    host,
    pathQuery,
    String(parts.timestamp),
    parts.nonce,
    sha256Hex(parts.body),
  ].join('\n');
}

/** Lowercase hex sha256, matching PHP's `hash('sha256', $body)`. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * The expected signature for these parts under this secret.
 *
 * The HMAC key is the base64url secret **as a string**, not decoded to bytes —
 * PHP passes `$credential->secret` straight to `hash_hmac`, and decoding here
 * would produce a different digest from the same credential.
 */
export function computeSignature(secret: string, parts: CanonicalParts): string {
  return createHmac('sha256', secret).update(canonicalString(parts), 'utf8').digest('hex');
}

/**
 * Compare a presented `X-PM-Signature` against the expected digest.
 *
 * Accepts the `sha256=` prefix PM sends and tolerates its absence. The digests
 * are compared with `timingSafeEqual` over their raw bytes; a hex-length
 * mismatch short-circuits, because the length of a signature is not a secret.
 */
export function signatureMatches(presented: string | null, expectedHex: string): boolean {
  if (!presented) return false;
  const offered = presented.startsWith('sha256=') ? presented.slice(7) : presented;
  if (!/^[0-9a-f]+$/i.test(offered) || offered.length !== expectedHex.length) return false;
  const a = Buffer.from(offered.toLowerCase(), 'hex');
  const b = Buffer.from(expectedHex, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Is this timestamp inside the accepted window? Bounds the replay cache. */
export function timestampInWindow(timestamp: number, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  if (!Number.isFinite(timestamp)) return false;
  return Math.abs(nowSeconds - timestamp) <= CLOCK_SKEW_SECONDS;
}
