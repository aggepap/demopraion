/**
 * `createRoute`'s captcha step, driven through the real pipeline.
 *
 * The factory had no end-to-end test at all — `api.test.ts` exercises only its
 * pieces — so the ORDER of its steps, which is the whole point of having one
 * factory, was never asserted anywhere. Order is exactly what matters here: a
 * rejected captcha must not spend the login budget that exists to slow password
 * guessing, and the verification call must itself be bounded so that failing it
 * is not a free way to make this server call Google all day.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { NextRequest } from 'next/server';

import { createRoute } from '@/cms/core/api/handler';
import { checkRateLimit } from '@/cms/core/rate-limit';

const IP = '203.0.113.7';

/** A fresh scope per test, so buckets from one case cannot leak into another. */
let seq = 0;
function scopes() {
  seq += 1;
  return { guesses: `test-guesses-${seq}`, verify: `test-verify-${seq}` };
}

function post(headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/cms/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-real-ip': IP, ...headers },
    body: JSON.stringify({ email: 'a@b.co', password: 'x' }),
  });
}

beforeEach(() => {
  process.env.RECAPTCHA_SITE_KEY = 'site-key';
  process.env.RECAPTCHA_SECRET_KEY = 'secret-key';
});
afterEach(() => {
  delete process.env.RECAPTCHA_SITE_KEY;
  delete process.env.RECAPTCHA_SECRET_KEY;
});

describe('createRoute captcha step', () => {
  test('a missing token is rejected before the handler runs', async () => {
    const { guesses, verify } = scopes();
    let handlerRan = false;
    const route = createRoute({
      sameOrigin: false,
      captcha: { rateLimit: { scope: verify, max: 100, windowMs: 60_000 } },
      rateLimit: { scope: guesses, max: 10, windowMs: 60_000 },
      handler: () => {
        handlerRan = true;
        return { ok: true };
      },
    });

    const res = await route(post());
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'captcha_failed');
    assert.equal(handlerRan, false, 'the handler must not see an unverified request');
  });

  test('rejected captchas do not spend the password-guessing budget', async () => {
    /*
     * The bug this locks down: with the guess limiter consumed first, a token
     * that expired while the user was typing — v2 tokens die after ~2 minutes —
     * costs one of their ten attempts. Tick, type, expire, retry a few times
     * and the form starts answering "too many attempts" to somebody who has not
     * yet been allowed to try their password even once.
     */
    const { guesses, verify } = scopes();
    const route = createRoute({
      sameOrigin: false,
      captcha: { rateLimit: { scope: verify, max: 100, windowMs: 60_000 } },
      rateLimit: { scope: guesses, max: 10, windowMs: 60_000 },
      handler: () => ({ ok: true }),
    });

    for (let i = 0; i < 25; i++) {
      const res = await route(post());
      assert.equal(res.status, 400, `request ${i} should be a captcha rejection`);
    }

    // The guess bucket must be untouched: all ten are still there.
    for (let i = 0; i < 10; i++) {
      const check = checkRateLimit(guesses, IP, { max: 10, windowMs: 60_000 });
      assert.equal(check.allowed, true, `guess ${i} should still be available`);
    }
  });

  test('the verification call is itself bounded, so failing it is not free', async () => {
    const { guesses, verify } = scopes();
    const route = createRoute({
      sameOrigin: false,
      captcha: { rateLimit: { scope: verify, max: 3, windowMs: 60_000 } },
      rateLimit: { scope: guesses, max: 10, windowMs: 60_000 },
      handler: () => ({ ok: true }),
    });

    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await route(post())).status);
    assert.deepEqual(statuses, [400, 400, 400, 429, 429]);
  });

  test('with no keys configured the request passes straight through', async () => {
    // The documented escape hatch, asserted at the pipeline level: no keys
    // means the admin login behaves exactly as it did before this feature.
    delete process.env.RECAPTCHA_SITE_KEY;
    delete process.env.RECAPTCHA_SECRET_KEY;
    const { guesses, verify } = scopes();
    const route = createRoute({
      sameOrigin: false,
      captcha: { rateLimit: { scope: verify, max: 3, windowMs: 60_000 } },
      rateLimit: { scope: guesses, max: 10, windowMs: 60_000 },
      handler: () => ({ reached: true }),
    });

    const res = await route(post());
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { reached: true });
  });

  test('the guess limiter still bites once requests get past the captcha', async () => {
    // Same route, no captcha configured on it: the tight budget must behave
    // exactly as it always has for everything that reaches it.
    const { guesses } = scopes();
    const route = createRoute({
      sameOrigin: false,
      rateLimit: { scope: guesses, max: 2, windowMs: 60_000 },
      handler: () => ({ ok: true }),
    });

    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await route(post())).status);
    assert.deepEqual(statuses, [200, 200, 429, 429]);
  });
});
