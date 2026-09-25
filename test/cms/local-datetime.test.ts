// The browser's time zone decides what a `datetime-local` box means; Node reads
// TZ lazily, so setting it before the first Date is formatted pins the test to
// a Greek editor.
process.env.TZ = 'Europe/Athens';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  dateFieldFromInput,
  dateFieldToInput,
  isoToLocalInput,
  localInputToIso,
  toWireDateTime,
} from '@/cms/admin/local-datetime';

/**
 * "Publish at" is a `datetime-local` box: it has no time zone, it means the
 * editor's own clock. The form sent that bare string and the SERVER decided
 * what zone it was in, then showed it back with `toISOString()` — UTC — so a
 * Greek editor who typed 09:30 saw 06:30 on reload, and saving again moved it
 * another three hours.
 *
 * Now the browser converts both ways and the wire only ever carries UTC.
 */
describe('Publish at, in the editor’s time zone', () => {
  test('what the editor types is stored as the right UTC instant (summer time)', () => {
    assert.equal(localInputToIso('2026-10-01T09:30'), '2026-10-01T06:30:00.000Z');
  });

  test('and in winter time', () => {
    assert.equal(localInputToIso('2026-12-01T09:30'), '2026-12-01T07:30:00.000Z');
  });

  test('a stored instant is shown back in local time', () => {
    assert.equal(isoToLocalInput('2026-10-01T06:30:00.000Z'), '2026-10-01T09:30');
  });

  test('round-trips without drifting', () => {
    for (const typed of ['2026-03-29T04:15', '2026-10-25T12:00', '2027-01-15T23:59']) {
      assert.equal(isoToLocalInput(localInputToIso(typed)), typed);
    }
  });

  test('empty and unreadable values are empty, not "Invalid Date"', () => {
    assert.equal(localInputToIso(''), '');
    assert.equal(localInputToIso('nonsense'), '');
    assert.equal(isoToLocalInput(''), '');
    assert.equal(isoToLocalInput(null), '');
    assert.equal(isoToLocalInput('nonsense'), '');
  });

  test('the server hands the form a full UTC instant, not a zone-less prefix', () => {
    assert.equal(toWireDateTime(new Date('2026-10-01T06:30:00Z')), '2026-10-01T06:30:00.000Z');
    assert.equal(toWireDateTime(null), null);
  });
});

/**
 * The generic `date` field with `withTime` is the same `datetime-local` box as
 * "Publish at", and it sent the typed string as it was — zone-less, so the
 * server's clock decided what 09:30 meant. It now converts the same way.
 */
describe('date field with time, in the editor’s time zone', () => {
  test('what is typed is stored as a UTC instant', () => {
    assert.equal(dateFieldFromInput('2026-10-01T09:30', true), '2026-10-01T06:30:00.000Z');
  });

  test('a stored instant is shown in local time', () => {
    assert.equal(dateFieldToInput('2026-10-01T06:30:00.000Z', true), '2026-10-01T09:30');
  });

  test('a value saved before the fix (zone-less) still shows as it was typed', () => {
    assert.equal(dateFieldToInput('2026-10-01T09:30', true), '2026-10-01T09:30');
  });

  test('round-trips without drifting', () => {
    for (const typed of ['2026-03-29T04:15', '2026-10-25T12:00', '2027-01-15T23:59']) {
      assert.equal(dateFieldToInput(dateFieldFromInput(typed, true), true), typed);
    }
  });

  test('a plain date has no zone and passes through', () => {
    assert.equal(dateFieldFromInput('2026-10-01', false), '2026-10-01');
    assert.equal(dateFieldToInput('2026-10-01', undefined), '2026-10-01');
  });

  test('empty clears the field, and nothing unreadable is shown', () => {
    assert.equal(dateFieldFromInput('', true), undefined);
    assert.equal(dateFieldFromInput('', false), undefined);
    assert.equal(dateFieldToInput(undefined, true), '');
    assert.equal(dateFieldToInput('garbage', true), '');
  });
});
