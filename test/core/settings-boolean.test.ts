import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { MANAGED_SETTINGS, readBooleanSetting, type SettingFieldDef } from '@/cms/core/settings/schema';
import { validateSettingValue } from '@/cms/core/settings/validate';

/**
 * A real on/off setting type.
 *
 * Toggles used to be `select` fields with `on`/`off` options, because the form had
 * no checkbox. The stored shape stays a string — every setting is text end to end —
 * so a boolean is `on` or `off`, and the reader treats anything else as off. That
 * default belongs in the reader: an unsaved key must never read as "enabled".
 */

const toggle: SettingFieldDef = {
  key: 'ecommerce.example.enabled',
  label: 'Example',
  type: 'boolean',
  group: 'Ecommerce',
};

describe('boolean settings', () => {
  test('accepts on, off and empty', () => {
    for (const value of ['on', 'off', '']) {
      const res = validateSettingValue(toggle.key, toggle, value);
      assert.deepEqual(res, { ok: true, value }, value);
    }
  });

  test('a null value is stored as empty, which reads as off', () => {
    assert.deepEqual(validateSettingValue(toggle.key, toggle, null), { ok: true, value: '' });
  });

  test('refuses anything that is not exactly on or off', () => {
    for (const value of ['true', 'ON', 'yes', '1', ' on']) {
      const res = validateSettingValue(toggle.key, toggle, value);
      assert.equal(res.ok, false, value);
    }
  });

  test('refuses a JSON boolean rather than guessing what it meant', () => {
    const res = validateSettingValue(toggle.key, toggle, true);
    assert.equal(res.ok, false);
  });

  test('the reader is on only for exactly "on"', () => {
    assert.equal(readBooleanSetting('on'), true);
    for (const raw of ['off', '', null, undefined, true, 'true', 'ON', 1]) {
      assert.equal(readBooleanSetting(raw), false, JSON.stringify(raw));
    }
  });

  test('a boolean declared with a default of "on" still reads unset as off', () => {
    // defaultValue is what the form shows, not what an unsaved key means.
    assert.equal(readBooleanSetting(undefined), false);
  });

  test('every declared boolean defaults to on or off, if it declares a default', () => {
    for (const f of MANAGED_SETTINGS.filter((d) => d.type === 'boolean')) {
      if (f.defaultValue !== undefined) assert.ok(['on', 'off'].includes(f.defaultValue), f.key);
    }
  });
});

describe('validateSettingValue keeps its existing behaviour', () => {
  const money: SettingFieldDef = { key: 'm', label: 'Fee', type: 'money', group: 'Ecommerce' };
  const select: SettingFieldDef = {
    key: 's',
    label: 'Mode',
    type: 'select',
    group: 'Booking',
    options: [{ value: 'a' }, { value: 'b' }],
  };

  test('money normalises a comma and refuses a thousands separator', () => {
    assert.deepEqual(validateSettingValue('m', money, '3,50'), { ok: true, value: '3.50' });
    assert.equal(validateSettingValue('m', money, '3,500').ok, false);
  });

  test('select refuses an unlisted option', () => {
    assert.equal(validateSettingValue('s', select, 'c').ok, false);
    assert.deepEqual(validateSettingValue('s', select, 'a'), { ok: true, value: 'a' });
  });

  test('a module flag must be a real boolean', () => {
    assert.equal(validateSettingValue('module.commerce', undefined, 'false').ok, false);
    assert.deepEqual(validateSettingValue('module.commerce', undefined, false), {
      ok: true,
      value: false,
    });
  });
});
