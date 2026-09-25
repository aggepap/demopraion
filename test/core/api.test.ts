import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import { idParam, uuidParam } from '@/cms/core/api/params';
import { ok, created, noContent, paginated } from '@/cms/core/api/respond';
import { isSameOrigin } from '@/cms/core/api/same-origin';
import {
  ApiError,
  badRequest,
  conflict,
  forbidden,
  invalidInput,
  isDuplicateKeyError,
  notFound,
  unauthorized,
} from '@/cms/core/errors';
import { getAdminPath, isAdminApiPath, isAdminPath } from '@/cms/core/paths';
import { docTag, pathTag, typeTag } from '@/cms/core/read/tags';

describe('ApiError + helpers', () => {
  test('each helper carries the right status/code/message', () => {
    assert.equal(badRequest('nope').status, 400);
    assert.equal(unauthorized().status, 401);
    assert.equal(forbidden().status, 403);
    assert.equal(notFound().status, 404);
    const c = conflict();
    assert.equal(c.status, 409);
    assert.equal(c.message, 'Already exists.');
    const iv = invalidInput({ field: 'x' });
    assert.equal(iv.status, 422);
    assert.equal(iv.message, 'Validation failed.');
    assert.deepEqual(iv.issues, { field: 'x' });
  });

  test('carries optional headers', () => {
    const e = new ApiError('rate_limited', 'slow down', { headers: { 'Retry-After': '5' } });
    assert.equal(e.status, 429);
    assert.deepEqual(e.headers, { 'Retry-After': '5' });
  });
});

describe('idParam', () => {
  test('accepts a positive integer id', () => {
    assert.equal(idParam('1'), 1);
    assert.equal(idParam('42'), 42);
  });

  test('rejects everything that is not one, as a 400', () => {
    // `Number()` turns each of these into NaN, 0 or a float, and an unvalidated
    // NaN reaching Drizzle is a 500 (or a `subjectId: NaN` audit row) instead of
    // the 400 the client actually earned.
    for (const raw of ['abc', '0', '-1', '1.5', '', ' ', '1e3abc', undefined]) {
      assert.throws(
        () => idParam(raw),
        (err: unknown) => err instanceof ApiError && err.status === 400,
        `expected ${JSON.stringify(raw)} to be rejected`,
      );
    }
  });

  test('rejects ids beyond the safe-integer range', () => {
    assert.throws(() => idParam('99999999999999999999'), ApiError);
  });

  test('names the field in the message', () => {
    assert.throws(() => idParam('x', 'version id'), /Invalid version id\./);
  });
});

describe('uuidParam', () => {
  test('accepts the canonical 8-4-4-4-12 form, either case', () => {
    assert.equal(
      uuidParam('0191f0aa-1111-7abc-8def-0123456789ab'),
      '0191f0aa-1111-7abc-8def-0123456789ab',
    );
    assert.equal(
      uuidParam('0191F0AA-1111-7ABC-8DEF-0123456789AB'),
      '0191F0AA-1111-7ABC-8DEF-0123456789AB',
    );
  });

  test('rejects path traversal, which is why this exists', () => {
    // A media uuid reaches `unlink(join(uploadDir, key))`. Before this check the
    // only thing between a URL segment and that call was a comment asserting
    // "key is a uuid — no path separators".
    for (const raw of [
      '../../../etc/passwd',
      '..',
      './x',
      'a/b',
      'a\\b',
      '/etc/passwd',
      '0191f0aa-1111-7abc-8def-0123456789ab/../../x',
    ]) {
      assert.throws(
        () => uuidParam(raw),
        (err: unknown) => err instanceof ApiError && err.status === 400,
        `expected ${JSON.stringify(raw)} to be rejected`,
      );
    }
  });

  test('rejects anything that is merely not a uuid', () => {
    for (const raw of ['', ' ', 'abc', '0191f0aa11117abc8def0123456789ab', undefined]) {
      assert.throws(
        () => uuidParam(raw),
        (err: unknown) => err instanceof ApiError && err.status === 400,
        `expected ${JSON.stringify(raw)} to be rejected`,
      );
    }
  });

  test('names the field in the message', () => {
    assert.throws(() => uuidParam('x', 'media id'), /Invalid media id\./);
  });
});

