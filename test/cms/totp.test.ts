/**
 * RFC 6238 TOTP, hand-rolled on `node:crypto`.
 *
 * A second factor is only worth having if it is exactly the algorithm every
 * authenticator app implements — "close enough" here means a user scans a QR
 * code, types what their phone shows, and is told it is wrong forever. So the
 * first thing this locks down is the RFC's own published test vectors, which is
 * the only assertion that proves interoperability without a phone in the loop.
 *
 * The second thing is replay. A TOTP code stays valid for roughly ninety
 * seconds once the ±1 step window is allowed, which is ample time for a code
 * read over someone's shoulder — or lifted from a proxy log — to be used again.
 * `lastStep` is what closes that, and it is the part with no visible symptom
 * when it silently stops working.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  otpauthUri,
  totpCode,
  TOTP_STEP_SECONDS,
  verifyTotp,
} from '@/cms/core/security/totp';

/** The RFC 6238 Appendix B seed: ASCII "12345678901234567890". */
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890', 'ascii'));

describe('base32', () => {
  test('round-trips arbitrary bytes', () => {
    for (const sample of ['', 'a', 'ab', 'abc', 'abcd', 'abcde', 'hello world']) {
      const buf = Buffer.from(sample, 'utf8');
      assert.equal(base32Decode(base32Encode(buf)).toString('utf8'), sample);
    }
  });

  test('encodes the RFC seed the way every authenticator app expects', () => {
    assert.equal(RFC_SECRET, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });

  test('accepts what a human actually pastes: lowercase, spaces, padding', () => {
    // Authenticator setup screens show the secret in spaced groups of four, and
    // people paste it back with the spaces intact. Rejecting that reads to the
    // user as "the secret you were just given is wrong".
    const canonical = base32Decode('GEZDGNBVGY3TQOJQ');
    assert.deepEqual(base32Decode('gezdgnbvgy3tqojq'), canonical);
    assert.deepEqual(base32Decode('GEZD GNBV GY3T QOJQ'), canonical);
    assert.deepEqual(base32Decode('GEZDGNBVGY3TQOJQ======'), canonical);
  });

  test('rejects characters outside the alphabet rather than decoding garbage', () => {
    // 0, 1 and 8 are absent from RFC 4648 base32 precisely because they look
    // like O, I and B. Silently mapping them would produce a secret that is
    // wrong in a way nothing downstream can detect.
    assert.throws(() => base32Decode('GEZDGNBV0Y3TQOJQ'), /base32/i);
    assert.throws(() => base32Decode('not-base32!'), /base32/i);
  });
});

describe('totpCode', () => {
  /** RFC 6238 Appendix B, SHA-1 rows. `[unixSeconds, 8-digit code]`. */
  const VECTORS: Array<[number, string]> = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];

  test('matches the RFC 6238 test vectors at 8 digits', () => {
    for (const [seconds, expected] of VECTORS) {
      const step = Math.floor(seconds / TOTP_STEP_SECONDS);
      assert.equal(totpCode(RFC_SECRET, step, 8), expected, `T=${seconds}`);
    }
  });

  test('matches the same vectors truncated to the 6 digits apps display', () => {
    for (const [seconds, expected] of VECTORS) {
      const step = Math.floor(seconds / TOTP_STEP_SECONDS);
      assert.equal(totpCode(RFC_SECRET, step), expected.slice(-6), `T=${seconds}`);
    }
  });

  test('pads to the full width instead of dropping a leading zero', () => {
    // T=1111111109 is `07081804` — a code rendered as `081804` is six digits
    // that will never match, and the failure only shows up about one time in ten.
    assert.equal(totpCode(RFC_SECRET, Math.floor(1111111109 / TOTP_STEP_SECONDS), 8).length, 8);
  });
});

