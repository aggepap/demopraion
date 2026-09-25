import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { MANAGED_SETTINGS, MODULE_LABELS } from '@/cms/core/settings/schema';
import {
  ACCESS_PERMISSION,
  AREA_LABELS,
  FULL_ACCESS,
  permissionDescription,
  permissionLabel,
  splitPermissionKey,
} from '@/cms/modules/auth/permission-labels';
import { ALL_PERMISSIONS } from '@/cms/modules/auth/permissions';

/**
 * The explanations behind the admin's "i" icons that are data, not markup.
 *
 * A permission, a setting or a module added without one does not break
 * anything — its row just has no "i" — so the gap would only be found by
 * someone assigning a role blind. These guards make the gap a failing test.
 */

describe('permission group names', () => {
  test('every permission area has a readable heading, not its code name', () => {
    for (const key of ALL_PERMISSIONS) {
      const { area } = splitPermissionKey(key);
      assert.ok(AREA_LABELS[area], `area "${area}" (${key}) has no label — the roles screen shows the raw key`);
    }
  });
});

describe('permissionDescription', () => {
  test('every permission the system can grant is explained', () => {
    for (const key of [FULL_ACCESS, ...ALL_PERMISSIONS]) {
      const text = permissionDescription(key);
      assert.ok(text.trim().length > 20, `${key} has no explanation`);
      assert.notEqual(text, permissionLabel(key), `${key} only repeats its label`);
      assert.ok(!text.includes('cms.'), `${key} → explanation speaks in code keys`);
      assert.match(text, /\.$/, `${key} → explanation should be a sentence`);
    }
  });

  test('Access says the admin cannot be opened without it', () => {
    assert.match(permissionDescription(ACCESS_PERMISSION), /sign in|open the admin/i);
  });

  test('a write permission does not claim to include reading', () => {
    // Reading is a separate key everywhere; saying otherwise would mislead whoever builds a role.
    assert.match(permissionDescription('cms.content.write'), /View content/);
  });

  test('an unknown key has no explanation rather than a made-up one', () => {
    assert.equal(permissionDescription('cms.widgets.frobnicate'), '');
  });
});

describe('settings help', () => {
  test('every managed setting explains itself', () => {
    for (const f of MANAGED_SETTINGS) {
      assert.ok(f.description && f.description.trim().length > 0, `${f.key} has no description`);
    }
  });

  test('every labelled module explains what it does and what switching it off does', () => {
    for (const [name, m] of Object.entries(MODULE_LABELS)) {
      assert.ok(m.description && m.description.trim().length > 0, `${name} has no description`);
      assert.ok(m.offNote && /^Off:/.test(m.offNote), `${name} has no visible "Off:" consequence`);
    }
  });
});
