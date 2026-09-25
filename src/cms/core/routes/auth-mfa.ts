import 'server-only';

import { eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import type { CmsConfig } from '../../config';
import {
  clearMfa,
  confirmEnrollment,
  getMfaStatus,
  issueEmailCode,
  replaceRecoveryCodes,
  startTotpEnrollment,
  verifySecondFactor,
} from '../../modules/auth/mfa';
import {
  clearMfaChallengeCookie,
  setMfaChallengeCookie,
} from '../../modules/auth/mfa-challenge';
import { claimsForUser, issueSession } from '../../modules/auth/login';
import { verifyPassword } from '../../modules/auth/password';
import { requireApiAuth } from '../../modules/auth/guards';
import { getDb, schema } from '../../db';
import { logAudit, recentAuthFailures } from '../audit';
import { createRoute } from '../api/handler';
import { ok } from '../api/respond';
import { graphMailConfigured } from '../email';
import { interpretBypassAttempt, readBypassCode } from '../security/mfa-bypass';
import { ApiError } from '../errors';
import { getBrand } from '../brand';
import { getSetting, SECURITY_REQUIRE_2FA_KEY } from '../settings';
import { requireMfaChallenge } from './mfa-guard';

/**
 * The second-factor endpoints — everything reachable between "password
 * accepted" and "session issued", plus the self-service screens for managing a
 * factor once signed in.
 *
 * Two guards are in play and they are not interchangeable. The challenge-cookie
 * routes are for somebody mid-sign-in who has NO session; the session-guarded
 * routes are for somebody already signed in. Nothing here is guarded by a bare
 * user id from a request body — that would be the login bypass this whole
 * feature exists to prevent.
 */

/**
 * The code prompt gets the same per-account lockout the password prompt has.
 *
 * Without it the per-IP limit is the only ceiling on guessing a six-digit code,
 * and that is the one dimension an attacker defeats by changing address. The
 * numbers match `auth.ts` deliberately: one budget for the whole sign-in, not
 * two that have to be reasoned about together.
 */
const MFA_LOCKOUT_MAX_FAILURES = 10;
const MFA_LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

const MFA_ACTIONS = { failAction: 'auth.2fa.fail', successAction: 'auth.2fa.success' };

/** Both a TOTP code and a mailed code are six digits; a recovery code is `XXXX-XXXX`. */
const codeBody = z.object({ code: z.string().trim().min(1).max(32) });

/** Whether the site requires every administrator to hold a second factor. */
export async function mfaRequiredBySetting(): Promise<boolean> {
  return (await getSetting<string>(SECURITY_REQUIRE_2FA_KEY)) === 'on';
}

async function assertNotLockedOut(email: string, ip: string, ua: string | null): Promise<void> {
  const failures = await recentAuthFailures(email, MFA_LOCKOUT_WINDOW_MS, MFA_ACTIONS);
  if (failures < MFA_LOCKOUT_MAX_FAILURES) return;

  await logAudit({
    action: 'auth.2fa.locked',
    subjectType: 'email',
    subjectId: email,
    ip,
    ua,
    after: { failures },
  });
  throw new ApiError('rate_limited', 'Too many attempts. Try again later.', {
    headers: { 'Retry-After': String(Math.ceil(MFA_LOCKOUT_WINDOW_MS / 1000)) },
  });
}

/**
 * POST /api/cms/auth/2fa/verify — finish a sign-in with a second factor.
 *
 * On success the challenge cookie is cleared BEFORE the session is set: a
 * spent challenge that outlives its use is a second credential lying around for
 * no reason.
 */
export const mfaVerifyRoute = createRoute({
  rateLimit: { scope: 'cms-2fa-verify', max: 10, windowMs: 10 * 60 * 1000 },
  guard: (req) => requireMfaChallenge(req, 'verify'),
  input: codeBody,
  handler: async ({ auth, input, ip, req }) => {
    const ua = req.headers.get('user-agent');
    await assertNotLockedOut(auth.email, ip, ua);

    const result = await verifySecondFactor(auth.userId, input.code);
    if (!result.ok) {
      await logAudit({
        userId: auth.userId,
        action: 'auth.2fa.fail',
        subjectType: 'email',
        subjectId: auth.email,
        ip,
        ua,
      });
      throw new ApiError('mfa_invalid', 'That code is not valid.');
    }

    // Permissions are re-read here rather than carried in the challenge, so a
    // role revoked while the user sat at the code prompt does not travel into
    // the session they end up with.
    const claims = await claimsForUser(auth.userId);
    if (!claims) throw new ApiError('unauthorized', 'This account can no longer sign in.');

    await clearMfaChallengeCookie();
    await issueSession(claims);
    await logAudit({
      userId: auth.userId,
      action: 'auth.2fa.success',
      subjectType: 'email',
      subjectId: auth.email,
      ip,
      ua,
      after: { via: result.via },
    });
    // The password step's own counter is reset by this too — the sign-in as a
    // whole succeeded, which is what `auth.login.success` records.
    await logAudit({
      userId: auth.userId,
      action: 'auth.login.success',
      subjectType: 'email',
      subjectId: auth.email,
      ip,
      ua,
    });

    if (result.via === 'recovery') {
      await logAudit({
        userId: auth.userId,
        action: 'auth.2fa.recovery_used',
        subjectType: 'email',
        subjectId: auth.email,
        ip,
        ua,
        after: { remaining: (await getMfaStatus(auth.userId)).recoveryCodesRemaining },
      });
    }

    return ok({
      user: claims,
      // Surfaced so the admin can nag before the last one is gone. A user who
      // burns their final recovery code and is never told has no way back next
      // time.
      recoveryCodesRemaining: (await getMfaStatus(auth.userId)).recoveryCodesRemaining,
    });
  },
});

/**
 * POST /api/cms/auth/2fa/send-code — mail a fresh code mid-sign-in.
 *
 * A budget of its own, deliberately tighter than the verify budget: this one
 * rations outbound email, and being mail-bombed by your own admin panel is a
 * denial of service against the person who owns the account. `issueEmailCode`
 * adds a per-ACCOUNT ceiling on top, which is the half a per-IP limiter cannot
 * do anything about.
 */
export const mfaSendCodeRoute = createRoute({
  rateLimit: { scope: 'cms-2fa-send', max: 5, windowMs: 10 * 60 * 1000 },
  guard: (req) => requireMfaChallenge(req, 'verify'),
  handler: async ({ auth }) => {
    const status = await getMfaStatus(auth.userId);
    if (status.method !== 'email') {
      throw new ApiError('bad_request', 'This account does not use emailed codes.');
    }
    return ok({ sent: (await issueEmailCode(auth.userId, 'login')) === 'sent' });
  },
});

/**
 * Per-account lockout for the bypass, far tighter than the ordinary one.
 *
 * Five attempts an hour against a six-digit space, on top of the per-IP budget
 * below and on top of already needing a valid password. The ordinary code path
 * can afford ten in fifteen minutes because its secret is per-user and rotates
 * every thirty seconds; this one is shared and static, so the only thing
 * bounding it is how slowly it can be guessed.
 */
const BYPASS_LOCKOUT_MAX_FAILURES = 5;
const BYPASS_LOCKOUT_WINDOW_MS = 60 * 60 * 1000;

const BYPASS_ACTIONS = {
  failAction: 'auth.2fa.bypass.fail',
  successAction: 'auth.2fa.bypass.success',
};

/**
 * POST /api/cms/auth/2fa/bypass — complete a sign-in with the break-glass code.
 *
 * ## Why this is a separate route
 *
 * The requirement is that the bypass code works ONLY in its own dialog and
 * never in the ordinary 2FA field. A keyboard shortcut cannot enforce that —
 * both endpoints are reachable with curl, and the shortcut is only obscurity.
 * What enforces it is that the two code paths share nothing: `verifySecondFactor`
 * has no import of, and no reference to, the bypass module, and this handler
 * never consults a user's enrolled factor. Neither can accept the other's
 * secret because neither can see it.
 *
 * Guarded by the `verify` challenge, so it is reachable only after a correct
 * password — and only by an account that HAS a second factor to bypass. It is
 * deliberately not offered on the forced-enrollment path: that would turn a
 * site-wide "2FA required" policy into a suggestion.
 */
export const mfaBypassRoute = createRoute({
  /*
   * Five per hour per IP — an order of magnitude tighter than `cms-2fa-verify`,
   * and its own scope so the two budgets cannot spend each other. A user who
   * fumbles their real code must not thereby lose their break-glass attempts,
   * and someone grinding the bypass must not be silently draining the budget
   * that protects the ordinary path.
   */
  rateLimit: { scope: 'cms-2fa-bypass', max: 5, windowMs: 60 * 60 * 1000 },
  guard: (req) => requireMfaChallenge(req, 'verify'),
  input: z.object({ code: z.string().trim().min(1).max(32) }),
  handler: async ({ auth, input, ip, req }) => {
    const ua = req.headers.get('user-agent');

    const failures = await recentAuthFailures(auth.email, BYPASS_LOCKOUT_WINDOW_MS, BYPASS_ACTIONS);
    if (failures >= BYPASS_LOCKOUT_MAX_FAILURES) {
      await logAudit({
        userId: auth.userId,
        action: 'auth.2fa.bypass.locked',
        subjectType: 'email',
        subjectId: auth.email,
        ip,
        ua,
        after: { failures },
      });
      throw new ApiError('rate_limited', 'Too many attempts. Try again later.', {
        headers: { 'Retry-After': String(Math.ceil(BYPASS_LOCKOUT_WINDOW_MS / 1000)) },
      });
    }

    const result = interpretBypassAttempt(readBypassCode(), input.code);
    if (!result.ok) {
      await logAudit({
        userId: auth.userId,
        action: 'auth.2fa.bypass.fail',
        subjectType: 'email',
        subjectId: auth.email,
        ip,
        ua,
        // The REASON, never the submitted value. "disabled" versus "mismatch"
        // is the difference between a misconfigured deploy and someone
        // guessing, and an operator reading the log needs to tell them apart.
        after: { reason: result.reason },
      });
      // Same wording either way: whether the bypass is even configured on this
      // site is not something a caller should be able to probe.
      throw new ApiError('mfa_invalid', 'That code is not valid.');
    }

    const claims = await claimsForUser(auth.userId);
    if (!claims) throw new ApiError('unauthorized', 'This account can no longer sign in.');

    await clearMfaChallengeCookie();
    await issueSession(claims);
    /*
     * Logged at the loudest level available. A successful bypass means somebody
     * signed in without the second factor the account actually holds, which is
     * the single most important line an operator can find in this audit trail.
     */
    await logAudit({
      userId: auth.userId,
      action: 'auth.2fa.bypass.success',
      subjectType: 'email',
      subjectId: auth.email,
      ip,
      ua,
    });
    await logAudit({
      userId: auth.userId,
      action: 'auth.login.success',
      subjectType: 'email',
      subjectId: auth.email,
      ip,
      ua,
    });
    return ok({ user: claims });
  },
});

const enrollBody = z.object({ method: z.enum(['totp', 'email']) });

interface Enroller {
  userId: number;
  email: string;
  /** True when this came from a forced enrollment mid-sign-in, so a session is still owed. */
  fromChallenge: boolean;
}

/**
 * Resolve who is enrolling: either a signed-in user managing their own account,
 * or somebody mid-sign-in whom the policy is forcing to enrol.
 *
 * Both paths land here so the enrollment logic exists once. The session is
 * tried first because a signed-in user may also still be holding a stale
 * challenge cookie from an earlier attempt.
 *
 * Written as a `guard` rather than a call inside the handler so it runs BEFORE
 * the body is parsed — that is the order the factory documents and the rest of
 * the routes follow. With the check in the handler, an anonymous request got a
 * 422 describing the body it should have sent, which is both the wrong status
 * and an answer to a question the caller was not entitled to ask.
 */
async function requireEnroller(req: NextRequest): Promise<Enroller | NextResponse> {
  const session = await requireApiAuth();
  if (!(session instanceof NextResponse)) {
    return { userId: session.userId, email: session.email, fromChallenge: false };
  }
  const challenge = await requireMfaChallenge(req, 'enroll');
  if (challenge instanceof NextResponse) return challenge;
  return { userId: challenge.userId, email: challenge.email, fromChallenge: true };
}

/** POST /api/cms/auth/2fa/enroll/start — mint a secret, or mail an enrollment code. */
export function mfaEnrollStartRoute(config: CmsConfig) {
  return createRoute({
    rateLimit: { scope: 'cms-2fa-enroll', max: 20, windowMs: 10 * 60 * 1000 },
    guard: requireEnroller,
    input: enrollBody,
    handler: async ({ auth: who, input }) => {
      /*
       * Refuse to start a second enrollment on an account that already has one.
       *
       * `startTotpEnrollment` writes the new seed into the SAME column the live
       * one occupies, and `mfa_method` stays `totp` throughout — so a second
       * call would replace the working secret the moment it was made, before
       * the user had confirmed anything. Their authenticator app would stop
       * matching immediately and the only way back would be a recovery code.
       *
       * The account screen only offers enrollment when 2FA is off, so this is
       * unreachable from the UI. It is reachable from the API, which is where
       * it has to be refused.
       */
      const current = await getMfaStatus(who.userId);
      if (current.method) {
        throw new ApiError(
          'conflict',
          'Two-factor authentication is already set up. Turn it off first to change how it works.',
        );
      }

      if (input.method === 'email') {
        // Fail closed, and fail HERE. Letting someone enrol into a method that
        // cannot be delivered turns their next sign-in into a lockout with no
        // explanation on screen.
        if (!graphMailConfigured()) {
          throw new ApiError(
            'bad_request',
            'Email delivery is not configured on this site. Use an authenticator app instead.',
          );
        }
        const sent = await issueEmailCode(who.userId, 'enroll');
        if (sent === 'throttled') {
          throw new ApiError('rate_limited', 'Too many codes requested. Try again shortly.');
        }
        return ok({ method: 'email' as const, sent: sent === 'sent' });
      }

      // The authenticator app labels the entry with this, so it follows the brand.
      const { name: issuer } = await getBrand(config.brand);
      const enrollment = await startTotpEnrollment(who.userId, who.email, issuer);
      return ok({ method: 'totp' as const, ...enrollment });
    },
  });
}

/**
 * POST /api/cms/auth/2fa/enroll/confirm — prove the factor works, switch it on,
 * and hand back the recovery codes once.
 *
 * When the enrollment was forced mid-sign-in, this is also where the session
 * finally gets issued: that is the point of doing it inside the login flow
 * rather than behind one.
 */
export const mfaEnrollConfirmRoute = createRoute({
  rateLimit: { scope: 'cms-2fa-enroll-confirm', max: 10, windowMs: 10 * 60 * 1000 },
  guard: requireEnroller,
  input: enrollBody.extend(codeBody.shape),
  handler: async ({ auth: who, req, input, ip }) => {
    const ua = req.headers.get('user-agent');

    const result = await confirmEnrollment(who.userId, input.method, input.code);
    if (!result.ok) throw new ApiError('mfa_invalid', 'That code is not valid.');

    await logAudit({
      userId: who.userId,
      action: 'auth.2fa.enrolled',
      subjectType: 'email',
      subjectId: who.email,
      ip,
      ua,
      after: { method: input.method },
    });

    if (!who.fromChallenge) {
      return ok({ recoveryCodes: result.recoveryCodes });
    }

    const claims = await claimsForUser(who.userId);
    if (!claims) throw new ApiError('unauthorized', 'This account can no longer sign in.');
    await clearMfaChallengeCookie();
    await issueSession(claims);
    await logAudit({
      userId: who.userId,
      action: 'auth.login.success',
      subjectType: 'email',
      subjectId: who.email,
      ip,
      ua,
    });
    return ok({ recoveryCodes: result.recoveryCodes, user: claims });
  },
});

const passwordBody = z.object({ password: z.string().min(1).max(200) });

/**
 * Re-authenticate a signed-in user with their password.
 *
 * Both destructive self-service actions below sit behind this. A session cookie
 * on an unattended laptop is enough to reach the account screen; it must not be
 * enough to remove the second factor or to print a fresh set of recovery codes.
 */
async function requirePasswordReauth(userId: number, password: string): Promise<void> {
  const [user] = await getDb()
    .select({ hash: schema.adminUsers.passwordHash })
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.id, userId))
    .limit(1);
  if (!user || !(await verifyPassword(password, user.hash))) {
    throw new ApiError('unauthorized', 'That password is not correct.');
  }
}

