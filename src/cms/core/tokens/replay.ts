/**
 * Single-use nonces.
 *
 * A signature without replay protection is a bearer token that happens to be
 * long: a captured request could be resent for the whole clock-skew window. The
 * timestamp check bounds this cache — nothing older than the window can pass
 * step 3 of verification, so nothing older ever needs remembering.
 *
 * ## The caveat, stated rather than discovered
 *
 * This is a per-process `Map`, exactly like `core/rate-limit.ts`. Under a
 * clustered deployment (PM2 cluster mode, several containers) each worker keeps
 * its own set, so a replay routed to a *different* worker is not caught. Praion
 * is single-site and low-volume and PM's sync is serial, so one worker is the
 * normal case — but if the deploy runs more than one, this must move to a shared
 * store (a `pm_request_nonces` table swept opportunistically, or Redis) before
 * the replay guarantee is real.
 */
import { CLOCK_SKEW_SECONDS } from './signature';

/** nonce → unix seconds after which the entry is meaningless. */
const seen = new Map<string, number>();

/**
 * Sweeping on write rather than on a timer: the cache only grows when requests
 * arrive, so that is the only moment it can need shrinking, and it keeps the
 * module free of a handle that would hold the process open.
 */
function sweep(nowSeconds: number): void {
  for (const [nonce, expiresAt] of seen) {
    if (expiresAt <= nowSeconds) seen.delete(nonce);
  }
}

/**
 * Record a nonce, returning false if it was already used.
 *
 * Check-and-record in one call on purpose: a separate `has` then `add` is a race
 * that two concurrent requests carrying the same nonce could both win.
 */
export function claimNonce(nonce: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  sweep(nowSeconds);
  const existing = seen.get(nonce);
  if (existing !== undefined && existing > nowSeconds) return false;
  seen.set(nonce, nowSeconds + CLOCK_SKEW_SECONDS);
  return true;
}

/** Test seam. Never called by request handling. */
export function resetNonceCache(): void {
  seen.clear();
}

/** Current entry count — for diagnostics and tests, not for logic. */
export function nonceCacheSize(): number {
  return seen.size;
}
