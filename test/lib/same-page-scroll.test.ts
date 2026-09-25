import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { samePageScrollTarget } from '@/lib/same-page-scroll';

/**
 * A footer link to the page already on screen used to do nothing: the router
 * skips scrolling when the URL does not change, so the reader clicked "Pricing"
 * on /pricing and stayed staring at the footer.
 */

describe('links to another page', () => {
  test('are left to the router', () => {
    assert.equal(samePageScrollTarget('/seo-check', '/digital-footprint'), null);
    assert.equal(samePageScrollTarget('/pricing#other-services', '/'), null);
  });

  test('a sub-page is not the same page', () => {
    assert.equal(samePageScrollTarget('/approach/cases', '/approach'), null);
    assert.equal(samePageScrollTarget('/approach', '/approach/cases'), null);
  });

  test('anything that is not a root-relative path is ignored', () => {
    assert.equal(samePageScrollTarget('mailto:info@praion.gr', '/'), null);
    assert.equal(samePageScrollTarget('https://praion.gr/pricing', '/pricing'), null);
  });
});

describe('links to the current page', () => {
  test('without a hash, scroll to the top', () => {
    assert.deepEqual(samePageScrollTarget('/pricing', '/pricing'), { kind: 'top' });
    assert.deepEqual(samePageScrollTarget('/', '/'), { kind: 'top' });
  });

  test('a trailing slash on either side is the same page', () => {
    assert.deepEqual(samePageScrollTarget('/pricing/', '/pricing'), { kind: 'top' });
    assert.deepEqual(samePageScrollTarget('/pricing', '/pricing/'), { kind: 'top' });
  });

  test('with a hash, scroll to that anchor', () => {
    assert.deepEqual(samePageScrollTarget('/pricing#other-services', '/pricing'), {
      kind: 'anchor',
      id: 'other-services',
    });
  });

  test('#top and a bare # mean the top, as they do in the browser', () => {
    assert.deepEqual(samePageScrollTarget('/pricing#top', '/pricing'), { kind: 'top' });
    assert.deepEqual(samePageScrollTarget('/pricing#', '/pricing'), { kind: 'top' });
  });
});
