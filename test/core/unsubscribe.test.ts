/**
 * Signed unsubscribe links.
 *
 * The signature is what authorises the endpoint — it is reached from an email
 * client, so there is no session and no same-origin check to lean on. Two things
 * matter: a link we issued must keep working (an unsubscribe that 400s is worse
 * than no unsubscribe at all), and a link we did not issue must not work, or
 * anyone could suppress an address they merely guessed.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

// Set before importing: the module reads it lazily, but being explicit here
// documents that these functions need a signing secret at all.
process.env.ADMIN_SESSION_SECRET = 'test-secret-that-is-at-least-32-chars-long';

import {
  normalizeEmail,
  unsubscribeSignature,
  unsubscribeSignatureMatches,
  unsubscribeUrl,
} from '@/cms/core/email/unsubscribe';

describe('normalizeEmail', () => {
  test('lowercases and trims, so one address has one signature', () => {
    // The suppression list stores lowercase; if the MAC were computed over the
    // raw input, `A@x.com` and `a@x.com` would sign differently for what the list
    // treats as a single address.
    assert.equal(normalizeEmail('  A@Example.COM '), 'a@example.com');
  });
});

describe('unsubscribeSignature', () => {
  test('is stable for the same address', () => {
    assert.equal(unsubscribeSignature('a@example.com'), unsubscribeSignature('a@example.com'));
  });

  test('ignores case and surrounding whitespace', () => {
    assert.equal(unsubscribeSignature('A@Example.com'), unsubscribeSignature(' a@example.com '));
  });

  test('differs per address', () => {
    assert.notEqual(unsubscribeSignature('a@example.com'), unsubscribeSignature('b@example.com'));
  });

  test('is URL-safe and short enough not to be wrapped by a mail client', () => {
    const sig = unsubscribeSignature('a@example.com');
    assert.match(sig, /^[A-Za-z0-9_-]+$/);
    assert.equal(sig.length, 32);
  });
});

describe('unsubscribeSignatureMatches', () => {
  test('accepts a signature we issued', () => {
    assert.equal(
      unsubscribeSignatureMatches('a@example.com', unsubscribeSignature('a@example.com')),
      true,
    );
  });

  test('accepts it regardless of how the address is cased in the link', () => {
    assert.equal(
      unsubscribeSignatureMatches('A@EXAMPLE.COM', unsubscribeSignature('a@example.com')),
      true,
    );
  });

  test("rejects another address's signature", () => {
    // Without this, `?e=rival@example.com&s=<my own sig>` would let anyone
    // suppress an address they chose.
    assert.equal(
      unsubscribeSignatureMatches('victim@example.com', unsubscribeSignature('a@example.com')),
      false,
    );
  });

  test('rejects a tampered, truncated or absent signature', () => {
    const sig = unsubscribeSignature('a@example.com');
    assert.equal(unsubscribeSignatureMatches('a@example.com', sig.slice(0, -1)), false);
    assert.equal(unsubscribeSignatureMatches('a@example.com', `${sig}x`), false);
    assert.equal(unsubscribeSignatureMatches('a@example.com', 'nonsense'), false);
    assert.equal(unsubscribeSignatureMatches('a@example.com', ''), false);
    assert.equal(unsubscribeSignatureMatches('a@example.com', null), false);
  });

  test('a missing secret reads as invalid, never as valid', () => {
    const saved = process.env.ADMIN_SESSION_SECRET;
    const sig = unsubscribeSignature('a@example.com');
    try {
      delete process.env.ADMIN_SESSION_SECRET;
      // Failing closed matters: the alternative is that a deploy without the
      // secret accepts every signature and lets anyone suppress anyone.
      assert.equal(unsubscribeSignatureMatches('a@example.com', sig), false);
    } finally {
      process.env.ADMIN_SESSION_SECRET = saved;
    }
  });
});

describe('unsubscribeUrl', () => {
  test('carries the normalised address and its signature', () => {
    const url = new URL(unsubscribeUrl('https://praion.gr', ' A@Example.com '));
    assert.equal(url.origin + url.pathname, 'https://praion.gr/api/cms/commerce/unsubscribe');
    assert.equal(url.searchParams.get('e'), 'a@example.com');
    assert.equal(
      unsubscribeSignatureMatches(url.searchParams.get('e')!, url.searchParams.get('s')),
      true,
    );
  });

  test('round-trips a URL-hostile address', () => {
    // `+` is legal in a local part and is a space when naively decoded, so the
    // link has to be properly encoded or tagged addresses silently break.
    const email = 'a+tag@example.com';
    const url = new URL(unsubscribeUrl('https://praion.gr', email));
    assert.equal(url.searchParams.get('e'), email);
    assert.equal(unsubscribeSignatureMatches(email, url.searchParams.get('s')), true);
  });

  test('passes the locale through only when given', () => {
    assert.equal(new URL(unsubscribeUrl('https://praion.gr', 'a@x.com')).searchParams.has('locale'), false);
    assert.equal(
      new URL(unsubscribeUrl('https://praion.gr', 'a@x.com', 'en')).searchParams.get('locale'),
      'en',
    );
  });
});
