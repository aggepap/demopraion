/**
 * The token layer's pure halves: credential parsing, encryption at rest, the
 * replay cache and scope matching. No database, no HTTP.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

// Set before importing anything that reads it — `getKey()` is lazy, so this
// works, and it is the same trick `test/cms/session.test.ts` uses.
process.env.CMS_TOKEN_ENCRYPTION_KEY = 'a-test-encryption-key-of-sufficient-length-0000';

import {
  CREDENTIAL_PATTERN,
  CredentialParseError,
  KEY_ID_PATTERN,
  parseCredential,
  sameSite,
  SECRET_PATTERN,
} from '@/cms/core/tokens/credential';
import { decryptSecret, encryptSecret, timingSafeEquals } from '@/cms/core/tokens/crypto';
import { claimNonce, nonceCacheSize, resetNonceCache } from '@/cms/core/tokens/replay';
import { hasPerm } from '@/cms/modules/auth/permissions';

const KEY_ID = 'a7f3d9e1c204';
const SECRET = 'sT0pnVYm3Kx7qLwZbA9cRdEfGhJkMnPqRsTuVwXyZ12';

/** The base64url setup string PM emits, built the way PM builds it. */
function setupString(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

describe('credential patterns', () => {
  test('key id is 12 lowercase hex characters', () => {
    assert.ok(KEY_ID_PATTERN.test(KEY_ID));
    assert.ok(!KEY_ID_PATTERN.test('A7F3D9E1C204'), 'uppercase rejected');
    assert.ok(!KEY_ID_PATTERN.test('a7f3d9e1c20'), 'too short rejected');
    assert.ok(!KEY_ID_PATTERN.test('a7f3d9e1c204b'), 'too long rejected');
  });

  test('secret is 32–128 base64url characters', () => {
    assert.ok(SECRET_PATTERN.test(SECRET));
    assert.ok(SECRET_PATTERN.test('-_'.repeat(16)));
    assert.ok(!SECRET_PATTERN.test('short'));
    assert.ok(!SECRET_PATTERN.test(`${'a'.repeat(40)}+`), 'base64 "+" is not base64url');
  });

  test('the whole credential matches PM’s PraionCredential pattern', () => {
    assert.ok(CREDENTIAL_PATTERN.test(`pmk_${KEY_ID}_${SECRET}`));
  });

  test('a hex key id is what makes splitting on "_" unambiguous', () => {
    // The secret alphabet contains `_`; the key id's does not. This is why the
    // key id is hex rather than base64url.
    const m = CREDENTIAL_PATTERN.exec(`pmk_${KEY_ID}_ab_cd${'e'.repeat(28)}`);
    assert.ok(m);
    assert.equal(m[1], KEY_ID);
  });
});

describe('parseCredential', () => {
  test('accepts a bare pmk_ credential', () => {
    const parsed = parseCredential(`pmk_${KEY_ID}_${SECRET}`);
    assert.deepEqual(parsed, { keyId: KEY_ID, secret: SECRET, siteUrl: null });
  });

  test('trims surrounding whitespace from a paste', () => {
    const parsed = parseCredential(`  pmk_${KEY_ID}_${SECRET}\n`);
    assert.equal(parsed.keyId, KEY_ID);
  });

  test('accepts PM’s base64url setup string', () => {
    const s = setupString({ key_id: KEY_ID, secret: SECRET, site_url: 'https://praion.gr' });
    assert.deepEqual(parseCredential(s), {
      keyId: KEY_ID,
      secret: SECRET,
      siteUrl: 'https://praion.gr',
    });
  });

  test('accepts an unpadded setup string — PM strips the "=" padding', () => {
    const s = setupString({ key_id: KEY_ID, secret: SECRET, site_url: 'https://praion.gr' });
    assert.ok(!s.includes('='), 'base64url encoding is already unpadded');
    assert.equal(parseCredential(s).keyId, KEY_ID);
  });

  test('rejects an empty paste', () => {
    assert.throws(() => parseCredential('   '), CredentialParseError);
  });

  test('rejects a truncated pmk_ value with a specific message', () => {
    assert.throws(
      () => parseCredential('pmk_a7f3d9e1c204_tooshort'),
      (err: unknown) =>
        err instanceof CredentialParseError && /not complete/i.test(err.message),
    );
  });

  test('rejects a setup string whose key id is malformed', () => {
    const s = setupString({ key_id: 'NOTHEX000000', secret: SECRET, site_url: 'https://praion.gr' });
    assert.throws(() => parseCredential(s), CredentialParseError);
  });

  test('rejects a setup string whose secret is too short', () => {
    const s = setupString({ key_id: KEY_ID, secret: 'nope', site_url: 'https://praion.gr' });
    assert.throws(() => parseCredential(s), CredentialParseError);
  });

  test('rejects JSON that is not an object', () => {
    assert.throws(() => parseCredential(Buffer.from('"hello"').toString('base64url')), CredentialParseError);
  });

  test('rejects arbitrary text', () => {
    assert.throws(() => parseCredential('this is not a credential at all'), CredentialParseError);
  });

  test('never echoes the pasted value back in the error message', () => {
    const s = setupString({ key_id: KEY_ID, secret: 'nope', site_url: 'https://praion.gr' });
    try {
      parseCredential(s);
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(err instanceof CredentialParseError);
      assert.ok(!err.message.includes(s));
      assert.ok(!err.message.includes(KEY_ID));
    }
  });
});

describe('sameSite', () => {
  test('matches identical origins', () => {
    assert.equal(sameSite('https://praion.gr', 'https://praion.gr'), true);
  });

  test('ignores a trailing slash and a path', () => {
    assert.equal(sameSite('https://praion.gr/', 'https://praion.gr'), true);
    assert.equal(sameSite('https://praion.gr/admin', 'https://praion.gr'), true);
  });

  test('ignores host casing', () => {
    assert.equal(sameSite('https://PRAION.gr', 'https://praion.gr'), true);
  });

  test('refuses a different host — the wrong-site paste', () => {
    assert.equal(sameSite('https://other.example', 'https://praion.gr'), false);
  });

  test('refuses a different scheme', () => {
    assert.equal(sameSite('http://praion.gr', 'https://praion.gr'), false);
  });

  test('refuses a different port', () => {
    assert.equal(sameSite('https://praion.gr:8443', 'https://praion.gr'), false);
  });

  test('refuses unparseable input rather than throwing', () => {
    assert.equal(sameSite('not a url', 'https://praion.gr'), false);
  });
});

describe('secret encryption at rest', () => {
  test('round-trips', () => {
    assert.equal(decryptSecret(encryptSecret(SECRET)), SECRET);
  });

  test('the ciphertext does not contain the plaintext', () => {
    assert.ok(!encryptSecret(SECRET).includes(SECRET));
  });

  test('is non-deterministic — a fresh IV each time', () => {
    assert.notEqual(encryptSecret(SECRET), encryptSecret(SECRET));
  });

  test('fits comfortably inside varbinary(255)', () => {
    assert.ok(encryptSecret(SECRET).length < 255);
  });

  test('a tampered ciphertext throws rather than decrypting to something else', () => {
    const stored = encryptSecret(SECRET);
    const bytes = Buffer.from(stored, 'base64');
    bytes[bytes.length - 1] ^= 0xff;
    assert.throws(() => decryptSecret(bytes.toString('base64')));
  });

  test('a truncated value throws', () => {
    assert.throws(() => decryptSecret(Buffer.alloc(8).toString('base64')));
  });

  test('round-trips a UTF-8 secret', () => {
    assert.equal(decryptSecret(encryptSecret('Καλημέρα')), 'Καλημέρα');
  });
});

describe('timingSafeEquals', () => {
  test('matches identical strings', () => {
    assert.equal(timingSafeEquals('abc123', 'abc123'), true);
  });

  test('rejects different strings of equal length', () => {
    assert.equal(timingSafeEquals('abc123', 'abc124'), false);
  });

  test('rejects different lengths without throwing', () => {
    assert.equal(timingSafeEquals('abc', 'abc123'), false);
  });

  test('rejects null and undefined and empty', () => {
    assert.equal(timingSafeEquals(null, 'x'), false);
    assert.equal(timingSafeEquals(undefined, 'x'), false);
    assert.equal(timingSafeEquals('', 'x'), false);
  });
});

describe('replay cache', () => {
  const NONCE = '9f2c8b41d7e35a06c1f84b29e7d05a13';

  test('a nonce may be claimed once', () => {
    resetNonceCache();
    assert.equal(claimNonce(NONCE, 1_000), true);
    assert.equal(claimNonce(NONCE, 1_000), false, 'the replay is refused');
  });

  test('distinct nonces do not collide', () => {
    resetNonceCache();
    assert.equal(claimNonce('a'.repeat(32), 1_000), true);
    assert.equal(claimNonce('b'.repeat(32), 1_000), true);
  });

  test('entries expire once the clock window has passed', () => {
    resetNonceCache();
    assert.equal(claimNonce(NONCE, 1_000), true);
    // Beyond the 300s window the entry is meaningless — and unreachable anyway,
    // because such a timestamp fails the window check before we get here.
    assert.equal(claimNonce(NONCE, 1_000 + 301), true);
  });

  test('sweeping keeps the cache from growing without bound', () => {
    resetNonceCache();
    for (let i = 0; i < 50; i += 1) {
      claimNonce(String(i).padStart(32, '0'), 1_000);
    }
    assert.equal(nonceCacheSize(), 50);
    claimNonce('f'.repeat(32), 1_000 + 301);
    assert.equal(nonceCacheSize(), 1, 'the expired entries were swept');
  });
});

describe('scope matching reuses hasPerm', () => {
  test('an exact scope grants itself only', () => {
    assert.equal(hasPerm(['pm:read'], 'pm:read'), true);
    assert.equal(hasPerm(['pm:read'], 'pm:write'), false);
  });

  test('pm:* grants every pm scope', () => {
    for (const s of ['pm:read', 'pm:write', 'pm:payload', 'pm:media']) {
      assert.equal(hasPerm(['pm:*'], s), true, s);
    }
  });

  test('pm:* does not grant an admin permission', () => {
    assert.equal(hasPerm(['pm:*'], 'cms.content.write'), false);
  });

  test('a read-only token cannot write', () => {
    assert.equal(hasPerm(['pm:read'], 'pm:write'), false);
  });

  test('the dotted admin wildcard still behaves as before', () => {
    assert.equal(hasPerm(['cms.seo.*'], 'cms.seo.read'), true);
    assert.equal(hasPerm(['cms.seo.*'], 'cms.seoextra'), false, 'the separator stays in the prefix');
    assert.equal(hasPerm(['*'], 'anything.at.all'), true);
  });

  test('an empty scope list grants nothing', () => {
    assert.equal(hasPerm([], 'pm:read'), false);
  });
});
