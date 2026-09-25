/**
 * What happens to an order's lines when an admin saves the order editor.
 *
 * A save deleted every line and inserted the editor's list afresh, so each line
 * lost its `snapshot` and `variationId`. A gift card bought on an order that was
 * edited before payment (a typo in the address, say) therefore never minted — the
 * minting reads `snapshot.giftCard` — and a refund could no longer find the
 * variation to restock. Lines the editor kept are now updated in place.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { planOrderLines } from '@/cms/modules/commerce/order-admin';

const giftCard = { giftCard: { amount: 5000, recipientEmail: 'friend@example.com' } };
const existing = [
  { id: 11, productId: 3, variationId: 'v-blue', snapshot: { title: 'Mug' } },
  { id: 12, productId: 9, variationId: null, snapshot: giftCard },
];
const line = (over: Partial<{ id: number; productId: number; name: string; unitPrice: number; quantity: number }> = {}) => ({
  name: 'Line',
  sku: null,
  variantLabel: null,
  unitPrice: 1000,
  quantity: 1,
  lineTotal: 1000,
  productId: null as number | null,
  ...over,
});

describe('planOrderLines', () => {
  test('a kept line keeps its id, snapshot and variation', () => {
    const plan = planOrderLines(existing, [line({ id: 11, productId: 3, quantity: 2 })]);
    assert.equal(plan.update.length, 1);
    assert.equal(plan.update[0].id, 11);
    assert.deepEqual(plan.update[0].values.snapshot, { title: 'Mug' });
    assert.equal(plan.update[0].values.variationId, 'v-blue');
    assert.equal(plan.update[0].values.quantity, 2);
  });

  test('a gift card line edited before payment still carries its gift card', () => {
    const plan = planOrderLines(existing, [line({ id: 11, productId: 3 }), line({ id: 12, productId: 9, unitPrice: 4500 })]);
    const gift = plan.update.find((u) => u.id === 12);
    assert.deepEqual(gift?.values.snapshot, giftCard);
  });

  test('a line sent without its product keeps the product it had', () => {
    const plan = planOrderLines(existing, [line({ id: 11 })]);
    assert.equal(plan.update[0].values.productId, 3);
    assert.equal(plan.update[0].values.variationId, 'v-blue');
  });

  test('a line the editor dropped is deleted', () => {
    const plan = planOrderLines(existing, [line({ id: 11, productId: 3 })]);
    assert.deepEqual(plan.remove, [12]);
  });

  test('a manually added line is inserted with no snapshot or variation, as before', () => {
    const plan = planOrderLines(existing, [line({ productId: 3, name: 'Extra' })]);
    assert.equal(plan.insert.length, 1);
    assert.equal(plan.insert[0].snapshot, null);
    assert.equal(plan.insert[0].variationId, null);
    assert.equal(plan.insert[0].productId, 3);
    assert.deepEqual(plan.remove.sort(), [11, 12]);
  });

  test('an id that is not a line of this order is treated as a new line', () => {
    const plan = planOrderLines(existing, [line({ id: 999 })]);
    assert.equal(plan.update.length, 0);
    assert.equal(plan.insert.length, 1);
    assert.equal(plan.insert[0].snapshot, null);
  });

  test('a line pointed at a different product is a new line, not the old one relabelled', () => {
    const plan = planOrderLines(existing, [line({ id: 12, productId: 4 })]);
    assert.equal(plan.update.length, 0);
    assert.equal(plan.insert[0].snapshot, null);
    assert.deepEqual(plan.remove.sort(), [11, 12]);
  });

  test('the same id sent twice keeps the line once and adds the copy as new', () => {
    const plan = planOrderLines(existing, [line({ id: 11 }), line({ id: 11 })]);
    assert.equal(plan.update.length, 1);
    assert.equal(plan.insert.length, 1);
    assert.equal(plan.insert[0].snapshot, null);
  });

  test('a new order has nothing to keep', () => {
    const plan = planOrderLines([], [line({ id: 11 })]);
    assert.equal(plan.update.length, 0);
    assert.equal(plan.insert.length, 1);
    assert.deepEqual(plan.remove, []);
  });
});
