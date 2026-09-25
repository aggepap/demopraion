/**
 * Who may hold, keep and write to a locked resource.
 *
 * Every rule here is a pure function of (stored row, claimant, now) so the
 * awkward cases — an expired lock, a refresh race, one person in two tabs —
 * are unit-testable without a database. The I/O that reads and writes the row
 * lives in `service.ts`; this file decides, that file acts.
 */
import type { LockHolder, LockResourceType } from './protocol';

/** A row of `editing_locks`, as the policy needs to see it. */
export interface LockRecord {
  resourceType: LockResourceType;
  resourceKey: string;
  userId: number;
  userName: string;
  /** Per browser TAB, kept in `sessionStorage` so a refresh keeps its lock. */
  sessionId: string;
  /** Per SOCKET. The release credential — see `decideRelease`. */
  connectionId: string;
  acquiredAt: Date;
  heartbeatAt: Date;
  expiresAt: Date;
}

export interface LockClaimant {
  userId: number;
  userName: string;
  sessionId: string;
  connectionId: string;
}

export type LockDecision = 'granted' | 'renewed' | 'held-by-other';

const DEFAULT_TTL_SECONDS = 60;
/** An hour is already far longer than any editing session should hold a lock
 *  without a heartbeat; beyond it a typo in the env var becomes a lock nobody
 *  can clear without SQL. */
const MAX_TTL_SECONDS = 3600;

/**
 * Inclusive at the boundary: a lock expiring exactly now is already gone.
 *
 * The TTL exists so a holder who vanished — a crashed relay, a severed
 * network — stops blocking everyone else. Rounding that moment in the holder's
 * favour would extend an outage by a second for no benefit.
 */
export function isExpired(lock: { expiresAt: Date }, now: Date): boolean {
  return lock.expiresAt.getTime() <= now.getTime();
}

export function expiresAtFrom(now: Date, ttlSeconds: number): Date {
  return new Date(now.getTime() + ttlSeconds * 1000);
}

/**
 * Read a TTL out of the environment without letting a blank one mean zero.
 *
 * `Number('')` is 0 and `Number('abc')` is NaN. A zero TTL expires every lock
 * the instant it is taken, which does not look like a misconfiguration — it
 * looks like the feature does not work. `.env.example` documents the same trap
 * for `ADMIN_SESSION_IDLE_MINUTES`.
 */
export function resolveTtlSeconds(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TTL_SECONDS;
  return Math.min(Math.floor(n), MAX_TTL_SECONDS);
}

/**
 * May this claimant take the lock?
 *
 * `renewed` rather than `granted` for a claimant who already effectively holds
 * it, so the caller can skip the audit trail and the "you were taken over"
 * broadcast for what is really the same person carrying on.
 */
export function decideAcquire(
  existing: LockRecord | null,
  claimant: LockClaimant,
  now: Date,
  ttlSeconds: number,
): { decision: LockDecision; expiresAt: Date } {
  const expiresAt = expiresAtFrom(now, ttlSeconds);
  if (!existing || isExpired(existing, now)) return { decision: 'granted', expiresAt };
  /*
   * Same person, whether or not the same tab.
   *
   * Matching on the tab alone meant a second tab was told "Alice is editing
   * this" — true, useless, and impossible to act on except by taking the
   * document over from yourself. Two tabs are one person; the newest one
   * carries the lock and the older is told where it went.
   */
  if (existing.userId === claimant.userId) return { decision: 'renewed', expiresAt };
  return { decision: 'held-by-other', expiresAt };
}

/**
 * Should a closing socket release the lock it is associated with?
 *
 * Keyed on the connection, not the session, because of the refresh race: a tab
 * keeps its `sessionId` across F5 so it does not lock itself out, which means
 * the NEW socket re-acquires before the OLD socket's `close` event arrives.
 * Releasing on the session would delete the lock just granted, and the tab
 * would silently lose the document it is sitting in.
 */
export function decideRelease(
  existing: LockRecord | null,
  connectionId: string,
): 'release' | 'ignore' {
  if (!existing) return 'ignore';
  return existing.connectionId === connectionId ? 'release' : 'ignore';
}

/**
 * May this caller write to the resource?
 *
 * Keyed on the USER, never on the session id. The session id is broadcast to
 * every socket in a room so a tab can tell its own lock from someone else's —
 * if a write were authorised by that id, it would be a bypass token anyone
 * watching the room could replay. The user id comes from the signed session
 * cookie, so it cannot be forged, and "the holder's other tab may also save"
 * falls out of it for free. Concurrent saves by one person are already handled
 * by `expectedVersion`.
 */
export function decideWrite(
  existing: LockRecord | null,
  callerUserId: number | null,
  now: Date,
): 'allowed' | 'blocked' {
  if (!existing || isExpired(existing, now)) return 'allowed';
  return existing.userId === callerUserId ? 'allowed' : 'blocked';
}

/** The public face of a lock: enough for the banner, nothing that authorises. */
export function holderView(lock: LockRecord): LockHolder {
  return {
    userId: lock.userId,
    userName: lock.userName,
    sessionId: lock.sessionId,
    since: lock.acquiredAt.toISOString(),
  };
}
