import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import el from '../../messages/el.json';
import en from '../../messages/en.json';

/**
 * next-intl resolves keys at render time, so a key present in one locale and
 * missing in the other is invisible until someone switches language and hits
 * that exact screen. This makes it a build-time failure instead.
 */
function flatten(value: unknown, prefix = ''): Set<string> {
  const out = new Set<string>();
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (child && typeof child === 'object' && !Array.isArray(child)) {
        for (const nested of flatten(child, path)) out.add(nested);
      } else {
        out.add(path);
      }
    }
  }
  return out;
}

const elKeys = flatten(el);
const enKeys = flatten(en);

describe('message catalogs', () => {
  test('el and en define exactly the same keys', () => {
    const missingInEn = [...elKeys].filter((k) => !enKeys.has(k)).sort();
    const missingInEl = [...enKeys].filter((k) => !elKeys.has(k)).sort();
    assert.deepEqual(missingInEn, [], 'keys present in el but missing in en');
    assert.deepEqual(missingInEl, [], 'keys present in en but missing in el');
  });

  test('no value is left as an empty string', () => {
    const empties: string[] = [];
    const walk = (value: unknown, prefix: string) => {
      if (typeof value === 'string') {
        if (value.trim() === '') empties.push(prefix);
        return;
      }
      if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          walk(v, prefix ? `${prefix}.${k}` : k);
        }
      }
    };
    walk(el, '');
    walk(en, '');
    assert.deepEqual(empties, []);
  });

  test('the booking namespaces are installed in both locales', () => {
    for (const key of ['nav.booking', 'booking.title', 'bookingForm.date', 'bookingLookup.reference']) {
      assert.ok(elKeys.has(key), `el is missing ${key}`);
      assert.ok(enKeys.has(key), `en is missing ${key}`);
    }
  });

  /*
   * An ICU placeholder that exists in one locale and not the other renders as
   * literal text to whoever is reading the other language.
   */
  test('placeholders match across locales', () => {
    const placeholders = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort().join(',');
    const read = (obj: unknown, path: string): unknown =>
      path.split('.').reduce<unknown>((acc, k) => (acc as Record<string, unknown>)?.[k], obj);

    const mismatched: string[] = [];
    for (const key of elKeys) {
      const a = read(el, key);
      const b = read(en, key);
      if (typeof a !== 'string' || typeof b !== 'string') continue;
      if (placeholders(a) !== placeholders(b)) mismatched.push(key);
    }
    assert.deepEqual(mismatched, []);
  });
});
