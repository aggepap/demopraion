/**
 * The admin login form is the only unauthenticated, credential-accepting
 * surface in the CMS. reCAPTCHA is what makes each guess cost something, so
 * the two ways it can silently stop working both get a test here:
 *
 *   - failing OPEN when Google is unreachable, which would let anyone disable
 *     the control by blocking one hostname;
 *   - trusting a malformed response body, which would let any 200 from
 *     anything on that address count as a pass.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import {
  CAPTCHA_HEADER,
  captchaEnabled,
  captchaSiteKey,
  interpretCaptchaVerification,
  verifyCaptchaToken,
} from '@/cms/core/security/captcha';

const SITE = 'RECAPTCHA_SITE_KEY';
const SECRET = 'RECAPTCHA_SECRET_KEY';

afterEach(() => {
  delete process.env[SITE];
  delete process.env[SECRET];
});

/** A `fetch` that must never be called; calling it fails the test that used it. */
const forbiddenFetch: typeof fetch = () => {
  throw new Error('fetch must not be called');
};

/** A `fetch` returning `body` as JSON, recording how it was called. */
function jsonFetch(body: unknown) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('interpretCaptchaVerification', () => {
  test('accepts the shape Google actually returns on success', () => {
    assert.equal(interpretCaptchaVerification({ success: true }).ok, true);
    assert.equal(
      interpretCaptchaVerification({ success: true, challenge_ts: '2026-08-26T10:00:00Z' }).ok,
      true,
    );
  });

  test('rejects a failure and carries the error codes through for the log', () => {
    const result = interpretCaptchaVerification({
      success: false,
      'error-codes': ['timeout-or-duplicate'],
    });
    assert.equal(result.ok, false);
    assert.match(result.reason ?? '', /timeout-or-duplicate/);
  });

  test('rejects a failure that names no reason', () => {
    assert.equal(interpretCaptchaVerification({ success: false }).ok, false);
  });

  test('rejects anything that is not an object with a boolean `success`', () => {
    // A truthy-but-not-true `success` is the dangerous case: `if (body.success)`
    // would pass on the string "false".
    for (const payload of [
      null,
      undefined,
      'ok',
      1,
      [],
      {},
      { success: 'true' },
      { success: 'false' },
      { success: 1 },
    ]) {
      const result = interpretCaptchaVerification(payload);
      assert.equal(result.ok, false, `expected ${JSON.stringify(payload) ?? 'undefined'} to fail`);
    }
  });
});

describe('captchaSiteKey / captchaEnabled', () => {
  test('a blank or whitespace-only key reads as unset', () => {
    for (const raw of ['', '   ', '\t']) {
      process.env[SITE] = raw;
      assert.equal(captchaSiteKey(), null, `expected ${JSON.stringify(raw)} to read as unset`);
    }
  });

  test('a set key is returned trimmed', () => {
    process.env[SITE] = '  site-key  ';
    assert.equal(captchaSiteKey(), 'site-key');
  });

  test('enabled only when BOTH keys are present', () => {
    assert.equal(captchaEnabled(), false);
    process.env[SITE] = 'site-key';
    assert.equal(captchaEnabled(), false);
    process.env[SECRET] = 'secret-key';
    assert.equal(captchaEnabled(), true);
    process.env[SITE] = '';
    assert.equal(captchaEnabled(), false);
  });
});

