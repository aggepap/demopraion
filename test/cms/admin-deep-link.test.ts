import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { NextRequest } from 'next/server';

import { ADMIN_PATH_HEADER, requestedAdminPath } from '@/cms/core/admin-deep-link';
import { safeNextPath } from '@/cms/admin/safe-next';
import proxy, { config as proxyConfig } from '@/proxy';

/**
 * Deep links into the admin have to survive the sign-in bounce.
 *
 * The whole `?next=` chain was already built — `requireAuth` emits the param,
 * `LoginForm` reads it, `safeNextPath` hardens it — but its only producer, the
 * shell layout, passed the string literal `'/admin'`. So every deep link landed
 * on the dashboard: open `/admin/orders` signed out and you were sent to
 * `?next=%2Fadmin`, never `%2Fadmin%2Forders`.
 *
 * The layout could not do better on its own: an App Router layout is handed no
 * pathname, and there was no middleware. So middleware now stamps the requested
 * path onto the request and the layout reads it back. Both halves share
 * `ADMIN_PATH_HEADER` — spell it differently in either place and the bug returns
 * silently, falling back to exactly the dashboard redirect being fixed here.
 */

/**
 * Next does not mutate the request object; `NextResponse.next({ request })`
 * encodes the overrides onto the RESPONSE as `x-middleware-override-headers`
 * plus one `x-middleware-request-*` per name, and the framework replays them.
 * Reading them back is the only way to observe from outside what the layout
 * will actually receive.
 */
function overriddenHeader(res: Response, name: string): string | null {
  const overridden = res.headers.get('x-middleware-override-headers')?.split(',') ?? [];
  if (!overridden.map((n) => n.trim()).includes(name)) return null;
  return res.headers.get(`x-middleware-request-${name}`);
}

/* Admin paths take the proxy's early exit, so nothing here reaches the redirect
 * resolver or i18n — no database, no locale negotiation. */
const run = async (url: string, headers?: Record<string, string>) =>
  proxy(new NextRequest(url, headers ? { headers: new Headers(headers) } : undefined));

describe('admin deep links', () => {
  test('the requested path keeps its query string', () => {
    // `/admin/orders?status=paid` and `/admin/orders` are different screens to
    // the person who bookmarked one of them. `safeNextPath` already allows `?`.
    assert.equal(requestedAdminPath({ pathname: '/admin/orders', search: '?status=paid' }),
      '/admin/orders?status=paid');
    assert.equal(requestedAdminPath({ pathname: '/admin/orders', search: '' }), '/admin/orders');
  });

  test('the proxy stamps the requested admin path onto the request', async () => {
    const res = await run('http://localhost:3003/admin/orders?status=paid');
    assert.equal(overriddenHeader(res, ADMIN_PATH_HEADER), '/admin/orders?status=paid');
  });

  test('a nested deep link survives whole', async () => {
    const res = await run('http://localhost:3003/admin/article/abc-123');
    assert.equal(overriddenHeader(res, ADMIN_PATH_HEADER), '/admin/article/abc-123');
  });

  test('a client-supplied header is overwritten, never trusted', async () => {
    // The header is an input to a post-login redirect, so a request arriving
    // with its own copy must not be able to choose where an admin lands.
    const res = await run('http://localhost:3003/admin/orders', {
      [ADMIN_PATH_HEADER]: 'https://evil.tld',
    });
    assert.equal(overriddenHeader(res, ADMIN_PATH_HEADER), '/admin/orders');
  });

  test('what the proxy produces is what safeNextPath accepts', async () => {
    // The two halves have to agree, or the hardening silently eats every real
    // deep link and we are back to the dashboard.
    for (const url of [
      'http://localhost:3003/admin',
      'http://localhost:3003/admin/orders',
      'http://localhost:3003/admin/orders?status=paid&page=2',
      'http://localhost:3003/admin/article/abc-123',
      'http://localhost:3003/admin/settings',
    ]) {
      const stamped = overriddenHeader(await run(url), ADMIN_PATH_HEADER);
      assert.ok(stamped, `${url} was not stamped`);
      assert.equal(safeNextPath(stamped, 'admin'), stamped, `${url} was rejected by safeNextPath`);
    }
  });

  test('the admin is matched without disturbing the site matcher', () => {
    // The site's expression carries the F-050 whole-segment fix; the admin is a
    // separate entry precisely so that one is never edited to make room.
    assert.ok(
      proxyConfig.matcher.includes('/((?!api(?:/|$)|admin(?:/|$)|_next(?:/|$)|_vercel(?:/|$)|.*\\..*).*)'),
      'the site matcher changed — locale routing and SEO redirects run off it',
    );
    assert.ok(proxyConfig.matcher.includes('/admin'), 'the admin root is not matched');
    assert.ok(proxyConfig.matcher.includes('/admin/:path*'), 'admin sub-pages are not matched');
  });

  test('a missing header degrades to the admin root', () => {
    // Exactly today's behaviour, so a request that somehow bypasses the proxy
    // still signs in rather than erroring.
    assert.equal(safeNextPath(null, 'admin'), '/admin');
  });
});
