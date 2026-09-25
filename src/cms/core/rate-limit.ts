/**
 * In-memory token-bucket rate limiter. Ported from the v1 site-level limiter
 * (`src/lib/rate-limit.ts` — the richer of the two v1 copies; the admin-lib
 * duplicate was dropped per BACKEND.md §13.1).
 *
 * Defensive second line behind the reverse proxy's own `limit_req`. Per-process
 * Map (PM2 cluster mode gives each worker its own store — acceptable for the
 * threat model). Only `x-real-ip` is trusted for bucketing; `x-forwarded-for`
 * and `cf-connecting-ip` are attacker-spoofable and would let a per-request
 * random value bypass the limiter entirely.
 */

/**
 * The bucket key for a request.
 *
 * Returns null when no `x-real-ip` is present, and callers must treat that as a
 * refusal rather than a bucket. It used to fall back to the literal string
 * `'unknown'`, which is a single bucket shared by every such request: strip the
 * header and a hundred attackers rate-limit each other instead of themselves,
 * while the first legitimate request from a misconfigured proxy exhausts it for
 * everyone. There is no safe way to bucket a request whose origin you cannot
 * name, so this says so instead of guessing.
 *
 * The value is only trustworthy because the reverse proxy sets it from the real
 * TCP peer. Nginx must therefore OVERWRITE it, never pass a client-sent one
 * through: `proxy_set_header X-Real-IP $remote_addr;` on every location that
 * proxies to this app. `x-forwarded-for` and `cf-connecting-ip` are deliberately
 * not consulted — they are appended to, not replaced, so a per-request random
 * value in either would bypass the limiter entirely.
 */
export function getClientIp(request: Request): string | null {
  const xri = request.headers.get('x-real-ip')?.trim();
  return xri ? xri : null;
}

/**
 * The same value, but for logs and audit rows rather than for bucketing.
 *
 * A missing origin is worth *recording* as "unknown"; it is not worth *counting*
 * as one shared principal, which is why the two uses no longer share a function.
 *
 * ## The development fallback
 *
 * `x-real-ip` is set by the reverse proxy, so running the app directly — which
 * is every local `npm run dev` — leaves it absent and wrote `unknown` into
 * every audit row. The forensic column was blank in exactly the environment
 * where somebody is most likely reading it to work out what a feature just did.
 *
 * Next's own server synthesises `x-forwarded-for` from the socket when the
 * client does not send one, so in development it is a usable address. It is NOT
 * usable in production: Next passes a client-supplied `x-forwarded-for` through
 * unchanged, so honouring it there would write an attacker-chosen address into
 * the forensic record — worse than recording nothing, because it looks
 * authoritative. Hence the environment check, and hence this fallback living in
 * the LABEL and not in `getClientIp`: refusing to bucket an unidentifiable
 * request is a security property and stays exactly as it was.
 *
 * If production rows say `unknown`, the fix is in the proxy, not here —
 * `proxy_set_header X-Real-IP $remote_addr;`.
 */
export function clientIpLabel(request: Request): string {
  const trusted = getClientIp(request);
  if (trusted) return trusted;

  if (process.env.NODE_ENV !== 'production') {
    // First hop only. The header is a comma-separated chain, and storing it raw
    // puts a list into a column every reader treats as a single address.
    const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded) return forwarded;
  }
  return 'unknown';
}

/** Warn once per process rather than once per request when the header is missing. */
let warnedMissingIp = false;

export interface RateLimitConfig {
  /** Max requests per window per IP. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Epoch ms when the bucket resets. */
  resetAt: number;
  /** Seconds to wait before retrying — for the `Retry-After` header. 0 when allowed. */
  retryAfterSeconds: number;
}

interface BucketEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, Map<string, BucketEntry>>();

const CLEANUP_INTERVAL_MS = 60 * 1000;
let cleanupTimer: NodeJS.Timeout | null = null;
function ensureCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [scope, buckets] of store) {
      for (const [ip, entry] of buckets) {
        if (entry.resetAt < now) buckets.delete(ip);
      }
      if (buckets.size === 0) store.delete(scope);
    }
  }, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref?.();
}

/**
 * Check the bucket for `ip` under namespace `scope`. Scopes let different
 * routes use independent stores.
 */
export function checkRateLimit(
  scope: string,
  ip: string | null,
  config: RateLimitConfig,
): RateLimitResult {
  ensureCleanup();

  const now = Date.now();

  /*
   * No identifiable origin → refuse, in production.
   *
   * This is the same posture `isSameOrigin` takes for a missing
   * `NEXT_PUBLIC_SITE_URL`: a deployment whose proxy is not setting `X-Real-IP`
   * has lost the limiter entirely, and doing that silently means the one
   * environment where it matters is the one environment without it. Refusing is
   * loud, immediate and fixed by a single nginx directive
   * (`proxy_set_header X-Real-IP $remote_addr;`). Development has no proxy in
   * front of it at all, so there the request falls into a single shared bucket
   * and the warning is the thing that carries the message.
   */
  if (ip === null) {
    if (!warnedMissingIp) {
      warnedMissingIp = true;
      console.warn(
        '[cms] No X-Real-IP on an incoming request — rate limiting cannot bucket by origin. ' +
          'Set `proxy_set_header X-Real-IP $remote_addr;` on the reverse proxy.',
      );
    }
    if (process.env.NODE_ENV === 'production') {
      const resetAt = now + config.windowMs;
      return { allowed: false, remaining: 0, resetAt, retryAfterSeconds: Math.ceil(config.windowMs / 1000) };
    }
    ip = 'unknown';
  }
  let buckets = store.get(scope);
  if (!buckets) {
    buckets = new Map();
    store.set(scope, buckets);
  }

  const entry = buckets.get(ip);

  if (!entry || entry.resetAt < now) {
    const resetAt = now + config.windowMs;
    buckets.set(ip, { count: 1, resetAt });
    return { allowed: true, remaining: config.max - 1, resetAt, retryAfterSeconds: 0 };
  }

  if (entry.count >= config.max) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    };
  }

  entry.count++;
  return { allowed: true, remaining: config.max - entry.count, resetAt: entry.resetAt, retryAfterSeconds: 0 };
}
