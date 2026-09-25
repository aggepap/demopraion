/**
 * The pipeline around the second-factor endpoints.
 *
 * These routes are reached by someone who has proved a password and nothing
 * else, so the guard on every one of them is the `cms_mfa` cookie — and the
 * first thing worth asserting is that an unauthenticated request cannot get
 * past it, because a `verify` endpoint that accepts a bare `userId` is a login
 * bypass with extra steps.
 *
 * The rest is budgets. The code prompt needs its own per-IP ceiling, separate
 * from the one that rations password guesses and separate again from the one
 * that rations outbound email — otherwise one of the three silently pays for
 * another. `route-captcha.test.ts` locks down the same property for the captcha
 * step and this is its sibling.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { NextRequest } from 'next/server';

process.env.ADMIN_SESSION_SECRET = 'test-session-secret-at-least-32-chars-long';

import { createRoute } from '@/cms/core/api/handler';
import { checkRateLimit } from '@/cms/core/rate-limit';
import { MFA_CHALLENGE_COOKIE_NAME, signMfaChallenge } from '@/cms/modules/auth/mfa-challenge';
import { requireMfaChallenge } from '@/cms/core/routes/mfa-guard';
import { interpretBypassAttempt, readBypassCode } from '@/cms/core/security/mfa-bypass';

const IP = '203.0.113.9';

/** A fresh scope per test — the limiter store is a module-level Map. */
let seq = 0;
function scope(name: string) {
  seq += 1;
  return `test-2fa-${name}-${seq}`;
}