/** GET /api/cms/auth/2fa — the signed-in user's own second-factor state. */
export const mfaStatusRoute = createRoute({
  guard: () => requireApiAuth(),
  handler: async ({ auth }) =>
    ok({ ...(await getMfaStatus(auth.userId)), required: await mfaRequiredBySetting() }),
});

/** POST /api/cms/auth/2fa/disable — turn the second factor off. */
export const mfaDisableRoute = createRoute({
  rateLimit: { scope: 'cms-2fa-disable', max: 10, windowMs: 10 * 60 * 1000 },
  guard: () => requireApiAuth(),
  input: passwordBody,
  handler: async ({ auth, input, ip, req }) => {
    // Checked before the password, so the answer does not depend on getting the
    // password right — "correct password, still refused" is the honest reply.
    if (await mfaRequiredBySetting()) {
      throw new ApiError(
        'forbidden',
        'This site requires two-factor authentication. Ask an administrator to change the setting first.',
      );
    }
    await requirePasswordReauth(auth.userId, input.password);
    await clearMfa(auth.userId);
    await logAudit({
      userId: auth.userId,
      action: 'auth.2fa.disabled',
      subjectType: 'email',
      subjectId: auth.email,
      ip,
      ua: req.headers.get('user-agent'),
    });
    return ok({ ok: true });
  },
});

/** POST /api/cms/auth/2fa/recovery-codes — replace the whole set, shown once. */
export const mfaRecoveryCodesRoute = createRoute({
  rateLimit: { scope: 'cms-2fa-recovery', max: 10, windowMs: 10 * 60 * 1000 },
  guard: () => requireApiAuth(),
  input: passwordBody,
  handler: async ({ auth, input, ip, req }) => {
    const status = await getMfaStatus(auth.userId);
    if (!status.method) {
      throw new ApiError('bad_request', 'Set up two-factor authentication first.');
    }
    await requirePasswordReauth(auth.userId, input.password);
    const codes = await replaceRecoveryCodes(auth.userId);
    await logAudit({
      userId: auth.userId,
      action: 'auth.2fa.recovery_regenerated',
      subjectType: 'email',
      subjectId: auth.email,
      ip,
      ua: req.headers.get('user-agent'),
    });
    return ok({ recoveryCodes: codes });
  },
});

/** Issue the challenge cookie for a login that still needs a second factor. */
export async function beginMfaChallenge(
  userId: number,
  email: string,
  purpose: 'verify' | 'enroll',
): Promise<void> {
  await setMfaChallengeCookie({ userId, email, purpose });
}
