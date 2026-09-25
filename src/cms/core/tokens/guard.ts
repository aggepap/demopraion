import 'server-only';

import { type NextRequest, NextResponse } from 'next/server';

import { isSameOrigin } from '../api/same-origin';
import { requireApiPerm } from '../../modules/auth/guards';
import { hasPerm } from '../../modules/auth/permissions';
import { checkRateLimit, clientIpLabel } from '../rate-limit';
import { claimNonce } from './replay';
import { findActiveToken, touchApiToken } from './service';
import {
  computeSignature,
  HEADER_KEY_ID,
  HEADER_NONCE,
  HEADER_SIGNATURE,
  HEADER_TIMESTAMP,
  NONCE_PATTERN,
  signatureMatches,
  timestampInWindow,
} from './signature';

/**
 * The bridge's authentication guard: a signed machine request, or a logged-in
 * human with the equivalent permission.
 *
 * Keeping the session path alive is what makes these endpoints debuggable from a
 * browser — otherwise the only way to see what PM sees is to reimplement the
 * signing scheme by hand.
 */

const KEY_ID_PATTERN = /^[0-9a-f]{12}$/;

export interface TokenPrincipal {
  kind: 'token';
  /** Always null: `documents.updated_by` and `audit_logs.user_id` take it. */
  userId: null;
  tokenId: number;
  /** `api-token:<name>` — what the audit log shows instead of a blank actor. */
  actorLabel: string;
  scopes: string[];
}

export interface SessionPrincipal {
  kind: 'session';
  userId: number;
  actorLabel: string;
  permissions: string[];
  /** A human holding the permission may do anything a token may. */
  scopes: string[];
}

export type BridgePrincipal = TokenPrincipal | SessionPrincipal;

/** What a bridge route's `auth` slot carries: who, plus the body they signed. */
export interface BridgeAuth {
  principal: BridgePrincipal;
  /** Raw request body, exactly as received and exactly as hashed. */
  rawBody: string;
  /** `JSON.parse(rawBody)`, or undefined when the body was empty. */
  body: unknown;
  ip: string;
}

/**
 * All four failure modes answer with this, byte for byte.
 *
 * Unknown key id, bad signature, stale timestamp and replayed nonce are one
 * response to the caller and four distinct lines in the server log. Telling a
 * prober which of the four they tripped is free reconnaissance; telling the
 * operator is the entire point of keeping logs. PM maps any 401 to
 * `TokenInvalid` → "reconnect this site", which is the right remedy for all four.
 */
const unauthorized = () =>
  NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

const forbidden = (missing: string) =>
  NextResponse.json({ ok: false, error: 'forbidden', missing }, { status: 403 });

/**
 * Refuse to operate over plain HTTP in production.
 *
 * A refusal rather than a warning. Signing keeps the secret off the wire, but
 * plain HTTP still leaves every request tamperable in flight and every response
 * readable. Localhost and `.test`/`.local` are exempt so development works,
 * matching the carve-out the WordPress plugin already makes.
 */
export function transportAllowed(req: NextRequest): boolean {
  if (process.env.NODE_ENV !== 'production') return true;

  const url = new URL(req.url);
  if (url.protocol === 'https:') return true;

  // A TLS-terminating proxy leaves the origin request on http.
  if ((req.headers.get('x-forwarded-proto') ?? '').split(',')[0].trim() === 'https') return true;

  const host = url.hostname.toLowerCase();
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.test') ||
    host.endsWith('.local')
  );
}

export interface BridgeGuardOptions {
  /** The scope a token must hold, e.g. `pm:write`. */
  scope: string;
  /** The permission a session must hold instead, e.g. `PERMISSIONS.contentWrite`. */
  perm: string;
}

/**
 * Build a `createRoute`-compatible guard.
 *
 * ## Why this reads the body
 *
 * The signature covers a hash of the body, and a `Request` body can only be
 * consumed once. `createRoute` reads it at the `input` stage — *after* the guard
 * — so bridge routes deliberately set no `input` schema and let this guard do
 * the single read. The handler then validates `auth.body` with its own zod
 * schema. If verification hashed one representation and the handler acted on
 * another, the signature would be decorative.
 */
export function requireSignatureOrSession(opts: BridgeGuardOptions) {
  return async function guard(req: NextRequest): Promise<BridgeAuth | NextResponse> {
    if (!transportAllowed(req)) {
      console.warn('[cms/pm] refused a bridge request over plain HTTP');
      return unauthorized();
    }

    // A label for the signed-request audit trail, not a bucket key — the rate
    // limit below is per token id, which is the identity that actually matters.
    const ip = clientIpLabel(req);
    const method = req.method.toUpperCase();
    const rawBody = method === 'GET' || method === 'HEAD' ? '' : await req.text();

    const keyId = req.headers.get(HEADER_KEY_ID);

    const principal = keyId
      ? await verifySigned(req, keyId, rawBody, ip, opts)
      : await verifySession(req, opts);

    if (principal instanceof NextResponse) return principal;

    let body: unknown;
    if (rawBody) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        return NextResponse.json(
          { ok: false, error: 'invalid_json', message: 'Request body is not valid JSON.' },
          { status: 400 },
        );
      }
    }

    return { principal, rawBody, body, ip };
  };
}

