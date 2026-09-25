import 'server-only';

import { resolveTtlSeconds } from './policy';

/** How long a lock survives without a heartbeat. */
export function lockTtlSeconds(): number {
  return resolveTtlSeconds(process.env.CMS_LOCK_TTL_SECONDS);
}

/**
 * The shared secret the relay presents on the heartbeat and release endpoints.
 *
 * Short secrets are treated as absent rather than accepted, matching how
 * `ADMIN_SESSION_SECRET` refuses anything under 32 characters.
 */
export function lockInternalSecret(): string | null {
  const s = process.env.CMS_LOCK_INTERNAL_SECRET;
  return s && s.length >= 32 ? s : null;
}

/**
 * Whether locking is switched on at all.
 *
 * Unset secret ⇒ the whole feature is dark: no lock is ever written, so
 * `assertNotLockedByOther` never refuses a save and the admin behaves exactly
 * as it did before. That is the required failure mode — a collaboration nicety
 * must never be able to make the CMS read-only because a sidecar is missing.
 */
export function locksEnabled(): boolean {
  return lockInternalSecret() !== null;
}
