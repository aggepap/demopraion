/**
 * One-time recovery codes — the way back in when the phone is gone.
 *
 * These are the credential a user writes down or pastes into a password
 * manager, so the two failures that matter are both about what happens to the
 * string in between: it comes back with its dashes, in the wrong case, with a
 * stray space from the copy — and it must still match. The alternative is a
 * user holding a valid code that the login form insists is wrong, at exactly
 * the moment they have no other way in.
 *
 * The generator's own job is narrower: enough entropy that guessing is not a
 * strategy, and no two codes alike in a batch.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  generateRecoveryCodes,
  normalizeRecoveryCode,
  padForHash,
  RECOVERY_CODE_COUNT,
} from '@/cms/core/security/recovery-codes';

describe('generateRecoveryCodes', () => {
  test('produces the documented number of codes by default', () => {
    assert.equal(generateRecoveryCodes().length, RECOVERY_CODE_COUNT);
  });

  test('formats each code as two dash-separated groups of four', () => {
    // Grouped because these get transcribed by hand off a screen; an unbroken
    // run of characters is where people lose their place.
    for (const code of generateRecoveryCodes()) {
      assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/, code);
    }
  });

  test('never repeats a code within a batch', () => {
    const codes = generateRecoveryCodes(50);
    assert.equal(new Set(codes).size, 50);
  });

  test('does not repeat across batches either', () => {
    const a = generateRecoveryCodes();
    const b = generateRecoveryCodes();
    assert.equal(new Set([...a, ...b]).size, a.length + b.length);
  });

  test('omits the characters that get misread off a screen', () => {
    /*
     * No 0/O, 1/I/L or 8/B. A recovery code is read off a screen and typed back
     * under stress; an alphabet where two glyphs look alike turns a valid code
     * into a failed sign-in with no way for the user to tell which it was.
     */
    for (const code of generateRecoveryCodes(200)) {
      assert.ok(!/[01OIL8B]/.test(code), `ambiguous character in ${code}`);
    }
  });
});

describe('normalizeRecoveryCode', () => {
  test('accepts the code exactly as it was displayed', () => {
    const [code] = generateRecoveryCodes(1);
    assert.equal(normalizeRecoveryCode(code), code.replace('-', ''));
  });

  test('survives the round trip through a clipboard', () => {
    // Lowercased by an autocorrecting keyboard, dashes dropped or doubled,
    // padded with the whitespace a copy picks up. All the same code.
    const target = normalizeRecoveryCode('A2C4-E6G7');
    for (const variant of ['a2c4-e6g7', 'A2C4E6G7', ' A2C4-E6G7 ', 'a2c4 e6g7', 'A2C4--E6G7']) {
      assert.equal(normalizeRecoveryCode(variant), target, variant);
    }
  });

  test('does not collapse two different codes into one', () => {
    // The normaliser strips separators; it must not strip anything meaningful,
    // or two distinct codes start matching each other's hashes.
    assert.notEqual(normalizeRecoveryCode('A2C4-E6G7'), normalizeRecoveryCode('A2C4-E6G9'));
  });

  test('returns an empty string for junk rather than throwing', () => {
    for (const bad of ['', '   ', '----']) {
      assert.equal(normalizeRecoveryCode(bad), '');
    }
  });
});

describe('padForHash', () => {
  /*
   * The bug this locks down, found by driving a real enrollment: recovery codes
   * and emailed codes are both stored with `hashPassword`, which REFUSES
   * anything under `MIN_PASSWORD_LENGTH` (10) — and a recovery code normalises
   * to 8 characters, a mailed code to 6. Enrollment therefore switched the
   * second factor on and then threw while writing the recovery codes: the user
   * got a 500, no codes on screen, and an account that now demanded a factor
   * they had no way back from.
   *
   * The padding is what keeps ONE hashing primitive in the codebase rather than
   * a second one that exists only for short strings.
   */
  test('brings a recovery code up to a length hashPassword accepts', async () => {
    const { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } = await import(
      '@/cms/modules/auth/password'
    );
    const [code] = generateRecoveryCodes(1);
    const padded = padForHash(normalizeRecoveryCode(code));
    assert.ok(padded.length >= MIN_PASSWORD_LENGTH, `${padded.length} < ${MIN_PASSWORD_LENGTH}`);

    const hash = await hashPassword(padded);
    assert.equal(await verifyPassword(padded, hash), true);
  });

  test('brings a six-digit code up to the same length', async () => {
    const { hashPassword, MIN_PASSWORD_LENGTH } = await import('@/cms/modules/auth/password');
    const padded = padForHash('012345');
    assert.ok(padded.length >= MIN_PASSWORD_LENGTH);
    await hashPassword(padded); // must not throw
  });

  test('cannot fold two different codes together', () => {
    // The padding character is outside the generator's alphabet, so a padded
    // short code can never equal a padded longer one.
    assert.notEqual(padForHash('A2C4E6G7'), padForHash('A2C4E6G9'));
    assert.notEqual(padForHash('123456'), padForHash('12345600'));
  });
});