/**
 * The signed path, in the order §3.1a fixes.
 *
 * Everything cheap and non-secret happens before anything expensive or
 * secret-dependent, so an unauthenticated flood cannot be turned into a query
 * flood or a crypto flood.
 */
async function verifySigned(
  req: NextRequest,
  keyId: string,
  rawBody: string,
  ip: string,
  opts: BridgeGuardOptions,
): Promise<BridgePrincipal | NextResponse> {
  const timestampRaw = req.headers.get(HEADER_TIMESTAMP);
  const nonce = req.headers.get(HEADER_NONCE);
  const signature = req.headers.get(HEADER_SIGNATURE);

  // 1. All four headers present.
  if (!timestampRaw || !nonce || !signature) {
    console.warn('[cms/pm] signed request missing one of the four required headers');
    return unauthorized();
  }

  // 2. Shape check before any database access.
  if (!KEY_ID_PATTERN.test(keyId) || !NONCE_PATTERN.test(nonce)) {
    console.warn('[cms/pm] malformed key id or nonce; refused without a lookup');
    return unauthorized();
  }

  // 3. Clock window. Bounds the replay cache.
  const timestamp = Number(timestampRaw);
  if (!/^\d+$/.test(timestampRaw) || !timestampInWindow(timestamp)) {
    console.warn('[cms/pm] timestamp outside the accepted window for key id', keyId);
    return unauthorized();
  }

  // 4. Load the credential. Unknown, revoked and expired are indistinguishable.
  const token = await findActiveToken(keyId);
  if (!token) {
    console.warn('[cms/pm] no active token for key id', keyId);
    return unauthorized();
  }

  // 5 + 6. Rebuild the canonical string over the bytes as received, and compare
  // the digests in constant time.
  const expected = computeSignature(token.secret, {
    method: req.method,
    url: req.url,
    body: rawBody,
    timestamp,
    nonce,
  });
  if (!signatureMatches(signature, expected)) {
    console.warn('[cms/pm] signature mismatch for key id', keyId);
    return unauthorized();
  }

  // 7. Single-use nonce — claimed only once the request has proved it knows the
  // secret. It ran before the signature check, which meant an unauthenticated
  // caller could spend entries in the replay cache: nonces are caller-chosen and
  // random, so nothing legitimate could realistically be burned that way, but
  // there is no reason for an unverified request to write to the cache at all.
  // The signature comparison is a single HMAC over bytes already in memory, so
  // this costs nothing that the ordering note above was protecting.
  if (!claimNonce(nonce)) {
    console.warn('[cms/pm] replayed nonce for key id', keyId);
    return unauthorized();
  }

  // 8. Scope.
  if (!hasPerm(token.scopes, opts.scope)) {
    return forbidden(opts.scope);
  }

  // Per-token rate limit. This is the meaningful one: `getClientIp` trusts only
  // `x-real-ip` and returns 'unknown' otherwise, so behind a proxy that does not
  // set it every caller on the internet would share a single IP bucket.
  const limit = checkRateLimit('pm-token', String(token.id), { max: 300, windowMs: 60_000 });
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: 'rate_limited', message: 'Too many requests.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  // 9. Telemetry, throttled and fire-and-forget.
  touchApiToken(token.id, ip);

  return {
    kind: 'token',
    userId: null,
    tokenId: token.id,
    actorLabel: `api-token:${token.name}`,
    scopes: token.scopes,
  };
}

/**
 * The session path — and the CSRF check that goes with it.
 *
 * Bridge routes set `sameOrigin: false` on the factory, because a signed request
 * legitimately carries no `Origin` and `isSameOrigin` passes header-less callers
 * anyway. That default would make the session path silently CSRF-exposed, so the
 * check is done here instead, where it applies to exactly the principal that
 * needs it: a browser sends cookies automatically but cannot forge an HMAC it has
 * no secret for.
 */
async function verifySession(
  req: NextRequest,
  opts: BridgeGuardOptions,
): Promise<BridgePrincipal | NextResponse> {
  const method = req.method.toUpperCase();
  const isWrite = method !== 'GET' && method !== 'HEAD';
  if (isWrite && !isSameOrigin(req)) {
    return NextResponse.json(
      { ok: false, error: 'forbidden', message: 'Cross-origin request rejected.' },
      { status: 403 },
    );
  }

  const auth = await requireApiPerm(opts.perm);
  if (auth instanceof NextResponse) return auth;

  return {
    kind: 'session',
    userId: auth.userId,
    actorLabel: `user:${auth.email}`,
    permissions: auth.permissions,
    // A human with the permission may do anything a token may — the permission
    // check above is the real gate, so re-checking a scope here would be a
    // second, weaker copy of the same decision.
    scopes: ['pm:*'],
  };
}