describe('verifyTotp', () => {
  const NOW_MS = 1111111111_000;
  const STEP = Math.floor(1111111111 / TOTP_STEP_SECONDS);

  test('accepts the code for the current step', () => {
    const r = verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, STEP), NOW_MS);
    assert.deepEqual(r, { ok: true, step: STEP });
  });

  test('accepts one step either side, for clock drift', () => {
    for (const offset of [-1, 1]) {
      const r = verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, STEP + offset), NOW_MS);
      assert.deepEqual(r, { ok: true, step: STEP + offset }, `offset ${offset}`);
    }
  });

  test('rejects two steps away — the window is a drift allowance, not a grace period', () => {
    for (const offset of [-2, 2]) {
      assert.deepEqual(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, STEP + offset), NOW_MS), {
        ok: false,
      });
    }
  });

  test('rejects a code whose step has already been spent', () => {
    /*
     * The replay this exists for: a code is valid for ~90s across the window,
     * so an attacker who sees one — over a shoulder, in a proxy log, in a
     * screenshot — can sign in with it after the real user has. Recording the
     * accepted step and refusing anything at or below it closes the window the
     * moment it is used.
     */
    const code = totpCode(RFC_SECRET, STEP);
    assert.deepEqual(verifyTotp(RFC_SECRET, code, NOW_MS, { lastStep: STEP }), { ok: false });
    assert.deepEqual(verifyTotp(RFC_SECRET, code, NOW_MS, { lastStep: STEP + 5 }), { ok: false });
    // A step the user has not reached yet is still fine.
    assert.deepEqual(verifyTotp(RFC_SECRET, code, NOW_MS, { lastStep: STEP - 1 }), {
      ok: true,
      step: STEP,
    });
  });

  test('a spent step does not block the NEXT code', () => {
    // The corollary: locking out the step must not lock out the account. Thirty
    // seconds later the user's phone shows a new code and it has to work.
    const next = totpCode(RFC_SECRET, STEP + 1);
    assert.deepEqual(verifyTotp(RFC_SECRET, next, NOW_MS, { lastStep: STEP }), {
      ok: true,
      step: STEP + 1,
    });
  });

  test('tolerates the spaces an app puts in the middle of a code', () => {
    const spaced = totpCode(RFC_SECRET, STEP).replace(/^(\d{3})/, '$1 ');
    assert.deepEqual(verifyTotp(RFC_SECRET, spaced, NOW_MS), { ok: true, step: STEP });
  });

  test('returns false for malformed input rather than throwing', () => {
    // These arrive straight from a request body. A throw here is a 500 on the
    // login page, which is both a worse error and a liveness signal.
    for (const bad of ['', '   ', '12345', '1234567', 'abcdef', '12345a', '-12345']) {
      assert.deepEqual(verifyTotp(RFC_SECRET, bad, NOW_MS), { ok: false }, JSON.stringify(bad));
    }
  });

  test('a malformed SECRET is refused, not treated as an empty key', () => {
    // A corrupt or truncated column must fail closed. Decoding it to zero bytes
    // and then verifying against that would accept a code anyone can compute.
    assert.deepEqual(verifyTotp('not-base32!', '123456', NOW_MS), { ok: false });
    assert.deepEqual(verifyTotp('', '123456', NOW_MS), { ok: false });
  });
});

describe('generateTotpSecret', () => {
  test('produces a decodable 20-byte secret by default', () => {
    const secret = generateTotpSecret();
    assert.equal(base32Decode(secret).length, 20);
    assert.match(secret, /^[A-Z2-7]+$/);
  });

  test('does not repeat itself', () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateTotpSecret()));
    assert.equal(seen.size, 50);
  });
});

describe('otpauthUri', () => {
  test('builds the URI authenticator apps scan', () => {
    const uri = otpauthUri({ secret: RFC_SECRET, account: 'a@b.co', issuer: 'Praion' });
    assert.match(uri, /^otpauth:\/\/totp\/Praion:a%40b\.co\?/);
    assert.match(uri, /[?&]secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ(&|$)/);
    assert.match(uri, /[?&]issuer=Praion(&|$)/);
    assert.match(uri, /[?&]algorithm=SHA1(&|$)/);
    assert.match(uri, /[?&]digits=6(&|$)/);
    assert.match(uri, /[?&]period=30(&|$)/);
  });

  test('escapes an issuer containing a colon or a slash', () => {
    // The label is `issuer:account` and the path is slash-delimited, so an
    // unescaped site name silently produces a URI that names a different account.
    const uri = otpauthUri({ secret: RFC_SECRET, account: 'a@b.co', issuer: 'A/B: Co' });
    assert.ok(!uri.slice('otpauth://totp/'.length).split('?')[0].includes('/'));
    assert.match(uri, /[?&]issuer=A%2FB%3A%20Co(&|$)/);
  });
});
