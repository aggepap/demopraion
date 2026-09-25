import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { NextRequest } from 'next/server';

import { adminHref, resolveAdminRequest } from '@/cms/admin/admin-path';
import { ADMIN_PATH_HEADER } from '@/cms/core/admin-deep-link';
import { safeNextPath } from '@/cms/admin/safe-next';
import proxy from '@/proxy';

/**
 * `ADMIN_PATH` used to be only half wired: `getAdminPath()` and the security
 * headers in `next.config.ts` followed it, but the pages are filed under
 * `src/app/admin`, the proxy matched a literal `/admin`, and the sidebar, top
 * bar, lists and redirects all hard-coded `/admin`. Setting it moved the headers
 * and the auth redirects to a path that rendered nothing.
 *
 * The proxy now rewrites `/<ADMIN_PATH>/**` onto the route tree, and every link
 * is built with `adminHref()` from the resolved segment.
 */

function overriddenHeader(res: Response, name: string): string | null {
  const overridden = res.headers.get('x-middleware-override-headers')?.split(',') ?? [];
  if (!overridden.map((n) => n.trim()).includes(name)) return null;
  return res.headers.get(`x-middleware-request-${name}`);
}

const rewriteOf = (res: Response) => {
  const raw = res.headers.get('x-middleware-rewrite');
  return raw ? new URL(raw).pathname + new URL(raw).search : null;
};

const original = process.env.ADMIN_PATH;
afterEach(() => {
  if (original === undefined) delete process.env.ADMIN_PATH;
  else process.env.ADMIN_PATH = original;
});

describe('adminHref', () => {
  test('joins the segment and a path', () => {
    assert.equal(adminHref('admin'), '/admin');
    assert.equal(adminHref('admin', ''), '/admin');
    assert.equal(adminHref('cms', 'article/12'), '/cms/article/12');
    assert.equal(adminHref('cms', '/article/12'), '/cms/article/12');
    assert.equal(adminHref('cms', 'login?timeout=1'), '/cms/login?timeout=1');
    assert.equal(adminHref('cms', '?tab=x'), '/cms?tab=x');
  });
});

describe('resolveAdminRequest', () => {
  test('the default segment maps onto itself', () => {
    assert.deepEqual(resolveAdminRequest('/admin', 'admin'), { kind: 'admin', internal: '/admin' });
    assert.deepEqual(resolveAdminRequest('/admin/orders', 'admin'), { kind: 'admin', internal: '/admin/orders' });
  });

  test('a moved admin is mapped onto the /admin route tree', () => {
    assert.deepEqual(resolveAdminRequest('/back-office', 'back-office'), { kind: 'admin', internal: '/admin' });
    assert.deepEqual(resolveAdminRequest('/back-office/article/12', 'back-office'), {
      kind: 'admin',
      internal: '/admin/article/12',
    });
  });

  test('the route tree itself is hidden once the admin has moved', () => {
    assert.deepEqual(resolveAdminRequest('/admin', 'back-office'), { kind: 'hidden' });
    assert.deepEqual(resolveAdminRequest('/admin/login', 'back-office'), { kind: 'hidden' });
  });

  test('whole segments only', () => {
    assert.deepEqual(resolveAdminRequest('/administrators', 'admin'), { kind: 'site' });
    assert.deepEqual(resolveAdminRequest('/back-office-hours', 'back-office'), { kind: 'site' });
    assert.deepEqual(resolveAdminRequest('/administrators', 'back-office'), { kind: 'site' });
    assert.deepEqual(resolveAdminRequest('/en/about', 'back-office'), { kind: 'site' });
  });
});

describe('proxy with a custom ADMIN_PATH', () => {
  test('rewrites the public admin URL onto the route tree, query intact', async () => {
    process.env.ADMIN_PATH = 'back-office';
    const res = await proxy(new NextRequest('http://localhost:3003/back-office/orders?status=paid'));
    assert.equal(rewriteOf(res), '/admin/orders?status=paid');
  });

  test('stamps the PUBLIC path for the post-login redirect, and safeNextPath keeps it', async () => {
    process.env.ADMIN_PATH = 'back-office';
    const res = await proxy(new NextRequest('http://localhost:3003/back-office/article/12'));
    const stamped = overriddenHeader(res, ADMIN_PATH_HEADER);
    assert.equal(stamped, '/back-office/article/12');
    assert.equal(safeNextPath(stamped, 'back-office'), stamped);
  });

  test('the route tree’s own /admin path 404s once the admin has moved, outside i18n', async () => {
    // Not stamped, not served by the admin pages, and not handed to locale
    // routing (which would redirect or rewrite it into the site): a plain 404.
    process.env.ADMIN_PATH = 'back-office';
    for (const url of ['http://localhost:3003/admin', 'http://localhost:3003/admin/orders']) {
      const res = await proxy(new NextRequest(url));
      assert.equal(res.status, 404, url);
      assert.equal(overriddenHeader(res, ADMIN_PATH_HEADER), null);
      assert.equal(rewriteOf(res), null);
      assert.equal(res.headers.get('location'), null);
    }
  });

  test('the default is untouched: no rewrite, just the stamp', async () => {
    delete process.env.ADMIN_PATH;
    const res = await proxy(new NextRequest('http://localhost:3003/admin/orders'));
    assert.equal(rewriteOf(res), null);
    assert.equal(overriddenHeader(res, ADMIN_PATH_HEADER), '/admin/orders');
  });
});
