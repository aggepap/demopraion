import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { collectionSummary, groupSidebarItems, visibleAdminCollections } from '@/cms/admin/shared';
import { shortcodeList } from '@/cms/core/shortcodes';
import { SITEMAP_FAMILIES } from '@/app/sitemap';
import config from '@/site.config';

/**
 * Testimonials, brands and popups are content an editor writes, but they have
 * no page of their own. They used to be `hidden: true` — which hides a
 * collection from the ADMIN, not from the public — so the one screen that
 * edits them was unreachable: nothing in the sidebar, nothing on the
 * dashboard, while the shortcode help pointed people at "Content → Brands".
 */
const summaries = config.collections.map(collectionSummary);

const flags = (over: Record<string, boolean> = {}) => ({
  ...(config.modules as Record<string, boolean>),
  googleReviews: false,
  popups: false,
  ...over,
});

const contentKeys = (moduleFlags: Record<string, boolean>) =>
  groupSidebarItems(visibleAdminCollections(summaries, moduleFlags)).content.map((c) => c.key);

describe('editor-only collections in the admin', () => {
  test('Brands are always listed under Content', () => {
    assert.ok(contentKeys(flags()).includes('brand'));
  });

  test('Testimonials are listed under Content while the Google reviews module is on', () => {
    assert.ok(contentKeys(flags({ googleReviews: true })).includes('testimonial'));
  });

  test('Testimonials are not listed while the Google reviews module is off', () => {
    assert.ok(!contentKeys(flags({ googleReviews: false })).includes('testimonial'));
  });

  test('Popups are listed under Content while the popups module is on, and not otherwise', () => {
    assert.ok(contentKeys(flags({ popups: true })).includes('popup'));
    assert.ok(!contentKeys(flags({ popups: false })).includes('popup'));
  });

  test('the dashboard list agrees with the sidebar', () => {
    const on = flags({ googleReviews: true, popups: true });
    const keys = visibleAdminCollections(summaries, on).map((c) => c.key);
    for (const key of ['brand', 'testimonial', 'popup']) assert.ok(keys.includes(key), key);
  });

  test('a collection that really is hidden stays out of the admin', () => {
    const secret = { ...summaries[0], key: 'secret', hidden: true };
    assert.deepEqual(visibleAdminCollections([secret], flags()), []);
  });

  test('a collection of a switched-off module stays out of the admin', () => {
    const product = summaries.find((c) => c.key === 'product');
    assert.ok(product, 'fixture: the base registers the product collection');
    assert.ok(!visibleAdminCollections(summaries, flags({ commerce: false })).some((c) => c.key === 'product'));
  });
});

describe('editor-only collections have no public page', () => {
  for (const key of ['brand', 'testimonial', 'popup']) {
    test(`${key} has no public route and no sitemap entry`, () => {
      const collection = config.collectionByKey.get(key);
      assert.ok(collection, `${key} is registered`);
      assert.equal(collection.routing.pathTemplate, undefined);
      assert.ok(!SITEMAP_FAMILIES.some((f) => f.type === key));
    });
  }

  test('the testimonial collection belongs to the Google reviews module', () => {
    assert.equal(config.collectionByKey.get('testimonial')?.module, 'googleReviews');
  });
});

describe('shortcode help points at the real screens', () => {
  test('[brands] and [testimonials] name the Content screens they are edited on', () => {
    const byName = new Map(shortcodeList().map((d) => [d.name, d]));
    assert.match(byName.get('brands')?.description ?? '', /Content → Brands/);
    assert.match(byName.get('testimonials')?.description ?? '', /Content → Testimonials/);
  });
});
