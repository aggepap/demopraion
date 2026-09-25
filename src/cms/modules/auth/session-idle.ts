/**
 * When an admin session goes stale, and when it gets pushed forward.
 *
 * ## The two clocks
 *
 * A session now has two deadlines rather than one:
 *
 *  - **Idle** (`exp` on the JWT) — how long since the user last did something.
 *    Pushed forward as they work. This is the one that protects an unattended
 *    laptop, which the old flat "eight hours from sign-in" did not: signed in at
 *    09:00, valid until 17:00 whether or not anybody touched it.
 *  - **Absolute** (`abs`, a claim) — how long since they signed IN, never
 *    extended. Without it an active session renews indefinitely,
 *    `ADMIN_SESSION_TTL_HOURS` stops meaning anything, and a stolen cookie kept
 *    warm by a script never expires.
 *
 * Pure and free of `server-only` so the decision is unit-testable; `session.ts`
 * does the cookie I/O.
 */

/** Minutes of inactivity before a session is over. */
export const DEFAULT_IDLE_MINUTES = 60;

/**
 * How old a session must be before a request bothers to re-issue the cookie.
 *
 * Refreshing on every request would put a `Set-Cookie` on every API response
 * for no benefit. A minute is far below the default hour-long window, so the
 * sliding expiry still slides in good time.
 */
export const SESSION_REFRESH_AFTER_SECONDS = 60;

/**
 * The cadence actually used, which is a FRACTION of the window rather than a
 * constant.
 *
 * A flat minute is wrong for a short window: configure
 * `ADMIN_SESSION_IDLE_MINUTES=1` and a session becomes eligible for refresh at
 * exactly the moment it expires, so it never refreshes and an actively working
 * user is signed out every minute no matter what they do. A quarter of the
 * window leaves three chances to renew before anything is lost.
 */
export function sessionRefreshAfterSeconds(idleSeconds: number): number {
  return Math.max(1, Math.min(SESSION_REFRESH_AFTER_SECONDS, Math.floor(idleSeconds / 4)));
}

/** Below this, a configured idle window is certainly a mistake rather than an intent. */
const MIN_IDLE_SECONDS = 60;

/**
 * The idle window in seconds.
 *
 * Anything that is not a positive number falls back to the default rather than
 * being coerced: `ADMIN_SESSION_IDLE_MINUTES=` reads as `0` through `Number()`,
 * and a zero-second session logs the entire team out on every request. A typo
 * in an env file must not be able to do that.
 */
export function sessionIdleSeconds(): number {
  const raw = process.env.ADMIN_SESSION_IDLE_MINUTES?.trim();
  const minutes = raw ? Number(raw) : NaN;
  const resolved = Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_IDLE_MINUTES;
  return Math.max(MIN_IDLE_SECONDS, Math.floor(resolved * 60));
}

export interface SessionTiming {
  /** Epoch seconds the current token was issued. */
  issuedAt: number;
  /** Epoch seconds the session dies regardless of activity. */
  absoluteExpiry: number;
}

export type SessionDecision =
  | { action: 'ok' }
  | { action: 'refresh'; expiresAt: number }
  | { action: 'expired' };

/**
 * What to do with a session that has just been presented.
 *
 * `nowSeconds` is a parameter rather than read here so the boundaries are
 * testable — they are the whole point of this function, and both are wrong in a
 * different way: too eager and people lose unsaved work, too lax and the
 * timeout does nothing.
 */
export function decideSessionRefresh(
  timing: SessionTiming,
  nowSeconds: number,
  idleSeconds: number,
): SessionDecision {
  if (nowSeconds >= timing.absoluteExpiry) return { action: 'expired' };

  // Negative when the token claims to have been issued in the future — clock
  // skew between two app servers, or a hand-crafted claim. Clamping to zero
  // means such a token is treated as brand new rather than as licence for a
  // longer life.
  const age = Math.max(0, nowSeconds - timing.issuedAt);
  if (age >= idleSeconds) return { action: 'expired' };
  if (age < sessionRefreshAfterSeconds(idleSeconds)) return { action: 'ok' };

  // Never past the absolute cap — that is what stops a refresh from renewing
  // a session forever.
  return { action: 'refresh', expiresAt: Math.min(nowSeconds + idleSeconds, timing.absoluteExpiry) };
}

/** Seconds of warning before the client signs the user out. */
export const IDLE_WARNING_SECONDS = 60;

export type IdleState = 'active' | 'warning' | 'expired';

/**
 * What the browser should be showing, given when the user last did something.
 *
 * The client half of the timeout. It is not the security boundary — the server
 * rejects a stale cookie whatever the browser believes — but it is what makes
 * the experience predictable: a warning before the work disappears, and a clean
 * sign-out with an explanation rather than the next click mysteriously 401ing.
 *
 * Pure, and shared with the server module deliberately, so the two halves
 * cannot disagree about how long an hour is.
 */
export function idleState(
  lastActivityMs: number,
  nowMs: number,
  idleSeconds: number,
  warningSeconds: number = IDLE_WARNING_SECONDS,
): IdleState {
  // Clamped for the same reason `decideSessionRefresh` clamps: a lastActivity
  // in the future (a clock change, or a value from another tab on a machine
  // that just resynced) must not read as "expired long ago".
  const idleFor = Math.max(0, (nowMs - lastActivityMs) / 1000);
  if (idleFor >= idleSeconds) return 'expired';
  if (idleFor >= idleSeconds - warningSeconds) return 'warning';
  return 'active';
}
