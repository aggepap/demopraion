import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { projectSizeChart } from '@/cms/modules/commerce';

describe('projectSizeChart', () => {
  const data = {
    title: { el: 'Μεγέθη', en: 'Sizes' },
    note: { el: 'Σε εκατοστά', en: 'In centimetres' },
    columns: [{ label: { el: 'Στήθος', en: 'Chest' } }, { label: { el: 'Μέση', en: 'Waist' } }],
    rows: [
      { size: 'S', cells: [{ value: '90' }, { value: '75' }] },
      { size: 'M', cells: [{ value: '96' }, { value: '81' }] },
    ],
  };

  test('resolves localized headers/title/note for the locale', () => {
    const en = projectSizeChart(data, 'en');
    assert.equal(en?.title, 'Sizes');
    assert.equal(en?.note, 'In centimetres');
    assert.deepEqual(en?.headers, ['Chest', 'Waist']);
    assert.deepEqual(en?.rows, [
      { size: 'S', cells: ['90', '75'] },
      { size: 'M', cells: ['96', '81'] },
    ]);
  });

  test('falls back across locales when one is missing', () => {
    const el = projectSizeChart({ ...data, title: { el: 'Μεγέθη' } }, 'en');
    assert.equal(el?.title, 'Μεγέθη'); // only el present → used as fallback
  });

  test('drops empty rows but keeps partially-filled ones', () => {
    const chart = projectSizeChart(
      { title: { en: 'T' }, columns: [{ label: { en: 'A' } }], rows: [{ size: '', cells: [{ value: '' }] }, { size: 'L', cells: [] }] },
      'en',
    );
    assert.deepEqual(chart?.rows, [{ size: 'L', cells: [] }]);
  });

  test('null when there is nothing to show', () => {
    assert.equal(projectSizeChart({}, 'en'), null);
    assert.equal(projectSizeChart({ rows: [] }, 'en'), null);
  });
});
