import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  DEFAULT_WISHLIST_MAX_ITEMS,
  decodeWishlistCookie,
  encodeWishlistCookie,
  mergeWishlists,
  parseWishlistConfig,
  sameWishlistItem,
  type WishlistItem,
} from '@/cms/modules/commerce/wishlist-policy';

/**
 * An anonymous wishlist.
 *
 * It holds product and variant ids and nothing else — no prices, no titles, no
 * visitor identifier. Prices and stock are read live when the page is opened,
 * so a wishlist can never show yesterday's price, and there is nothing personal
 * in the cookie that carries it.
 *
 * The merge is what happens when a guest who has been collecting things on
 * their phone finally signs in: the two lists become one, without duplicates
 * and without losing whichever came first.
 */

const item = (productId: number, variationId = ''): WishlistItem => ({ productId, variationId });

describe('encodeWishlistCookie / decodeWishlistCookie', () => {
  test('round-trips a list', () => {
    const items = [item(1), item(2, 'v1')];
    assert.deepEqual(decodeWishlistCookie(encodeWishlistCookie(items)), items);
  });

  test('is compact, because it travels on every request', () => {
    // A cookie is sent with every single request, including images.
    assert.ok(encodeWishlistCookie([item(12), item(34, 'red')]).length < 20);
  });

  test('ignores junk rather than throwing', () => {
    // The cookie is client-writable: anything at all can arrive in it.
    assert.deepEqual(decodeWishlistCookie(''), []);
    assert.deepEqual(decodeWishlistCookie('nonsense'), []);
    assert.deepEqual(decodeWishlistCookie('1:a,,x:y,2:'), [item(1, 'a'), item(2)]);
    assert.deepEqual(decodeWishlistCookie('-1:a'), []);
  });

  test('drops anything past the cap, so the cookie cannot grow without end', () => {
    const many = Array.from({ length: 500 }, (_, i) => item(i + 1));
    assert.equal(
      decodeWishlistCookie(encodeWishlistCookie(many)).length,
      DEFAULT_WISHLIST_MAX_ITEMS
    );
  });

  test('a variant id with a separator in it cannot forge a second entry', () => {
    const [decoded] = decodeWishlistCookie(encodeWishlistCookie([item(1, 'a,2:b')]));
    assert.equal(decoded?.productId, 1);
    assert.equal(decodeWishlistCookie(encodeWishlistCookie([item(1, 'a,2:b')])).length, 1);
  });
});

describe('mergeWishlists', () => {
  test('keeps both lists, server first', () => {
    const out = mergeWishlists([item(1)], [item(2)], 10);
    assert.deepEqual(out, [item(1), item(2)]);
  });

  test('does not duplicate the same product and variant', () => {
    assert.deepEqual(mergeWishlists([item(1, 'v1')], [item(1, 'v1')], 10), [item(1, 'v1')]);
  });

  test('treats two variants of one product as two entries', () => {
    const out = mergeWishlists([item(1, 'v1')], [item(1, 'v2')], 10);
    assert.equal(out.length, 2);
  });

  test('stops at the cap, keeping what the account already had', () => {
    const out = mergeWishlists([item(1), item(2)], [item(3)], 2);
    assert.deepEqual(out, [item(1), item(2)]);
  });

  test('an empty device list changes nothing', () => {
    assert.deepEqual(mergeWishlists([item(1)], [], 10), [item(1)]);
  });
});

describe('sameWishlistItem', () => {
  test('a missing variant and an empty one are the same thing', () => {
    // MySQL unique keys treat NULLs as distinct, so the column is '' not NULL.
    assert.equal(sameWishlistItem(item(1), { productId: 1, variationId: '' }), true);
  });

  test('different products are never the same', () => {
    assert.equal(sameWishlistItem(item(1), item(2)), false);
  });
});

describe('parseWishlistConfig', () => {
  test('unset means off, with the default cap', () => {
    assert.deepEqual(parseWishlistConfig(null), {
      enabled: false,
      maxItems: DEFAULT_WISHLIST_MAX_ITEMS,
      trackStats: false,
    });
  });

  test('reads what the settings screen writes', () => {
    assert.deepEqual(parseWishlistConfig({ enabled: true, maxItems: 50, trackStats: true }), {
      enabled: true,
      maxItems: 50,
      trackStats: true,
    });
  });

  test('a silly cap is brought back into range rather than trusted', () => {
    assert.equal(parseWishlistConfig({ enabled: true, maxItems: 0 }).maxItems, 1);
    assert.equal(parseWishlistConfig({ enabled: true, maxItems: 99999 }).maxItems, 200);
    assert.equal(
      parseWishlistConfig({ enabled: true, maxItems: 'lots' }).maxItems,
      DEFAULT_WISHLIST_MAX_ITEMS
    );
  });
});
