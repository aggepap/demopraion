import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { formatPrice, fromMinor, toMinor } from '@/lib/money';

describe('money', () => {
  test('toMinor converts major → integer cents', () => {
    assert.equal(toMinor(49.99), 4999);
    assert.equal(toMinor(10), 1000);
    assert.equal(toMinor(0), 0);
    assert.equal(toMinor(0.1 + 0.2), 30); // float-safe rounding
  });

  test('fromMinor converts cents → major', () => {
    assert.equal(fromMinor(4999), 49.99);
    assert.equal(fromMinor(0), 0);
  });

  test('formatPrice formats a currency amount', () => {
    const en = formatPrice(49.99, 'EUR', 'en');
    assert.ok(en.includes('49.99'), `got: ${en}`);
    const el = formatPrice(49.99, 'EUR', 'el');
    assert.ok(el.includes('49'), `got: ${el}`);
  });

  test('formatPrice falls back on an invalid currency', () => {
    assert.equal(formatPrice(5, 'NOTACUR', 'en'), '5 NOTACUR');
  });
});