describe('verifyCaptchaToken', () => {
  test('skips verification when no secret is configured', async () => {
    // The documented escape hatch: `npm test`, CI and a fresh clone must work
    // with no Google account. It must not reach the network to decide that.
    const result = await verifyCaptchaToken('anything', forbiddenFetch);
    assert.equal(result.ok, true);
  });

  test('skips verification when the SITE key is missing but the secret is set', async () => {
    /*
     * A half-finished configuration is a lockout, not a defence: the login form
     * renders no widget without a site key, so nothing can ever produce a
     * token, so every sign-in would be refused — including the one that would
     * let someone in to fix it. Skip and complain loudly instead.
     */
    process.env[SECRET] = 'secret-key';
    const result = await verifyCaptchaToken('anything', forbiddenFetch);
    assert.equal(result.ok, true);
  });

  test('verifies once BOTH keys are present', async () => {
    process.env[SITE] = 'site-key';
    process.env[SITE] = 'site-key';
    process.env[SECRET] = 'secret-key';
    const { impl, calls } = jsonFetch({ success: true });
    const result = await verifyCaptchaToken('tok', impl);
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1, 'a fully configured captcha must actually be checked');
  });

  test('rejects a missing token without a network round-trip', async () => {
    process.env[SITE] = 'site-key';
    process.env[SECRET] = 'secret-key';
    for (const token of [null, undefined, '', '   ']) {
      const result = await verifyCaptchaToken(token, forbiddenFetch);
      assert.equal(result.ok, false, `expected ${JSON.stringify(token) ?? 'undefined'} to fail`);
    }
  });

  test('posts the secret and the token to Google', async () => {
    process.env[SITE] = 'site-key';
    process.env[SECRET] = 'secret-key';
    const { impl, calls } = jsonFetch({ success: true });
    const result = await verifyCaptchaToken('tok', impl);
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /^https:\/\/www\.google\.com\/recaptcha\/api\/siteverify$/);
    const body = String(calls[0].init?.body);
    assert.match(body, /secret=secret-key/);
    assert.match(body, /response=tok/);
  });

  test('never forwards the caller IP to Google', async () => {
    /*
     * `remoteip` is optional, and the only address we have is the `x-real-ip`
     * header. That is trustworthy exactly as far as the reverse proxy is
     * configured to overwrite it — and a wrong value here is worse than none,
     * because Google scores the address we hand it, so a spoofed one gets a
     * real user judged on somebody else's reputation. Sending nothing costs a
     * sliver of signal and removes the whole question.
     */
    process.env[SITE] = 'site-key';
    process.env[SECRET] = 'secret-key';
    const { impl, calls } = jsonFetch({ success: true });
    await verifyCaptchaToken('tok', impl);
    assert.ok(!String(calls[0].init?.body).includes('remoteip'));
    assert.ok(!String(calls[0].init?.body).includes('1.2.3.4'));
  });

  test('fails CLOSED when Google cannot be reached', async () => {
    // Failing open here would mean anyone who can block or slow one hostname
    // has turned the captcha off for everybody.
    process.env[SITE] = 'site-key';
    process.env[SECRET] = 'secret-key';
    const failing: typeof fetch = async () => {
      throw new Error('ECONNREFUSED');
    };
    const result = await verifyCaptchaToken('tok', failing);
    assert.equal(result.ok, false);
  });

  test('fails CLOSED on a non-200 from Google', async () => {
    process.env[SITE] = 'site-key';
    process.env[SECRET] = 'secret-key';
    const impl = (async () => new Response('nope', { status: 502 })) as unknown as typeof fetch;
    const result = await verifyCaptchaToken('tok', impl);
    assert.equal(result.ok, false);
  });

  test('fails CLOSED on a 200 whose body is not JSON', async () => {
    process.env[SITE] = 'site-key';
    process.env[SECRET] = 'secret-key';
    const impl = (async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch;
    const result = await verifyCaptchaToken('tok', impl);
    assert.equal(result.ok, false);
  });

  test('rejects the token Google rejects', async () => {
    process.env[SITE] = 'site-key';
    process.env[SECRET] = 'secret-key';
    const { impl } = jsonFetch({ success: false, 'error-codes': ['invalid-input-response'] });
    const result = await verifyCaptchaToken('tok', impl);
    assert.equal(result.ok, false);
    assert.match(result.reason ?? '', /invalid-input-response/);
  });
});

describe('CAPTCHA_HEADER', () => {
  test('is lowercase, because that is how Headers.get is matched', () => {
    assert.equal(CAPTCHA_HEADER, CAPTCHA_HEADER.toLowerCase());
    assert.equal(CAPTCHA_HEADER, 'x-captcha-token');
  });
});
