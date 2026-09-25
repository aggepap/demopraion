import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  isValidSecretKey,
  maskSecret,
  secretHint,
  summariseSecrets,
  type SecretKeyDef,
} from '@/cms/core/secrets/policy';

/**
 * Integration secrets stored in the database (OAuth refresh tokens, API keys).
 *
 * They are encrypted with the same AES-GCM helper as the PM bridge tokens. What
 * this file pins is the part that decides what may cross into the admin UI: a
 * key is only writable if a module declared it, and the admin only ever sees a
 * masked hint, never the value.
 */

const defs: SecretKeyDef[] = [
  { key: 'google.places.apiKey', label: 'Places API key', module: 'googleReviews' },
  { key: 'courier.boxnow.clientSecret', label: 'BoxNow client secret', module: 'commerce' },
];

describe('isValidSecretKey', () => {
  test('accepts dotted lowercase-led names', () => {
    for (const key of ['google.places.apiKey', 'courier.boxnow.clientSecret', 'a.b']) {
      assert.equal(isValidSecretKey(key), true, key);
    }
  });

  test('refuses anything that could be mistaken for a path or query', () => {
    for (const key of ['', 'nodot', '../etc', 'a..b', 'a.b ', 'A.b', 'a.b;drop', 'a'.repeat(129) + '.b']) {
      assert.equal(isValidSecretKey(key), false, key);
    }
  });
});

describe('secretHint / maskSecret', () => {
  test('a long secret shows only its last four characters', () => {
    assert.equal(secretHint('sk_live_abcdefghijkl1234'), '1234');
    assert.equal(maskSecret('1234'), '••••1234');
  });

  test('a short secret shows nothing of itself', () => {
    // Four characters of an eight-character secret is half of it.
    assert.equal(secretHint('short123'), '');
    assert.equal(maskSecret(''), '••••');
  });

  test('surrounding whitespace is not part of the hint', () => {
    assert.equal(secretHint('  sk_live_abcdefghijkl1234\n'), '1234');
  });
});

describe('summariseSecrets', () => {
  test('lists every declared key with whether it is set, never the value', () => {
    const at = new Date('2026-09-01T10:00:00Z');
    const rows = [{ key: 'google.places.apiKey', hint: '1234', updatedAt: at }];
    const out = summariseSecrets(defs, rows);
    assert.deepEqual(out, [
      {
        key: 'google.places.apiKey',
        label: 'Places API key',
        module: 'googleReviews',
        set: true,
        masked: '••••1234',
        updatedAt: at.toISOString(),
      },
      {
        key: 'courier.boxnow.clientSecret',
        label: 'BoxNow client secret',
        module: 'commerce',
        set: false,
        masked: null,
        updatedAt: null,
      },
    ]);
    for (const entry of out) {
      assert.equal('value' in entry, false);
      assert.equal('ciphertext' in entry, false);
    }
  });

  test('a stored row nobody declares any more is not listed', () => {
    const out = summariseSecrets(defs, [{ key: 'old.thing', hint: 'abcd', updatedAt: new Date() }]);
    assert.equal(
      out.some((e) => e.key === 'old.thing'),
      false,
    );
  });
});
