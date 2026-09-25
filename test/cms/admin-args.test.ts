import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseAdminArgs } from '@/cms/db/seeds/admin-args';

/**
 * `npm run db:seed-admin -- <email> <password> [name] [--locale <code>]`
 *
 * The admin's locale decides the language of their sign-in code emails. Without
 * the flag the column's database default applies, which is Greek — wrong for the
 * first admin of an English-first site, so the scaffold passes the site's main
 * language here.
 */

describe('parseAdminArgs', () => {
  test('email and password are required', () => {
    assert.throws(() => parseAdminArgs([]), /Usage/);
    assert.throws(() => parseAdminArgs(['a@b.co']), /Usage/);
  });

  test('the name is optional and positional', () => {
    assert.deepEqual(parseAdminArgs(['a@b.co', 'pw']), { email: 'a@b.co', password: 'pw', name: undefined, locale: undefined });
    assert.deepEqual(parseAdminArgs(['a@b.co', 'pw', 'Ann Lee']), {
      email: 'a@b.co',
      password: 'pw',
      name: 'Ann Lee',
      locale: undefined,
    });
  });

  test('--locale sets the admin language, before or after the name, in either form', () => {
    assert.equal(parseAdminArgs(['a@b.co', 'pw', '--locale', 'en']).locale, 'en');
    assert.equal(parseAdminArgs(['a@b.co', 'pw', 'Ann', '--locale=en']).locale, 'en');
    assert.equal(parseAdminArgs(['--locale', 'en', 'a@b.co', 'pw', 'Ann']).name, 'Ann');
  });

  test('a malformed locale is refused rather than stored', () => {
    assert.throws(() => parseAdminArgs(['a@b.co', 'pw', '--locale', 'english!']), /locale/);
    assert.throws(() => parseAdminArgs(['a@b.co', 'pw', '--locale']), /locale/);
  });
});
