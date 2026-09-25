import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  monthDayRangesOverlap,
  monthDaySegments,
  monthDayToInt,
  overlappingRangeRows,
} from '@/cms/core/fields/month-day';

describe('monthDayToInt', () => {
  test('a real mm-dd becomes its sortable integer', () => {
    assert.equal(monthDayToInt('11-15'), 1115);
    assert.equal(monthDayToInt('01-01'), 101);
  });

  test('29 February parses — a yearless range has no leap year to fail', () => {
    assert.equal(monthDayToInt('02-29'), 229);
  });

  test('days that no month has are refused', () => {
    assert.equal(monthDayToInt('02-30'), null);
    assert.equal(monthDayToInt('04-31'), null);
    assert.equal(monthDayToInt('13-01'), null);
  });

  test('anything that is not a padded mm-dd string is null', () => {
    assert.equal(monthDayToInt('1-1'), null);
    assert.equal(monthDayToInt('2026-06-01'), null);
    assert.equal(monthDayToInt(''), null);
    assert.equal(monthDayToInt(undefined), null);
  });
});

describe('monthDaySegments', () => {
  test('a plain range is one segment', () => {
    assert.deepEqual(monthDaySegments({ from: '06-01', to: '09-30' }), [[601, 930]]);
  });

  test('a range that wraps the new year splits in two', () => {
    assert.deepEqual(monthDaySegments({ from: '11-01', to: '02-28' }), [
      [1101, 1231],
      [101, 228],
    ]);
  });

  test('an unparseable bound yields no segments at all', () => {
    assert.deepEqual(monthDaySegments({ from: 'nope', to: '09-30' }), []);
  });
});

describe('monthDayRangesOverlap', () => {
  test('ranges sharing a day overlap', () => {
    assert.equal(
      monthDayRangesOverlap({ from: '06-01', to: '08-31' }, { from: '08-01', to: '09-30' }),
      true,
    );
  });

  test('touching but disjoint ranges do not', () => {
    assert.equal(
      monthDayRangesOverlap({ from: '06-01', to: '06-30' }, { from: '07-01', to: '07-31' }),
      false,
    );
  });

  test('a wrapping range is compared on both of its segments', () => {
    assert.equal(
      monthDayRangesOverlap({ from: '11-01', to: '02-28' }, { from: '01-15', to: '01-20' }),
      true,
    );
    assert.equal(
      monthDayRangesOverlap({ from: '11-01', to: '02-28' }, { from: '06-01', to: '06-30' }),
      false,
    );
  });

  test('an incomplete row is unfinished, not in conflict', () => {
    // The admin flags overlap as the editor types. A row with only its first
    // date chosen must not light up red while they are still choosing the
    // second one.
    assert.equal(monthDayRangesOverlap({ from: '06-01', to: '' }, { from: '01-01', to: '12-31' }), false);
    assert.equal(monthDayRangesOverlap({ from: undefined, to: undefined }, { from: '01-01', to: '12-31' }), false);
  });
});

describe('overlappingRangeRows', () => {
  const RULE = { from: 'from', to: 'to' };

  test('a clean set of seasons reports nothing', () => {
    const rows = [
      { from: '01-01', to: '05-31' },
      { from: '06-01', to: '09-30' },
      { from: '10-01', to: '12-31' },
    ];
    assert.equal(overlappingRangeRows(rows, RULE).size, 0);
  });

  test('the LATER row is flagged, naming the row it clashes with', () => {
    // Flagging both ends of a pair would light up the whole list from one edit.
    const rows = [
      { from: '06-01', to: '08-31' },
      { from: '08-01', to: '09-30' },
    ];
    assert.deepEqual([...overlappingRangeRows(rows, RULE)], [[1, 0]]);
  });

  test('a row is blamed on the FIRST row it clashes with, once', () => {
    const rows = [
      { from: '01-01', to: '12-31' },
      { from: '02-01', to: '02-28' },
      { from: '03-01', to: '03-31' },
    ];
    assert.deepEqual([...overlappingRangeRows(rows, RULE)], [
      [1, 0],
      [2, 0],
    ]);
  });

  test('wrap-around is caught across the year boundary', () => {
    const rows = [
      { from: '11-01', to: '02-28' },
      { from: '01-15', to: '01-20' },
    ];
    assert.deepEqual([...overlappingRangeRows(rows, RULE)], [[1, 0]]);
  });

  test('half-filled rows are ignored until both dates are chosen', () => {
    const rows = [{ from: '01-01', to: '12-31' }, { from: '06-01' }, {}];
    assert.equal(overlappingRangeRows(rows, RULE).size, 0);
  });

  test('the rule names the sub-fields, so other key pairs work too', () => {
    const rows = [
      { opens: '06-01', closes: '08-31' },
      { opens: '07-01', closes: '07-31' },
    ];
    assert.deepEqual([...overlappingRangeRows(rows, { from: 'opens', to: 'closes' })], [[1, 0]]);
  });
});
