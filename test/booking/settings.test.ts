import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { EXTRA_MANAGED_KEYS, MANAGED_SETTINGS, MANAGED_SETTING_KEYS } from '@/cms/core/settings/schema';
import { BOOKING_SETTING_READERS } from '@/cms/modules/booking/settings-read';

/**
 * The point of this file: a settings key with no reader is a switch on the wall
 * wired to no bulb. The admin sets it, nothing changes, and nothing says so.
 * It has happened here enough times to be worth a test rather than a habit.
 */
describe('every booking setting is actually read by something', () => {
  const bookingKeys = [...MANAGED_SETTING_KEYS, ...EXTRA_MANAGED_KEYS].filter((k) => k.startsWith('booking.'));

  test('there are booking settings to check', () => {
    assert.ok(bookingKeys.length > 0, 'no booking.* keys found — has the group been renamed?');
  });

  for (const key of bookingKeys) {
    test(`${key} has a reader`, () => {
      assert.equal(
        typeof BOOKING_SETTING_READERS[key],
        'function',
        `${key} is editable in the admin but nothing reads it — it would govern nothing`,
      );
    });
  }

  test('no reader is registered for a key that does not exist', () => {
    const known = new Set([...MANAGED_SETTING_KEYS, ...EXTRA_MANAGED_KEYS]);
    for (const key of Object.keys(BOOKING_SETTING_READERS)) {
      assert.ok(known.has(key), `${key} has a reader but is not a managed setting, so it can never be written`);
    }
  });
});

describe('the Booking settings group is coherent', () => {
  const bookingFields = MANAGED_SETTINGS.filter((f) => f.group === 'Booking');

  test('every Booking field uses a booking.* key', () => {
    for (const field of bookingFields) {
      assert.ok(field.key.startsWith('booking.'), `${field.key} sits in the Booking group under another prefix`);
    }
  });

  test('every booking.* key sits in the Booking group', () => {
    for (const field of MANAGED_SETTINGS) {
      if (!field.key.startsWith('booking.')) continue;
      assert.equal(field.group, 'Booking', `${field.key} would render on the ${field.group} tab`);
    }
  });

  test('every select offers options', () => {
    for (const field of bookingFields) {
      if (field.type !== 'select') continue;
      assert.ok((field.options?.length ?? 0) > 0, `${field.key} is a select with nothing to select`);
    }
  });

  test('every field has a label, and none is a bare key', () => {
    for (const field of bookingFields) {
      assert.ok(field.label.trim().length > 0, `${field.key} has no label`);
      // Was "contains a dot", which is a proxy for "looks like a key path" —
      // and a false positive for any brand with a TLD in its name (Viva.com).
      // What the rule actually means is: don't show the visitor the key.
      assert.notEqual(field.label.trim(), field.key, `${field.key} is labelled with its own key`);
      assert.ok(
        !/^(booking|ecommerce|site|seo|analytics|cms)\./.test(field.label.trim()),
        `${field.key} is labelled with a settings key path`,
      );
    }
  });
});