function post(body: unknown, cookie?: string) {
  return new NextRequest('http://localhost/api/cms/auth/2fa/verify', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-real-ip': IP,
      ...(cookie ? { cookie: `${MFA_CHALLENGE_COOKIE_NAME}=${cookie}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('the MFA challenge guard', () => {
  test('refuses a request with no challenge cookie', async () => {
    let handlerRan = false;
    const route = createRoute({
      sameOrigin: false,
      guard: (req) => requireMfaChallenge(req, 'verify'),
      handler: () => {
        handlerRan = true;
        return { ok: true };
      },
    });

    const res = await route(post({ code: '123456' }));
    assert.equal(res.status, 401);
    assert.equal(handlerRan, false, 'the handler must not run for an anonymous caller');
  });

  test('refuses a forged cookie', async () => {
    const route = createRoute({
      sameOrigin: false,
      guard: (req) => requireMfaChallenge(req, 'verify'),
      handler: () => ({ ok: true }),
    });
    assert.equal((await route(post({ code: '1' }, 'not.a.jwt'))).status, 401);
  });

  test('accepts a genuine challenge and hands the claims to the handler', async () => {
    const token = await signMfaChallenge({ userId: 42, email: 'a@b.co', purpose: 'verify' });
    let seen: unknown = null;
    const route = createRoute({
      sameOrigin: false,
      guard: (req) => requireMfaChallenge(req, 'verify'),
      handler: ({ auth }) => {
        seen = auth;
        return { ok: true };
      },
    });

    const res = await route(post({ code: '123456' }, token));
    assert.equal(res.status, 200);
    assert.deepEqual(seen, { userId: 42, email: 'a@b.co', purpose: 'verify' });
  });

  test('an ENROLL challenge cannot complete a VERIFY step', async () => {
    /*
     * The two purposes are not interchangeable. An enrollment challenge is
     * handed out to somebody who has NO second factor yet; if it satisfied the
     * verify route, the policy that forced them to enrol would be skippable by
     * calling the other endpoint.
     */
    const token = await signMfaChallenge({ userId: 42, email: 'a@b.co', purpose: 'enroll' });
    const route = createRoute({
      sameOrigin: false,
      guard: (req) => requireMfaChallenge(req, 'verify'),
      handler: () => ({ ok: true }),
    });
    assert.equal((await route(post({ code: '1' }, token))).status, 401);
  });
});

describe('second-factor budgets', () => {
  test('the code prompt has its own per-IP ceiling', async () => {
    const verify = scope('verify');
    const route = createRoute({
      sameOrigin: false,
      rateLimit: { scope: verify, max: 3, windowMs: 60_000 },
      guard: (req) => requireMfaChallenge(req, 'verify'),
      handler: () => ({ ok: true }),
    });

    const token = await signMfaChallenge({ userId: 1, email: 'a@b.co', purpose: 'verify' });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await route(post({ code: '000000' }, token))).status);
    assert.deepEqual(statuses, [200, 200, 200, 429, 429]);
  });

  test('spending the verify budget leaves the send budget untouched', async () => {
    /*
     * Separate scopes, because they ration different things: one bounds guesses
     * against a code, the other bounds how much mail this server will send. A
     * user who mistypes their code five times must still be able to ask for a
     * fresh one.
     */
    const verify = scope('verify');
    const send = scope('send');
    const route = createRoute({
      sameOrigin: false,
      rateLimit: { scope: verify, max: 2, windowMs: 60_000 },
      guard: (req) => requireMfaChallenge(req, 'verify'),
      handler: () => ({ ok: true }),
    });

    const token = await signMfaChallenge({ userId: 1, email: 'a@b.co', purpose: 'verify' });
    for (let i = 0; i < 6; i++) await route(post({ code: '000000' }, token));

    for (let i = 0; i < 3; i++) {
      assert.equal(
        checkRateLimit(send, IP, { max: 3, windowMs: 60_000 }).allowed,
        true,
        `send slot ${i} should still be available`,
      );
    }
  });

  test('a rejected request is refused before the handler, not after', async () => {
    // The budget has to bite in the pipeline. Counting inside the handler means
    // the expensive part — a bcrypt comparison per stored code — has already run.
    const verify = scope('verify');
    let calls = 0;
    const route = createRoute({
      sameOrigin: false,
      rateLimit: { scope: verify, max: 1, windowMs: 60_000 },
      guard: (req) => requireMfaChallenge(req, 'verify'),
      handler: () => {
        calls += 1;
        return { ok: true };
      },
    });

    const token = await signMfaChallenge({ userId: 1, email: 'a@b.co', purpose: 'verify' });
    await route(post({ code: '1' }, token));
    await route(post({ code: '1' }, token));
    await route(post({ code: '1' }, token));
    assert.equal(calls, 1);
  });
});

describe('the break-glass bypass', () => {
  test('is unreachable without a challenge — the password step still gates it', async () => {
    /*
     * The bypass replaces the SECOND factor, not authentication. If it were
     * reachable anonymously it would be a six-digit password for the whole
     * admin, which is a different and far worse thing than what was asked for.
     */
    let handlerRan = false;
    const route = createRoute({
      sameOrigin: false,
      guard: (req) => requireMfaChallenge(req, 'verify'),
      handler: () => {
        handlerRan = true;
        return { ok: true };
      },
    });
    const res = await route(post({ code: '481207' }));
    assert.equal(res.status, 401);
    assert.equal(handlerRan, false);
  });

  test('an ENROLL challenge cannot reach it', async () => {
    // Otherwise a site-wide "2FA required" policy becomes a suggestion: an
    // un-enrolled admin could bypass their way in and never enrol.
    const token = await signMfaChallenge({ userId: 1, email: 'a@b.co', purpose: 'enroll' });
    const route = createRoute({
      sameOrigin: false,
      guard: (req) => requireMfaChallenge(req, 'verify'),
      handler: () => ({ ok: true }),
    });
    assert.equal((await route(post({ code: '481207' }, token))).status, 401);
  });

  test('its budget is separate from the verify budget, in both directions', async () => {
    /*
     * Two secrets, two budgets. Fumbling a real TOTP code must not consume the
     * break-glass attempts, and grinding the bypass must not quietly drain the
     * budget that protects the ordinary path.
     */
    const verify = scope('verify');
    const bypass = scope('bypass');
    const token = await signMfaChallenge({ userId: 1, email: 'a@b.co', purpose: 'verify' });

    const bypassRoute = createRoute({
      sameOrigin: false,
      rateLimit: { scope: bypass, max: 5, windowMs: 60_000 },
      guard: (req) => requireMfaChallenge(req, 'verify'),
      handler: () => ({ ok: true }),
    });

    // Exhaust the bypass budget.
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await bypassRoute(post({ code: '0' }, token))).status);
    assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429, 429]);

    // The verify budget is untouched.
    for (let i = 0; i < 10; i++) {
      assert.equal(
        checkRateLimit(verify, IP, { max: 10, windowMs: 60_000 }).allowed,
        true,
        `verify slot ${i} should still be available`,
      );
    }
  });

  test('the bypass budget is an order of magnitude tighter than the verify one', () => {
    // Stated as a test because the whole safety argument rests on it: the
    // bypass secret is shared and static, so how slowly it can be guessed is
    // the only thing bounding it.
    const bypass = scope('bypass');
    const allowed: boolean[] = [];
    for (let i = 0; i < 6; i++) {
      allowed.push(checkRateLimit(bypass, IP, { max: 5, windowMs: 60 * 60 * 1000 }).allowed);
    }
    assert.deepEqual(allowed, [true, true, true, true, true, false]);
  });

  test('with no code configured, nothing is accepted', () => {
    delete process.env.ADMIN_MFA_BYPASS_CODE;
    assert.deepEqual(interpretBypassAttempt(readBypassCode(), '481207'), {
      ok: false,
      reason: 'disabled',
    });
    assert.deepEqual(interpretBypassAttempt(readBypassCode(), ''), {
      ok: false,
      reason: 'disabled',
    });
  });
});
