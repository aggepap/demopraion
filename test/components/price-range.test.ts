import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  clampRange,
  rangeToParams,
  stepFromKey,
  type PriceBounds,
} from '@/components/shop/filters/price-range';

/**
 * The slider's arithmetic, kept out of the component so it can be tested
 * directly — the same split as `variant-gallery.ts`.
 *
 * Two rules matter beyond the obvious clamping. The handles must not cross,
 * because a min above the max is a filter that can never match anything. And a
 * range equal to the bounds means "no price filter", so it leaves no parameters
 * in the URL: otherwise every visit to the shop would pin the prices that
 * happened to be on screen the first time, and a new, cheaper product would be
 * silently filtered out.
 */

const bounds: PriceBounds = { min: 10, max: 100 };

describe('clampRange', () => {
  test('keeps a range that is already inside the bounds', () => {
    assert.deepEqual(clampRange({ min: 20, max: 80 }, bounds), { min: 20, max: 80 });
  });

  test('pulls values outside the bounds back in rather than dropping them', () => {
    assert.deepEqual(clampRange({ min: 0, max: 500 }, bounds), { min: 10, max: 100 });
  });

  test('the handles cannot cross', () => {
    assert.deepEqual(clampRange({ min: 90, max: 30 }, bounds), { min: 90, max: 90 });
  });

  test('missing ends fall back to the bounds', () => {
    assert.deepEqual(clampRange({ min: undefined, max: 40 }, bounds), { min: 10, max: 40 });
    assert.deepEqual(clampRange({ min: undefined, max: undefined }, bounds), { min: 10, max: 100 });
  });

  test('values that are not numbers fall back to the bounds', () => {
    assert.deepEqual(clampRange({ min: Number.NaN, max: Number.NaN }, bounds), {
      min: 10,
      max: 100,
    });
  });
});

describe('stepFromKey', () => {
  const at = (value: number, key: string) => stepFromKey(value, key, bounds);

  test('arrows move by one', () => {
    assert.equal(at(50, 'ArrowRight'), 51);
    assert.equal(at(50, 'ArrowUp'), 51);
    assert.equal(at(50, 'ArrowLeft'), 49);
    assert.equal(at(50, 'ArrowDown'), 49);
  });

  test('page keys move by a tenth of the range', () => {
    assert.equal(at(50, 'PageUp'), 59);
    assert.equal(at(50, 'PageDown'), 41);
  });

  test('Home and End jump to the ends', () => {
    assert.equal(at(50, 'Home'), 10);
    assert.equal(at(50, 'End'), 100);
  });

  test('stops at the bounds instead of running past them', () => {
    assert.equal(at(100, 'ArrowRight'), 100);
    assert.equal(at(10, 'PageDown'), 10);
  });

  test('a key the slider does not use is ignored', () => {
    for (const key of ['Enter', 'Tab', 'a', ' ']) assert.equal(at(50, key), null, key);
  });
});

describe('rangeToParams', () => {
  test('a full range means no price filter at all', () => {
    assert.deepEqual(rangeToParams({ min: 10, max: 100 }, bounds), {
      price_min: null,
      price_max: null,
    });
  });

  test('only the end that was moved is written', () => {
    assert.deepEqual(rangeToParams({ min: 25, max: 100 }, bounds), {
      price_min: '25',
      price_max: null,
    });
    assert.deepEqual(rangeToParams({ min: 10, max: 60 }, bounds), {
      price_min: null,
      price_max: '60',
    });
  });

  test('both ends when both moved', () => {
    assert.deepEqual(rangeToParams({ min: 25, max: 60 }, bounds), {
      price_min: '25',
      price_max: '60',
    });
  });

  test('the values written are the ones the parser reads back', () => {
    // `parseShopParams` does `Number(raw)`, so the string must be plain.
    const { price_min } = rangeToParams({ min: 25.5, max: 60 }, bounds);
    assert.equal(Number(price_min), 25.5);
  });
});
