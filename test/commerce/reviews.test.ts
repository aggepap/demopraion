import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { computeRatingAggregate } from '@/cms/modules/commerce';

describe('computeRatingAggregate', () => {
  test('empty list → zeroes', () => {
    assert.deepEqual(computeRatingAggregate([]), { count: 0, average: 0 });
  });

  test('average is rounded to one decimal', () => {
    // (5 + 4 + 4) / 3 = 4.333… → 4.3
    assert.deepEqual(computeRatingAggregate([5, 4, 4]), { count: 3, average: 4.3 });
    // (5 + 2) / 2 = 3.5
    assert.deepEqual(computeRatingAggregate([5, 2]), { count: 2, average: 3.5 });
  });

  test('out-of-range and non-finite ratings are ignored', () => {
    assert.deepEqual(computeRatingAggregate([5, 0, 6, Number.NaN, 3]), { count: 2, average: 4 });
  });

  test('all-invalid degrades to zeroes rather than NaN', () => {
    assert.deepEqual(computeRatingAggregate([0, 9, -1]), { count: 0, average: 0 });
  });
});
