import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { assertCanManageAccount } from '@/cms/core/roles/can-grant';
import { ApiError } from '@/cms/core/errors';

/**
 * "You cannot grant what you do not hold", applied to editing an account.
 *
 * `cms.users.manage` lets its holder reset a password, clear a second factor,
 * change a role, disable and delete. Against an account more powerful than the
 * actor, each of those is a takeover or a lockout of that account — so the rule
 * is that the target's effective permissions must all be held by the actor.
 */

const USERS = ['cms.access', 'cms.users.manage'];
const EDITOR = ['cms.access', 'cms.content.read', 'cms.content.write'];

function refused(fn: () => void): ApiError {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof ApiError, 'expected an ApiError');
    return err;
  }
  assert.fail('expected a refusal');
}

describe('assertCanManageAccount', () => {
  test('a users manager cannot touch a superadmin', () => {
    const err = refused(() => assertCanManageAccount(USERS, ['*']));
    assert.equal(err.code, 'forbidden');
    assert.match(err.message, /Full access/);
  });

  test('nor an account holding a permission the actor lacks', () => {
    const err = refused(() => assertCanManageAccount(USERS, EDITOR));
    assert.match(err.message, /View content/);
  });

  test('an account whose permissions the actor holds is fine', () => {
    assert.doesNotThrow(() => assertCanManageAccount([...USERS, ...EDITOR], EDITOR));
    assert.doesNotThrow(() => assertCanManageAccount(['cms.access', 'cms.content.*', 'cms.users.manage'], EDITOR));
  });

  test('a superadmin can manage anyone, including another superadmin', () => {
    assert.doesNotThrow(() => assertCanManageAccount(['*'], ['*']));
    assert.doesNotThrow(() => assertCanManageAccount(['*'], EDITOR));
  });

  test('an account with no role is within anyone’s reach', () => {
    assert.doesNotThrow(() => assertCanManageAccount(USERS, []));
  });

  test('a prefix wildcard on the target needs the same or wider on the actor', () => {
    refused(() => assertCanManageAccount(['cms.content.read', 'cms.content.write'], ['cms.content.*']));
    assert.doesNotThrow(() => assertCanManageAccount(['cms.content.*'], ['cms.content.*']));
  });
});

/**
 * The DB-bound half cannot run without a database, so pin the wiring instead:
 * both writes to another account must pass the reach check before changing
 * anything.
 */
describe('users routes apply the reach check', () => {
  const src = readFileSync('src/cms/core/routes/users.ts', 'utf8');
  const body = (name: string) => src.slice(src.indexOf(`export function ${name}`)).split('\nexport function')[0];

  test('PATCH checks before updateUser', () => {
    const b = body('userUpdateRoute');
    assert.ok(b.includes('assertCanManageUser(id, auth.permissions)'));
    assert.ok(b.indexOf('assertCanManageUser(') < b.indexOf('updateUser('));
  });

  test('DELETE checks before deleteUser', () => {
    const b = body('userDeleteRoute');
    assert.ok(b.includes('assertCanManageUser(id, auth.permissions)'));
    assert.ok(b.indexOf('assertCanManageUser(') < b.indexOf('deleteUser('));
  });
});
