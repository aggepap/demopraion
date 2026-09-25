import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { clampQuantity, quantityRules } from '@/cms/modules/commerce';

describe('quantityRules', () => {
  test('defaults: min 1, no max, step 1', () => {
    assert.deepEqual(quantityRules({}), { min: 1, max: null, step: 1, soldIndividually: false });
  });
  test('reads min/max/step', () => {
    assert.deepEqual(quantityRules({ minQty: 2, maxQty: 10, qtyStep: 2 }), {
      min: 2,
      max: 10,
      step: 2,
      soldIndividually: false,
    });
  });
  test('soldIndividually forces min = max = 1', () => {
    assert.deepEqual(quantityRules({ soldIndividually: true, minQty: 5, maxQty: 20 }), {
      min: 1,
      max: 1,
      step: 1,
      soldIndividually: true,
    });
  });
  test('a max below min is lifted to min', () => {
    assert.equal(quantityRules({ minQty: 4, maxQty: 2 }).max, 4);
  });
});

describe('clampQuantity', () => {
  test('clamps below min up and above max down', () => {
    const r = { min: 2, max: 10, step: 1, soldIndividually: false };
    assert.equal(clampQuantity(r, 1), 2);
    assert.equal(clampQuantity(r, 99), 10);
    assert.equal(clampQuantity(r, 5), 5);
  });
  test('snaps to whole steps from min', () => {
    const r = { min: 0 + 1, max: null, step: 3, soldIndividually: false };
    // min 1, step 3 → valid: 1, 4, 7, …
    assert.equal(clampQuantity(r, 2), 1); // rounds to nearest step from min
    assert.equal(clampQuantity(r, 3), 4);
    assert.equal(clampQuantity(r, 6), 7);
  });
  test('respects max as the largest valid step', () => {
    const r = { min: 2, max: 9, step: 3, soldIndividually: false };
    // valid: 2, 5, 8, (11>9) → 8 is the cap
    assert.equal(clampQuantity(r, 100), 8);
  });
  test('sold individually is always 1', () => {
    assert.equal(clampQuantity({ min: 1, max: 1, step: 1, soldIndividually: true }, 7), 1);
  });
});
