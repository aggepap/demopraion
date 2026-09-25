/**
 * The break-glass bypass code.
 *
 * This is the most dangerous thing in the 2FA feature, so it is the one with
 * the least room for a permissive default. It is a SHARED, STATIC second factor
 * that never rotates — every property below exists to bound that:
 *
 *  - Unset means OFF. Not "off but the endpoint still compares", not "off with
 *    an empty string that an empty submission would match".
 *  - A misconfigured value means OFF TOO. `ADMIN_MFA_BYPASS_CODE=12` must not
 *    become a two-digit bypass; a typo in an env file is not consent to weaken
 *    the door, so anything that is not exactly six digits disables the feature
 *    rather than shrinking it.
 *  - The comparison is constant-time, because a six-digit space is small enough
 *    that a timing oracle is a real shortcut through it.
 *
 * The judgement lives here, pure and testable, exactly as
 * `interpretCaptchaVerification` does for the captcha. The route does the I/O.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  interpretBypassAttempt,
  MFA_BYPASS_CODE_LENGTH,
  readBypassCode,
} from '@/cms/core/security/mfa-bypass';

const GOOD = '481207';

describe('readBypassCode', () => {
  test('returns null when the variable is unset — the feature is off by default', () => {
    delete process.env.ADMIN_MFA_BYPASS_CODE;
    assert.equal(readBypassCode(), null);
  });

  test('returns null for an empty or whitespace value', () => {
    // The dangerous shape: an empty configured code that an empty submission
    // could be compared against.
    for (const raw of ['', '   ']) {
      process.env.ADMIN_MFA_BYPASS_CODE = raw;
      assert.equal(readBypassCode(), null, JSON.stringify(raw));
    }
    delete process.env.ADMIN_MFA_BYPASS_CODE;
  });

  test('refuses a value that is not exactly six digits, rather than accepting a weaker one', () => {
    for (const raw of ['12', '12345', '1234567', 'abcdef', '12345a', '-12345', '12 34 56']) {
      process.env.ADMIN_MFA_BYPASS_CODE = raw;
      assert.equal(readBypassCode(), null, raw);
    }
    delete process.env.ADMIN_MFA_BYPASS_CODE;
  });

  test('accepts a well-formed six-digit code, leading zeros included', () => {
    for (const raw of [GOOD, '000000', '007007']) {
      process.env.ADMIN_MFA_BYPASS_CODE = raw;
      assert.equal(readBypassCode(), raw, raw);
    }
    delete process.env.ADMIN_MFA_BYPASS_CODE;
  });

  test('the documented length is six', () => {
    assert.equal(MFA_BYPASS_CODE_LENGTH, 6);
  });
});

describe('interpretBypassAttempt', () => {
  test('a null configuration refuses everything, including an empty submission', () => {
    for (const submitted of ['', '   ', GOOD, '000000']) {
      assert.deepEqual(
        interpretBypassAttempt(null, submitted),
        { ok: false, reason: 'disabled' },
        JSON.stringify(submitted),
      );
    }
  });

  test('the configured code is accepted', () => {
    assert.deepEqual(interpretBypassAttempt(GOOD, GOOD), { ok: true });
  });

  test('surrounding whitespace on the submission is tolerated', () => {
    // It arrives from an input the user may have pasted into.
    assert.deepEqual(interpretBypassAttempt(GOOD, `  ${GOOD} `), { ok: true });
  });

  test('any other code is refused', () => {
    for (const submitted of ['481208', '148120', '', '48120', '4812077']) {
      assert.deepEqual(
        interpretBypassAttempt(GOOD, submitted),
        { ok: false, reason: 'mismatch' },
        submitted,
      );
    }
  });

  test('a prefix of the real code is not enough', () => {
    // Guards against a comparison that stops at the shorter length.
    assert.deepEqual(interpretBypassAttempt(GOOD, '4812'), { ok: false, reason: 'mismatch' });
    assert.deepEqual(interpretBypassAttempt(GOOD, '4'), { ok: false, reason: 'mismatch' });
  });
});

describe('the bypass is unreachable from the normal code path', () => {
  test('modules/auth/mfa.ts does not reference the bypass at all', async () => {
    /*
     * The requirement in the user's words: the code must work ONLY in the extra
     * dialog, never in the ordinary 2FA field. That cannot be enforced in the
     * browser — the endpoints are reachable with curl — so it is enforced by
     * `verifySecondFactor` having no way to reach the bypass: no import, no env
     * read. This test fails the moment somebody wires the two together for
     * convenience.
     */
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(
      new URL('../../src/cms/modules/auth/mfa.ts', import.meta.url),
      'utf8',
    );
    assert.ok(!source.includes('ADMIN_MFA_BYPASS_CODE'), 'must not read the bypass env var');
    assert.ok(!source.includes('mfa-bypass'), 'must not import the bypass module');
    assert.ok(!/bypass/i.test(source), 'must not mention the bypass at all');
  });
});
