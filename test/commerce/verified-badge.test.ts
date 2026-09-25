/**
 * The "verified purchase" badge rule.
 *
 * The badge used to be granted on the reviewer's email alone — any non-cancelled
 * order matching `orders.email` for that product. Nothing proved the reviewer
 * controlled the address, and the shop's own operators hold every customer email
 * in the admin, so it was a public trust claim the site could manufacture. It is
 * now granted only when the reviewer supplies the order reference from their
 * confirmation email, checked through `lookupOrder` — the same reference/email
 * pair the guest order-lookup authenticates on.
 *
 * `orderQualifiesForBadge` is the half of that decision with no database in it:
 * given the order the reference resolved to, does it justify the claim?
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { orderQualifiesForBadge } from '@/cms/modules/commerce/reviews';

/** The product being reviewed, as every locale row of its translation group. */
const REVIEWED = [11, 12];

const order = (
  status: string,
  productIds: Array<number | null>,
): { status: string; items: Array<{ productId: number | null }> } => ({
  status,
  items: productIds.map((productId) => ({ productId })),
});

describe('orderQualifiesForBadge', () => {
  test('grants the badge for a paid order containing the product', () => {
    assert.equal(orderQualifiesForBadge(order('paid', [11]), REVIEWED), true);
  });

  test('matches any locale row of the product group', () => {
    // One product has a document row per language; a shopper who bought the
    // English row is reviewing the same product as one who bought the Greek row.
    assert.equal(orderQualifiesForBadge(order('paid', [12]), REVIEWED), true);
  });

  test('grants it when the product is one line among several', () => {
    assert.equal(orderQualifiesForBadge(order('fulfilled', [99, 11, 42]), REVIEWED), true);
  });

  test('refuses when the order does not contain this product', () => {
    // Holding a real reference proves you bought something, not that you bought
    // the thing you are reviewing.
    assert.equal(orderQualifiesForBadge(order('paid', [99]), REVIEWED), false);
  });

  test('refuses an empty order', () => {
    assert.equal(orderQualifiesForBadge(order('paid', []), REVIEWED), false);
  });

  test('refuses a cancelled or refunded order', () => {
    // Money that came back is not a purchase to vouch for.
    assert.equal(orderQualifiesForBadge(order('cancelled', [11]), REVIEWED), false);
    assert.equal(orderQualifiesForBadge(order('refunded', [11]), REVIEWED), false);
  });

  test('a deleted product line matches nothing rather than everything', () => {
    // `order_items.product_id` is `on delete set null`, so a null must not be
    // treated as a wildcard.
    assert.equal(orderQualifiesForBadge(order('paid', [null]), REVIEWED), false);
    assert.equal(orderQualifiesForBadge(order('paid', [null, null]), REVIEWED), false);
  });

  test('refuses when the reviewed product has no known document ids', () => {
    assert.equal(orderQualifiesForBadge(order('paid', [11]), []), false);
  });

  test('a pending order still counts', () => {
    // Only cancelled/refunded are excluded. A bank transfer awaiting clearance is
    // a real order, and the shopper reviewing it is a real buyer.
    assert.equal(orderQualifiesForBadge(order('pending', [11]), REVIEWED), true);
  });
});
