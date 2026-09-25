import '../setup/react-global';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { mergeRolesData } from '@/cms/admin/RolesManager';

/**
 * The Roles screen greys out permissions its user cannot grant. That list came
 * only from the server-rendered first load; every write refreshed the state from
 * `GET /api/cms/roles`, whose payload had no `grantable`, so after the first save
 * the picker offered everything again and left the refusal to the server.
 */
describe('RolesManager refresh', () => {
  const initial = { roles: [], assignable: ['cms.access', 'cms.content.read'], grantable: ['cms.access'] };

  test('keeps the grantable list when a refresh does not carry one', () => {
    const next = mergeRolesData(initial, { roles: [], assignable: initial.assignable });
    assert.deepEqual(next.grantable, ['cms.access']);
  });

  test('takes a fresh grantable list when the refresh carries one', () => {
    const next = mergeRolesData(initial, { ...initial, grantable: ['*'] });
    assert.deepEqual(next.grantable, ['*']);
  });

  test('the list route sends the actor’s permissions as grantable', () => {
    const src = readFileSync('src/cms/core/routes/roles.ts', 'utf8');
    const list = src.slice(src.indexOf('export function rolesListRoute')).split('\nexport function')[0];
    assert.match(list, /grantable: auth\.permissions/);
  });
});
