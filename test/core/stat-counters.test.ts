import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  counterDay,
  isValidCounterPart,
  sumCounters,
} from '@/cms/core/stats/policy';

/**
 * Anonymous aggregate counters ("added to wishlist", popup impressions).
 *
 * One row per scope/subject/metric/day, so nothing about an individual visitor is
 * ever stored — only how many times something happened on a given day.
 */

describe('counterDay', () => {
  test('buckets by UTC calendar day', () => {
    assert.equal(counterDay(new Date('2026-09-17T23:59:59Z')), '2026-09-17');
    assert.equal(counterDay(new Date('2026-09-18T00:00:00Z')), '2026-09-18');
  });

  test('a late evening in Athens is still the UTC day', () => {
    // 01:30 Athens on the 18th is 22:30 UTC on the 17th.
    assert.equal(counterDay(new Date('2026-09-18T01:30:00+03:00')), '2026-09-17');
  });
});

describe('isValidCounterPart', () => {
  test('short lowercase identifiers only', () => {
    assert.equal(isValidCounterPart('wishlist'), true);
    assert.equal(isValidCounterPart('impression'), true);
    for (const bad of ['', 'Upper', 'a b', 'x'.repeat(33), "a';--"]) {
      assert.equal(isValidCounterPart(bad), false, bad);
    }
  });
});

describe('sumCounters', () => {
  test('adds day buckets together per subject and metric', () => {
    const rows = [
      { subjectId: 1, metric: 'add', count: 2 },
      { subjectId: 1, metric: 'add', count: 3 },
      { subjectId: 1, metric: 'click', count: 1 },
      { subjectId: 2, metric: 'add', count: 7 },
    ];
    const out = sumCounters(rows);
    assert.deepEqual(out.get(1), { add: 5, click: 1 });
    assert.deepEqual(out.get(2), { add: 7 });
    assert.equal(out.get(3), undefined);
  });

  test('database strings are counted as numbers', () => {
    // mysql2 returns SUM() as a string.
    const out = sumCounters([{ subjectId: 1, metric: 'add', count: '4' as unknown as number }]);
    assert.deepEqual(out.get(1), { add: 4 });
  });

  test('no rows is an empty map', () => {
    assert.equal(sumCounters([]).size, 0);
  });
});
