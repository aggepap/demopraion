/**
 * The label/value table every form notification is built from.
 *
 * Extracted from `src/app/api/contact/route.ts`, where it was private and so
 * untestable, when the questionnaire endpoint needed the same two functions.
 * That is the repo's stated reason for pulling helpers out of a route module,
 * and `escapeHtml` in particular is one a second copy of is worth avoiding —
 * two of them is how one ends up subtly not escaping.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { rowsToHtml, rowsToText } from '@/lib/email/rows';

describe('rowsToHtml', () => {
  test('escapes a value so a submitted string cannot inject markup', () => {
    const html = rowsToHtml([['Message', '<script>alert(1)</script>']]);
    assert.equal(html.includes('<script>'), false);
    assert.ok(html.includes('&lt;script&gt;'));
  });

  test('escapes the label too', () => {
    const html = rowsToHtml([['<b>Label</b>', 'value']]);
    assert.equal(html.includes('<b>Label</b>'), false);
  });

  test('drops rows with nothing in them', () => {
    // Optional fields are passed through as '' rather than filtered by every
    // caller; the notification should not carry a column of blanks.
    const html = rowsToHtml([
      ['Kept', 'yes'],
      ['Empty', ''],
      ['Whitespace', '   '],
    ]);
    assert.ok(html.includes('Kept'));
    assert.equal(html.includes('Empty'), false);
    assert.equal(html.includes('Whitespace'), false);
  });

  test('renders Greek unescaped — it is text, not markup', () => {
    assert.ok(rowsToHtml([['Ρόλος', 'Ιδιοκτήτης']]).includes('Ιδιοκτήτης'));
  });
});

describe('rowsToText', () => {
  test('renders one label: value line per row', () => {
    assert.equal(
      rowsToText([
        ['A', '1'],
        ['B', '2'],
      ]),
      'A: 1\nB: 2'
    );
  });

  test('drops empty rows, matching the HTML half', () => {
    assert.equal(
      rowsToText([
        ['A', '1'],
        ['B', ''],
      ]),
      'A: 1'
    );
  });
});
