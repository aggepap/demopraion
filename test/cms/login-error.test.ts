/**
 * The sign-in form must not let a captcha failure read as a wrong password.
 *
 * Both are rejections of the same submit, and the form used to map everything
 * that was not a 429 to "Invalid email or password." — so a user whose captcha
 * had expired was told their password was wrong, retyped a password that was
 * always correct, and was told the same thing again. The mapping lives here,
 * away from the component, because there is no DOM harness in this suite.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { CmsApiError } from '@/cms/admin/api-client';
import { loginErrorMessage, mfaErrorMessage } from '@/cms/admin/login-error';

describe('loginErrorMessage', () => {
  test('a captcha rejection asks for the captcha, not the password', () => {
    const message = loginErrorMessage(new CmsApiError(400, { error: 'captcha_failed' }));
    assert.match(message, /captcha/i);
    assert.doesNotMatch(message, /password/i);
  });

  test('a 429 keeps the existing throttle wording', () => {
    const message = loginErrorMessage(new CmsApiError(429, { error: 'rate_limited' }));
    assert.match(message, /Too many attempts/);
  });

  test('the per-account lockout also reads as a throttle', () => {
    // The lockout throws `rate_limited` too, so it arrives as a 429 — the user
    // must be told to wait, not that their password is wrong.
    const message = loginErrorMessage(
      new CmsApiError(429, { error: 'rate_limited', message: 'Too many attempts. Try again later.' }),
    );
    assert.match(message, /Too many attempts/);
  });

  test('a bad credential stays generic — no user enumeration', () => {
    const message = loginErrorMessage(new CmsApiError(401, { error: 'unauthorized' }));
    assert.equal(message, 'Invalid email or password.');
  });

  test('anything unrecognised falls back to the generic message', () => {
    for (const err of [new Error('boom'), null, undefined, 'nope', new CmsApiError(500, { error: 'server_error' })]) {
      assert.equal(loginErrorMessage(err), 'Invalid email or password.');
    }
  });
});

describe('mfaErrorMessage', () => {
  test('names a bad code instead of blaming the password', () => {
    /*
     * The reason this is a SEPARATE function rather than another branch in
     * `loginErrorMessage`: that one falls back to "Invalid email or password",
     * which on the code step is not merely unhelpful but wrong — it sends
     * somebody to retype a password that was accepted a moment ago, and their
     * next attempt starts the whole sign-in again.
     */
    const err = new CmsApiError(401, { error: 'mfa_invalid', message: 'That code is not valid.' });
    const msg = mfaErrorMessage(err);
    assert.match(msg, /code/i);
    assert.ok(!/password/i.test(msg));
  });

  test('reports a throttle as a throttle', () => {
    const err = new CmsApiError(429, { error: 'rate_limited' });
    assert.match(mfaErrorMessage(err), /too many/i);
  });

  test('tells an expired challenge to start again', () => {
    // A 401 that is not `mfa_invalid` means the ten-minute challenge is gone.
    // "Wrong code" would be a lie and would leave the user retrying a form
    // whose cookie no longer exists.
    const err = new CmsApiError(401, { error: 'unauthorized' });
    assert.match(mfaErrorMessage(err), /again/i);
  });

  test('never falls back to the password wording', () => {
    for (const err of [new Error('network'), null, undefined, 'boom']) {
      assert.ok(!/password/i.test(mfaErrorMessage(err)), String(err));
    }
  });
});
