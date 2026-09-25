/**
 * Golden vectors for the PM-HMAC-SHA256 canonical string.
 *
 * These are NOT written from the spec document. They were produced by running
 * Product Manager's own construction — `PraionRequestSigner::canonicalString()`,
 * reproduced byte-for-byte in PHP — over a fixed key, timestamp and nonce, and
 * committing what came out. That is the whole point: if either implementation
 * drifts, it fails here rather than as an opaque 401 in production.
 *
 * To regenerate, see `docs/PM_BRIDGE_SPEC.md` §14.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  ALGORITHM_LABEL,
  CLOCK_SKEW_SECONDS,
  canonicalString,
  computeSignature,
  sha256Hex,
  signatureMatches,
  timestampInWindow,
} from '@/cms/core/tokens/signature';

const SECRET = 'aGVsbG8td29ybGQtdGhpcy1pcy1hLXRlc3Qtc2VjcmV0';

interface Vector {
  name: string;
  method: string;
  url: string;
  body: string;
  timestamp: number;
  nonce: string;
  canonical: string;
  signature: string;
}

const VECTORS: Vector[] = [
  {
    name: 'GET with no query',
    method: 'GET',
    url: 'https://praion.gr/api/cms/pm/v1/ping',
    body: '',
    timestamp: 1786312400,
    nonce: '9f2c8b41d7e35a06c1f84b29e7d05a13',
    canonical:
      'PM-HMAC-SHA256\nGET\npraion.gr\n/api/cms/pm/v1/ping\n1786312400\n' +
      '9f2c8b41d7e35a06c1f84b29e7d05a13\n' +
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    signature: 'd0ac9ea59ff66de92ea5d7ef7baffabb60b8fbf694f1e7687de8e114d7c1e90d',
  },
  {
    name: 'GET with query params',
    method: 'GET',
    url: 'https://praion.gr/api/cms/pm/v1/pages?page=2&per_page=25',
    body: '',
    timestamp: 1786312400,
    nonce: '0123456789abcdef0123456789abcdef',
    canonical:
      'PM-HMAC-SHA256\nGET\npraion.gr\n/api/cms/pm/v1/pages?page=2&per_page=25\n1786312400\n' +
      '0123456789abcdef0123456789abcdef\n' +
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    signature: 'f99f2c48b4388c83c0f6e6e87a0f2b172b6a0f314c86637381adb3b2038edec0',
  },
  {
    // Pins two things at once: a UTF-8 body, and the `doc:42` colon surviving
    // in the path unencoded.
    name: 'PATCH with a UTF-8 body',
    method: 'PATCH',
    url: 'https://praion.gr/api/cms/pm/v1/pages/wp_post/doc:42',
    body: '{"values":{"seo_title":"Καλημέρα / hello"},"source":"pushed_to_pm"}',
    timestamp: 1786312400,
    nonce: 'abcdefabcdefabcdefabcdefabcdefab',
    canonical:
      'PM-HMAC-SHA256\nPATCH\npraion.gr\n/api/cms/pm/v1/pages/wp_post/doc:42\n1786312400\n' +
      'abcdefabcdefabcdefabcdefabcdefab\n' +
      '64518ac8aca44aef18cf23a78e7a2840b9a697ca4fd7b197809e1cc6cf93a044',
    signature: '206f5d64ca8581fb852493f40f68d65a9e82866ab31df179128c58fbc9489fbd',
  },
  {
    // Host lowercased, non-default port kept: `example.test` and
    // `example.test:8443` are different origins and must not share a signature.
    name: 'uppercase host with a non-default port',
    method: 'GET',
    url: 'https://Praion.TEST:8443/api/cms/pm/v1/ping',
    body: '',
    timestamp: 1786312400,
    nonce: 'ffffffffffffffffffffffffffffffff',
    canonical:
      'PM-HMAC-SHA256\nGET\npraion.test:8443\n/api/cms/pm/v1/ping\n1786312400\n' +
      'ffffffffffffffffffffffffffffffff\n' +
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    signature: '5d40a86ec982f8c01bad47817348689979b0d99e6d10c06e5654355f3005d208',
  },
];

describe('PM canonical string — golden vectors from PM’s own signer', () => {
  for (const v of VECTORS) {
    test(`${v.name}: canonical string`, () => {
      assert.equal(
        canonicalString({
          method: v.method,
          url: v.url,
          body: v.body,
          timestamp: v.timestamp,
          nonce: v.nonce,
        }),
        v.canonical,
      );
    });

    test(`${v.name}: signature`, () => {
      assert.equal(
        computeSignature(SECRET, {
          method: v.method,
          url: v.url,
          body: v.body,
          timestamp: v.timestamp,
          nonce: v.nonce,
        }),
        v.signature,
      );
    });
  }

  test('is seven lines joined with \\n and no trailing newline', () => {
    const lines = VECTORS[0].canonical.split('\n');
    assert.equal(lines.length, 7);
    assert.equal(lines[0], ALGORITHM_LABEL);
    assert.ok(!VECTORS[0].canonical.endsWith('\n'));
  });

  test('an empty body hashes to sha256("")', () => {
    assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  test('a default port is not written into the host line', () => {
    const withPort = canonicalString({
      method: 'GET',
      url: 'https://praion.gr:443/api/cms/pm/v1/ping',
      body: '',
      timestamp: 1786312400,
      nonce: '9f2c8b41d7e35a06c1f84b29e7d05a13',
    });
    assert.equal(withPort, VECTORS[0].canonical);
  });

  test('a path with no query produces no trailing "?"', () => {
    assert.ok(VECTORS[0].canonical.includes('\n/api/cms/pm/v1/ping\n'));
  });
});

describe('signature tampering', () => {
  const base = {
    method: 'PATCH',
    url: 'https://praion.gr/api/cms/pm/v1/pages/wp_post/doc:42',
    body: '{"values":{"seo_title":"a"}}',
    timestamp: 1786312400,
    nonce: 'abcdefabcdefabcdefabcdefabcdefab',
  };
  const good = computeSignature(SECRET, base);

  test('flipping one byte of the body breaks it', () => {
    const tampered = computeSignature(SECRET, { ...base, body: '{"values":{"seo_title":"b"}}' });
    assert.notEqual(tampered, good);
  });

  test('replaying a GET signature as a PATCH breaks it', () => {
    assert.notEqual(computeSignature(SECRET, { ...base, method: 'GET' }), good);
  });

  test('aiming a signature at another host breaks it', () => {
    const elsewhere = computeSignature(SECRET, {
      ...base,
      url: 'https://evil.example/api/cms/pm/v1/pages/wp_post/doc:42',
    });
    assert.notEqual(elsewhere, good);
  });

  test('changing the query breaks it', () => {
    const a = computeSignature(SECRET, { ...base, url: 'https://praion.gr/x?page=1' });
    const b = computeSignature(SECRET, { ...base, url: 'https://praion.gr/x?page=2' });
    assert.notEqual(a, b);
  });

  test('a different secret breaks it', () => {
    assert.notEqual(computeSignature('a-different-secret-entirely-0000000000', base), good);
  });
});

describe('signatureMatches', () => {
  const digest = 'a'.repeat(64);

  test('accepts the sha256= prefix PM sends', () => {
    assert.equal(signatureMatches(`sha256=${digest}`, digest), true);
  });

  test('accepts a bare digest', () => {
    assert.equal(signatureMatches(digest, digest), true);
  });

  test('is case-insensitive on the hex', () => {
    assert.equal(signatureMatches(`sha256=${digest.toUpperCase()}`, digest), true);
  });

  test('rejects null, a wrong length, and non-hex', () => {
    assert.equal(signatureMatches(null, digest), false);
    assert.equal(signatureMatches('sha256=abcd', digest), false);
    assert.equal(signatureMatches(`sha256=${'z'.repeat(64)}`, digest), false);
  });

  test('rejects a digest that differs in one character', () => {
    assert.equal(signatureMatches(`sha256=${'a'.repeat(63)}b`, digest), false);
  });
});

describe('timestamp window', () => {
  const now = 1786312400;

  test('accepts the edges of the window', () => {
    assert.equal(timestampInWindow(now - CLOCK_SKEW_SECONDS, now), true);
    assert.equal(timestampInWindow(now + CLOCK_SKEW_SECONDS, now), true);
  });

  test('rejects a timestamp ten minutes old', () => {
    assert.equal(timestampInWindow(now - 600, now), false);
  });

  test('rejects a timestamp far in the future', () => {
    assert.equal(timestampInWindow(now + 600, now), false);
  });

  test('rejects NaN', () => {
    assert.equal(timestampInWindow(Number.NaN, now), false);
  });
});
