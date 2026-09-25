import 'server-only';

import { z } from 'zod';

import { clearSessionCookie, loginWithPassword, requireApiAuth } from '../../modules/auth';
import { clearMfaChallengeCookie } from '../../modules/auth/mfa-challenge';
import { logAudit, recentLoginFailures } from '../audit';
import { createRoute } from '../api/handler';
import { ok } from '../api/respond';
import { ApiError } from '../errors';
import { beginMfaChallenge, mfaRequiredBySetting } from './auth-mfa';

/**
 * Per-account lockout: how many failures, over how long, before an email is
 * refused regardless of where the attempts come from. Ten in fifteen minutes is
 * far above what a person mistyping their own password produces, and far below
 * what any password guessing needs.
 */
const ACCOUNT_LOCKOUT_MAX_FAILURES = 10;
const ACCOUNT_LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

/** POST /api/cms/auth/login — rate-limited (fixes v1's unthrottled login). */
export const loginRoute = createRoute({
  /*
   * On top of both throttles below, not instead of either. The per-IP limit is
   * the one an attacker defeats by changing address, and the per-account
   * lockout only starts counting once the guessing has already begun; the
   * captcha is the only thing that costs something on the FIRST attempt from a
   * fresh IP. It runs before the lockout query, so a bot never reaches the
   * database — and never gets to fill an administrator's failure counter.
   *
   * 60 verifications / 10 min / IP: six times what the ten password attempts
   * below could ever need, so a person retrying an expired token never meets
   * it, while a script still cannot make this server call Google without limit.
   */
  captcha: { rateLimit: { scope: 'cms-login-captcha', max: 60, windowMs: 10 * 60 * 1000 } },
  /*
   * 10 attempts / 10 min / IP — app-layer backstop behind the proxy's
   * limit_req. Consumed only by requests that got past the captcha, so this
   * budget counts password guesses; a token that expired while the user was
   * typing no longer costs them one of their ten.
   */
  rateLimit: { scope: 'cms-login', max: 10, windowMs: 10 * 60 * 1000 },
  input: z.object({
    email: z.string().email(),
    password: z.string().min(1),
  }),
  handler: async ({ input, ip, req }) => {
    // Per-ACCOUNT throttle, on top of the per-IP one above. The IP limit is the
    // only thing an attacker can trivially defeat — a new address buys ten more
    // guesses — so a single administrator's password could be attacked without
    // limit from a proxy pool. This counts failures against the email itself.
    const email = input.email.trim().toLowerCase();
    const failures = await recentLoginFailures(email, ACCOUNT_LOCKOUT_WINDOW_MS);
    if (failures >= ACCOUNT_LOCKOUT_MAX_FAILURES) {
      await logAudit({
        action: 'auth.login.locked',
        subjectType: 'email',
        subjectId: email,
        ip,
        ua: req.headers.get('user-agent'),
        after: { failures },
      });
      // Same wording as a wrong password: whether an account exists, and
      // whether it is currently locked, are both things an attacker would
      // otherwise learn for free.
      throw new ApiError('rate_limited', 'Too many attempts. Try again later.', {
        headers: { 'Retry-After': String(Math.ceil(ACCOUNT_LOCKOUT_WINDOW_MS / 1000)) },
      });
    }

    const result = await loginWithPassword(input.email, input.password, {
      requireMfa: await mfaRequiredBySetting(),
    });
    if (result.status === 'fail') {
      await logAudit({
        action: 'auth.login.fail',
        subjectType: 'email',
        // The normalised address, not the raw one. This is the row the lockout
        // counts, and it counts with an exact `eq()` against the lowercase form.
        // MySQL's `utf8mb4_unicode_ci` collation happens to compare
        // case-insensitively, so today a mixed-case attempt is still counted —
        // the lockout works by accident of the collation, not by design. The core
        // is written against a `DbAdapter` so a Postgres adapter can be added,
        // and Postgres compares case-sensitively: there, varying the case of an
        // address would defeat the account lockout entirely. Recording the same
        // value the counter looks for removes the accident, and keeps the audit
        // trail from showing one address in two forms.
        subjectId: email,
        ip,
        ua: req.headers.get('user-agent'),
        after: { reason: result.reason },
      });
      // Generic message regardless of reason — no user enumeration.
      throw new ApiError('unauthorized', 'Invalid email or password.');
    }

    /*
     * The password was right and the sign-in is NOT finished.
     *
     * Deliberately a 200 with a discriminated body rather than an error: "give
     * me your code" is not a failure, and rendering it as one would put it
     * through the same client-side path as a wrong password. No session cookie
     * is set on either of these branches — the only thing the browser gets is a
     * ten-minute challenge token that opens nothing but the code endpoints.
     *
     * `auth.login.success` is NOT written here either. It is what resets the
     * per-account failure counter, and a password that has not yet completed a
     * sign-in must not clear the record of the attempts before it.
     */
    if (result.status === 'mfa') {
      await beginMfaChallenge(result.userId, result.email, 'verify');
      await logAudit({
        userId: result.userId,
        action: 'auth.2fa.challenged',
        subjectType: 'email',
        subjectId: email,
        ip,
        ua: req.headers.get('user-agent'),
        after: { method: result.method },
      });
      return ok({ mfa: { required: true, method: result.method } });
    }
    if (result.status === 'enroll') {
      await beginMfaChallenge(result.userId, result.email, 'enroll');
      await logAudit({
        userId: result.userId,
        action: 'auth.2fa.enroll_required',
        subjectType: 'email',
        subjectId: email,
        ip,
        ua: req.headers.get('user-agent'),
      });
      return ok({ mfa: { required: true, enroll: true } });
    }

    // A completed single-factor sign-in. Any challenge cookie left over from an
    // abandoned attempt is cleared, so it cannot be replayed later.
    await clearMfaChallengeCookie();
    await logAudit({
      userId: result.user.userId,
      action: 'auth.login.success',
      // Recorded against the email as well as the user id, so a success can
      // reset the per-account failure count above — and so the audit trail
      // shows which address was used, not only which account it resolved to.
      subjectType: 'email',
      subjectId: email,
      ip,
      ua: req.headers.get('user-agent'),
    });
    return ok({
      user: {
        userId: result.user.userId,
        email: result.user.email,
        name: result.user.name,
        locale: result.user.locale,
        permissions: result.user.permissions,
      },
    });
  },
});

