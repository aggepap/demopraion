import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { applyStockDelta, availableStock } from '@/cms/modules/commerce/stock';

/**
 * Stock arithmetic, now that it runs after payment rather than at checkout.
 *
 * The delta form exists because the same code has to sell AND restock: a refund
 * must put back exactly what the order took, and two near-identical functions
 * drifting apart is how a shop ends up with phantom inventory.
 */

const product = (over: Record<string, unknown> = {}) => ({
  title: 'Thing',
  stock: 10,
  variations: [
    { id: 'v1', stock: 3 },
    { id: 'v2', stock: 5 },
  ],
  ...over,
});

describe('availableStock', () => {
  test('untracked stock is unlimited, not zero', () => {
    // The distinction matters: a product with no stock field is not out of
    // stock, it is simply not counted.
    assert.equal(availableStock({ title: 'X' }, undefined), Infinity);
  });

  test('product-level stock when no variation is chosen', () => {
    assert.equal(availableStock(product(), undefined), 10);
  });

  test('a variation is bounded by BOTH its own stock and the product total', () => {
    // 3 units of v1 exist even though the product says 10.
    assert.equal(availableStock(product(), 'v1'), 3);
    // …and the product total caps a variation that claims more.
    assert.equal(availableStock(product({ stock: 2 }), 'v2'), 2);
  });

  test('an unknown variation id falls back to the product total', () => {
    assert.equal(availableStock(product(), 'nope'), 10);
  });
});

describe('applyStockDelta', () => {
  test('selling moves the product and the matching variation together', () => {
    const next = applyStockDelta(product(), 'v1', -2);
    assert.equal(next.stock, 8);
    assert.deepEqual(next.variations, [
      { id: 'v1', stock: 1 },
      { id: 'v2', stock: 5 },
    ]);
  });

  test('restocking is the same operation with the sign flipped', () => {
    const sold = applyStockDelta(product(), 'v1', -2);
    const back = applyStockDelta(sold, 'v1', 2);
    assert.equal(back.stock, 10);
    assert.deepEqual(back.variations, product().variations);
  });

  test('a sell/restock round trip is lossless for the no-variation case', () => {
    const sold = applyStockDelta(product(), undefined, -4);
    const back = applyStockDelta(sold, undefined, 4);
    assert.equal(back.stock, 10);
  });

  test('never goes negative', () => {
    // Clamping rather than throwing: an oversell is a data problem to see in
    // the admin, not a reason to fail a webhook that has already taken money.
    const next = applyStockDelta(product(), 'v1', -99);
    assert.equal(next.stock, 0);
    assert.equal((next.variations as { stock: number }[])[0].stock, 0);
  });

  test('untracked stock stays untracked', () => {
    const next = applyStockDelta({ title: 'X' }, undefined, -1);
    assert.equal(next.stock, undefined);
  });

  test('other variations are untouched', () => {
    const next = applyStockDelta(product(), 'v2', -1);
    assert.deepEqual((next.variations as { id: string; stock: number }[])[0], { id: 'v1', stock: 3 });
  });

  test('the input is not mutated', () => {
    // The caller writes the result to every locale row of the product, so a
    // shared mutable object would compound the delta once per locale.
    const original = product();
    applyStockDelta(original, 'v1', -1);
    assert.equal(original.stock, 10);
    assert.equal(original.variations[0].stock, 3);
  });
});
