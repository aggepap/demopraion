/**
 * Every field an editor sees on a product, a category, a size chart, a tag, an
 * experience or a booking term carries a description — the text behind the "i"
 * beside its label.
 *
 * The commerce and booking forms are the longest in the admin and the ones where
 * a wrong guess costs money (is this price per person or per party? does the
 * option replace the rate or add to it?). A field added later without help is
 * the regression this guards: it fails here instead of shipping as an
 * unexplained box.
 *
 * Exempt: fields that never reach the screen (`hidden: true` — stable row ids,
 * legacy keys kept for old documents). Nothing else; if a label really says it
 * all, the description can still say where the value shows up.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { CollectionDefinition, Field } from '@/cms/config';
import { bookingCollection, bookingTermCollection } from '@/cms/modules/booking/collection';
import { productCollection } from '@/cms/modules/commerce/collection';
import { categoryCollection } from '@/cms/modules/commerce/category';
import { sizeChartCollection } from '@/cms/modules/commerce/sizechart';
import { tagCollection } from '@/cms/modules/commerce/tag';

/** Dotted paths of every visible field without help, children included. */
function missingHelp(fields: Field[], prefix = ''): string[] {
  const out: string[] = [];
  for (const field of fields) {
    if (field.hidden) continue;
    const path = prefix ? `${prefix}.${field.key}` : field.key;
    const text = typeof field.description === 'string' ? field.description.trim() : '';
    if (!text) out.push(path);
    if (field.kind === 'repeater' || field.kind === 'group') out.push(...missingHelp(field.fields, path));
  }
  return out;
}

const collections: Array<[string, CollectionDefinition]> = [
  ['product', productCollection()],
  ['category', categoryCollection()],
  ['sizechart', sizeChartCollection()],
  ['tag', tagCollection()],
  ['booking', bookingCollection()],
  ['booking term (flat)', bookingTermCollection({ key: 'vessel_type', label: 'Vessel type', labelPlural: 'Vessel types' })],
  [
    'booking term (hierarchical)',
    bookingTermCollection({ key: 'booking_category', label: 'Category', labelPlural: 'Categories', hierarchical: true }),
  ],
];

describe('commerce & booking field help', () => {
  for (const [name, collection] of collections) {
    test(`every visible ${name} field explains itself`, () => {
      assert.deepEqual(missingHelp(collection.fields), [], `${name} fields without a description`);
    });
  }

  test('the walk reaches repeater children (a nested field without help is caught)', () => {
    const probe = bookingCollection().fields.find((f) => f.key === 'options');
    assert.ok(probe && probe.kind === 'repeater');
    const stripped: Field = { ...probe, fields: [{ ...probe.fields[1], description: undefined } as Field] };
    assert.deepEqual(missingHelp([stripped]), ['options.name']);
  });

  test('hidden fields are exempt, and only those', () => {
    const hidden = { kind: 'text', key: 'id', hidden: true } as Field;
    const shown = { kind: 'text', key: 'sku' } as Field;
    assert.deepEqual(missingHelp([hidden, shown]), ['sku']);
  });
});