/**
 * POST /api/cms/auth/logout — clears the session cookie.
 *
 * The `reason` distinguishes a deliberate sign-out from one the idle timer
 * performed, as its own action rather than a field on a shared one: the audit
 * screen filters and labels by action, and "was I signed out, or did I sign
 * out?" is exactly the distinction someone reads this log to settle.
 *
 * The body is optional in practice — the client always sends one — but the
 * schema tolerates an empty object so an older bundle mid-deploy still logs out
 * rather than getting a 422 at the one moment it is trying to leave.
 */
export const logoutRoute = createRoute({
  // Not gated on `cms.access`: a session whose role lost it must still be able to end.
  guard: () => requireApiAuth({ allowWithoutAccess: true }),
  input: z.object({ reason: z.enum(['idle']).optional() }).default({}),
  handler: async ({ auth, input, ip, req }) => {
    await clearSessionCookie();
    await logAudit({
      userId: auth.userId,
      action: input?.reason === 'idle' ? 'auth.logout.idle' : 'auth.logout',
      subjectType: 'email',
      subjectId: auth.email,
      ip,
      ua: req.headers.get('user-agent'),
    });
    return ok({ ok: true });
  },
});

/**
 * GET /api/cms/auth/me — current session (401 when anonymous).
 *
 * Guarded by `requireApiAuth` rather than reading the session cookie directly.
 * The cookie is a JWT with the permissions baked in at sign-in, so answering
 * from it meant this endpoint disagreed with every other one: a user disabled or
 * stripped of a role mid-session still got a 200 here, with the permission list
 * they had when they signed in, and the admin shell rendered a working-looking UI
 * whose every subsequent request 401'd or 403'd. No access was granted by that —
 * the guards have always read fresh — but "your session is over" is a better
 * thing to be told than a screen full of dead buttons.
 */
export const meRoute = createRoute({
  guard: () => requireApiAuth(),
  handler: async ({ auth }) => {
    return ok({
      userId: auth.userId,
      email: auth.email,
      name: auth.name,
      locale: auth.locale,
      permissions: auth.permissions,
      /*
       * When this session actually dies, in epoch seconds.
       *
       * The idle watcher needs it to sign out while the cookie is still valid —
       * otherwise the logout request 401s and the event never reaches the audit
       * log, which is the one place someone would look to find out why they
       * were signed out. The client cannot read the httpOnly cookie's expiry,
       * so the server has to say.
       */
      sessionExpiresAt: auth.sessionExpiresAt ?? null,
    });
  },
});
