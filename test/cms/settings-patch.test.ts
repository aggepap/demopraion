/**
 * What the Settings screen's main Save sends.
 *
 * It used to send every managed key, every module flag and the language sets on
 * every save — so the first save of an untouched screen stored the defaults it was
 * merely *displaying* (the first option of a select, "all languages enabled"), and
 * a key that had meant "not set, follow the default" silently stopped meaning that.
 * Now a save carries only what differs from what the screen was opened with.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildSettingsPatch, type SettingsSnapshot } from '@/cms/admin/settings-patch';

const opened: SettingsSnapshot = {
  values: { 'site.name': 'Acme', 'ecommerce.currency': 'EUR' },
  modules: { commerce: true, booking: false },
  locales: { editing: ['el', 'en'], public: ['el', 'en'] },
};

describe('buildSettingsPatch', () => {
  test('an untouched screen sends nothing', () => {
    assert.deepEqual(buildSettingsPatch(opened, structuredClone(opened)), {});
  });

  test('only the field that changed is sent', () => {
    const now = structuredClone(opened);
    now.values['site.name'] = 'Acme Ltd';
    assert.deepEqual(buildSettingsPatch(opened, now), { 'site.name': 'Acme Ltd' });
  });

  test('a field changed and changed back is not sent — its stored "unset" survives', () => {
    const now = structuredClone(opened);
    now.values['ecommerce.currency'] = 'USD';
    now.values['ecommerce.currency'] = 'EUR';
    assert.deepEqual(buildSettingsPatch(opened, now), {});
  });

  test('a module flag is sent under its setting key only when flipped', () => {
    const now = structuredClone(opened);
    now.modules.booking = true;
    assert.deepEqual(buildSettingsPatch(opened, now), { 'module.booking': true });
  });

  test('the language sets are sent only when either set changed', () => {
    const now = structuredClone(opened);
    now.locales.public = ['el'];
    assert.deepEqual(buildSettingsPatch(opened, now), {
      'i18n.locales': { editing: ['el', 'en'], public: ['el'] },
    });
  });
});
