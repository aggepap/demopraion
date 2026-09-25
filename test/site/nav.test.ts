import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { LEGAL_LINKS, NAV_ITEMS, navItems } from '@/lib/nav';

const hrefs = (items: ReadonlyArray<{ href: string }>) => items.map((i) => i.href);

describe('navItems', () => {
  test('with no modules on, the nav is exactly the base items', () => {
    assert.deepEqual(hrefs(navItems({})), hrefs(NAV_ITEMS));
  });

  test('a module link appears straight after Home, only while its module is on', () => {
    assert.deepEqual(hrefs(navItems({ commerce: true })).slice(0, 2), ['/', '/shop']);
    assert.deepEqual(hrefs(navItems({ booking: true })).slice(0, 2), ['/', '/booking']);
    assert.ok(!hrefs(navItems({ booking: true })).includes('/shop'));
  });

  test('turning a second module on does not reorder the first', () => {
    assert.deepEqual(hrefs(navItems({ commerce: true, booking: true })).slice(0, 3), ['/', '/booking', '/shop']);
  });

  test('every page reachable from the nav has a contact route', () => {
    assert.ok(hrefs(NAV_ITEMS).includes('/contact'));
  });
});

test('the legal links point at the cookie policy and the two CMS legal pages', () => {
  assert.deepEqual(hrefs(LEGAL_LINKS), ['/privacy', '/terms', '/legal/cookies']);
});
