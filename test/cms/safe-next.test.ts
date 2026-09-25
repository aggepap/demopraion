import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { safeNextPath } from '@/cms/admin/safe-next';

/**
 * The admin login's `?next=` param decides where a just-authenticated admin
 * lands. It comes from the URL, so it is whatever the person who sent the link
 * wants it to be — the case these tests exist for is an attacker mailing an
 * admin `/admin/login?next=https://evil.tld`.
 */
describe('safeNextPath', () => {
  test('honours paths inside the admin', () => {
    assert.equal(safeNextPath('/admin', 'admin'), '/admin');
    assert.equal(safeNextPath('/admin/orders', 'admin'), '/admin/orders');
    assert.equal(safeNextPath('/admin/orders?page=2', 'admin'), '/admin/orders?page=2');
    assert.equal(safeNextPath('/admin?tab=seo', 'admin'), '/admin?tab=seo');
  });

  test('falls back to the admin root for off-site targets', () => {
    for (const raw of [
      'https://evil.tld',
      'http://evil.tld',
      '//evil.tld',
      '/\\evil.tld',
      '\\\\evil.tld',
      'javascript:alert(1)',
      '//evil.tld/admin',
      'evil.tld',
    ]) {
      assert.equal(safeNextPath(raw, 'admin'), '/admin', `expected ${raw} to be rejected`);
    }
  });

  test('rejects prefix look-alikes rather than accepting startsWith', () => {
    // `/adminEVIL` and `/admin@evil.tld` both pass a naive `startsWith('/admin')`.
    assert.equal(safeNextPath('/adminEVIL', 'admin'), '/admin');
    assert.equal(safeNextPath('/admin@evil.tld', 'admin'), '/admin');
    assert.equal(safeNextPath('/administrator', 'admin'), '/admin');
  });

  test('sends anything outside the admin back to the admin root', () => {
    assert.equal(safeNextPath('/shop', 'admin'), '/admin');
    assert.equal(safeNextPath('/', 'admin'), '/admin');
  });

  test('handles an absent or empty param', () => {
    assert.equal(safeNextPath(null, 'admin'), '/admin');
    assert.equal(safeNextPath(undefined, 'admin'), '/admin');
    assert.equal(safeNextPath('', 'admin'), '/admin');
  });

  test('respects a custom ADMIN_PATH segment', () => {
    // The admin segment is configurable, so the allowlist has to follow it.
    assert.equal(safeNextPath('/backstage/users', 'backstage'), '/backstage/users');
    assert.equal(safeNextPath('/admin/users', 'backstage'), '/backstage');
    assert.equal(safeNextPath('/backstage', '/backstage/'), '/backstage');
  });
});
