import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { formatContentDate, hasBeenModified, latestContentDate, type ContentDates } from '@/lib/content-dates';

const dates: ContentDates = {
  publishDate: '2026-01-01',
  modifiedDate: { en: '2026-02-01', el: '2026-01-01' },
};

describe('formatContentDate', () => {
  test('formats in UTC per locale', () => {
    assert.equal(formatContentDate('2026-05-06', 'en'), '6 May 2026');
    const el = formatContentDate('2026-05-06', 'el');
    assert.match(el, /2026/);
    assert.match(el, /Μα/); // Greek "Μαΐου" (genitive May)
  });
});

describe('modification helpers (lexicographic YYYY-MM-DD compare)', () => {
  test('hasBeenModified is per-locale', () => {
    assert.equal(hasBeenModified(dates, 'en'), true);
    assert.equal(hasBeenModified(dates, 'el'), false);
  });

  test('latestContentDate returns the modified date only once revised', () => {
    assert.equal(latestContentDate(dates, 'en'), '2026-02-01');
    assert.equal(latestContentDate(dates, 'el'), '2026-01-01');
  });
});
