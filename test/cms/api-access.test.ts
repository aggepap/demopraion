import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { adminApiAccessDenied } from '@/cms/modules/auth/guards';

/**
 * `cms.access` is "may use the admin at all". The shell layout enforced it, the
 * API guards did not — so a role holding, say, `cms.content.read` without
 * `cms.access` was refused every screen yet could call the matching endpoints
 * directly. Session-based API auth now requires it as well.
 */
describe('adminApiAccessDenied', () => {
  test('refuses a session without cms.access with a 403 naming it', async () => {
    const res = adminApiAccessDenied(['cms.content.read']);
    assert.ok(res);
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { ok: false, error: 'forbidden', missing: 'cms.access' });
  });

  test('lets cms.access and the wildcard through', () => {
    assert.equal(adminApiAccessDenied(['cms.access', 'cms.content.read']), null);
    assert.equal(adminApiAccessDenied(['*']), null);
  });

  test('refuses an account with no permissions at all', () => {
    assert.ok(adminApiAccessDenied([]));
  });
});

describe('wiring', () => {
  const guards = readFileSync('src/cms/modules/auth/guards.ts', 'utf8');
  const fn = guards.slice(guards.indexOf('export async function requireApiAuth'));

  test('requireApiAuth checks access before sliding the session', () => {
    assert.ok(fn.includes('adminApiAccessDenied(fresh.permissions)'));
    assert.ok(fn.indexOf('adminApiAccessDenied(') < fn.indexOf('setSessionCookie('));
  });

  test('logout stays reachable without cms.access, so such a session can still end', () => {
    const auth = readFileSync('src/cms/core/routes/auth.ts', 'utf8');
    const logout = auth.slice(auth.indexOf('export const logoutRoute')).split('\nexport const')[0];
    assert.ok(logout.includes('requireApiAuth({ allowWithoutAccess: true })'));
  });
});