describe('isDuplicateKeyError', () => {
  test('recognises the MariaDB duplicate-entry shapes', () => {
    assert.equal(isDuplicateKeyError({ code: 'ER_DUP_ENTRY' }), true);
    assert.equal(isDuplicateKeyError({ errno: 1062 }), true);
    assert.equal(isDuplicateKeyError({ message: "Duplicate entry 'x' for key 'y'" }), true);
    assert.equal(isDuplicateKeyError(undefined), false);
    assert.equal(isDuplicateKeyError(new Error('something else')), false);
  });
});

describe('admin paths', () => {
  const original = process.env.ADMIN_PATH;
  afterEach(() => {
    if (original === undefined) delete process.env.ADMIN_PATH;
    else process.env.ADMIN_PATH = original;
  });

  test('defaults to "admin", trims slashes', () => {
    delete process.env.ADMIN_PATH;
    assert.equal(getAdminPath(), 'admin');
    process.env.ADMIN_PATH = '/secret/';
    assert.equal(getAdminPath(), 'secret');
  });

  test('refuses a segment that is not a plain URL slug', () => {
    /*
     * `next.config.ts` interpolates this same value into a path-to-regexp
     * `source` to scope the admin's security headers. A segment carrying `:`,
     * `(`, `*` or a slash either breaks that pattern or matches something other
     * than the admin — and the failure is silent: the admin still renders, at a
     * path whose CSP and COEP headers no longer apply to it. Falling back to
     * the default keeps the page and its headers on the same path.
     */
    for (const raw of ['a:b', 'ad(min', 'ad*min', 'a/b', 'ad min', 'admin?x', '..', 'ådmin']) {
      process.env.ADMIN_PATH = raw;
      assert.equal(getAdminPath(), 'admin', `expected ${JSON.stringify(raw)} to be refused`);
    }
  });

  test('accepts the slug shapes an operator would actually pick', () => {
    for (const raw of ['studio', 'back-office', 'cms_2', 'Admin7']) {
      process.env.ADMIN_PATH = raw;
      assert.equal(getAdminPath(), raw);
    }
  });

  test('isAdminPath / isAdminApiPath', () => {
    delete process.env.ADMIN_PATH;
    assert.equal(isAdminPath('/admin'), true);
    assert.equal(isAdminPath('/admin/users'), true);
    assert.equal(isAdminPath('/administrator'), false);
    assert.equal(isAdminApiPath('/api/cms/orders'), true);
    assert.equal(isAdminApiPath('/api/other'), false);
  });
});

describe('cache tags', () => {
  test('build the documented shapes', () => {
    assert.equal(typeTag('article'), 'cms:type:article');
    assert.equal(docTag('article', 'en', 'x'), 'cms:doc:article:en:x');
    assert.equal(pathTag('/a'), 'cms:path:/a');
  });
});

describe('isSameOrigin', () => {
  const original = process.env.NEXT_PUBLIC_SITE_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = original;
  });
  const req = (origin?: string) =>
    new Request('https://site.test/api/cms/x', origin ? { method: 'POST', headers: { origin } } : { method: 'POST' });

  test('no Origin header → allowed (non-browser client)', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://site.test';
    assert.equal(isSameOrigin(req()), true);
  });

  test('matches / rejects by origin', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://site.test';
    assert.equal(isSameOrigin(req('https://site.test')), true);
    assert.equal(isSameOrigin(req('https://evil.test')), false);
    assert.equal(isSameOrigin(req('not a url')), false);
  });
});

describe('respond envelopes', () => {
  test('ok / created / noContent', async () => {
    const r = ok({ x: 1 });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, data: { x: 1 } });
    assert.equal(created({ x: 1 }).status, 201);
    assert.equal(noContent().status, 204);
  });

  test('paginated computes pageCount (min 1)', async () => {
    assert.deepEqual(await paginated([], { page: 1, pageSize: 10, total: 0 }).json(), {
      ok: true,
      items: [],
      page: 1,
      pageSize: 10,
      total: 0,
      pageCount: 1,
    });
    const body = await paginated([1, 2], { page: 1, pageSize: 10, total: 25 }).json();
    assert.equal(body.pageCount, 3);
    assert.equal(body.total, 25);
  });
});
