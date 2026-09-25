import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { superadminGrant } from '@/cms/db/seeds/admin-args';
import { DEFAULT_ROLES, planRoleSeed } from '@/cms/db/seeds/roles';

/**
 * `seedRoles` runs on every `db:seed-admin`. It used to overwrite the `editor`
 * role's permission list each time, silently reverting whatever an admin had
 * changed on the Roles screen. `superadmin` is `*` and nothing else, so keeping
 * it in sync is harmless and stays; `editor` is only created when missing.
 */
describe('planRoleSeed', () => {
  const role = (name: string) => DEFAULT_ROLES.find((r) => r.name === name)!;

  test('a missing role is created', () => {
    assert.equal(planRoleSeed(role('editor'), false), 'insert');
    assert.equal(planRoleSeed(role('superadmin'), false), 'insert');
  });

  test('an existing superadmin is re-synced to the wildcard', () => {
    assert.equal(planRoleSeed(role('superadmin'), true), 'update');
  });

  test('an existing editor is left as the admin configured it', () => {
    assert.equal(planRoleSeed(role('editor'), true), 'keep');
  });
});

/**
 * `db:seed-admin` is documented as "create the first superadmin (or add another)
 * … grants the superadmin role". For an existing account that already held some
 * other role it granted nothing, and the account stayed whatever it was.
 */
describe('superadminGrant', () => {
  test('no roles → grant', () => {
    assert.equal(superadminGrant([], 1), 'grant');
  });

  test('already superadmin → nothing to do', () => {
    assert.equal(superadminGrant([1], 1), 'none');
  });

  test('another role → replaced by superadmin (one role per account)', () => {
    assert.equal(superadminGrant([2], 1), 'replace');
    assert.equal(superadminGrant([1, 2], 1), 'replace');
  });
});
