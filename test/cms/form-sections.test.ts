import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { f } from '@/cms/config';
import { buildBlocks } from '@/cms/admin/shared';

/**
 * `buildBlocks` decides what becomes a card. Its original rule — every repeater
 * stands alone — put a single base price in one card and its seasonal overrides
 * in the next, and let a section's own fields render AFTER the repeater that
 * belongs to it, because the repeater broke the run.
 *
 * `nestRepeaters` fixes that for collections that ask for it. These tests pin
 * both behaviours, because the old one is still what every collection that has
 * not opted in relies on.
 */

const fields = [
  f.number('basePrice', { label: 'Base price', section: 'Pricing' }),
  f.repeater('seasonalPrices', [f.number('price')], { label: 'Seasonal prices', section: 'Pricing' }),
  f.text('note', { label: 'Note', section: 'Booking form' }),
];

describe('buildBlocks — the legacy layout, which most collections still use', () => {
  const blocks = buildBlocks(fields);

  test('a repeater stands alone, splitting its section in two', () => {
    assert.deepEqual(
      blocks.map((b) => (b.type === 'section' ? `card:${b.title}` : `own:${b.field.key}`)),
      ['card:Pricing', 'own:seasonalPrices', 'card:Booking form'],
    );
  });

  test('opting in is what changes it, not the presence of a section', () => {
    // Every field here names a section, and nothing moved. The old rule holds
    // until a collection explicitly asks for the new one.
    assert.equal(blocks.filter((b) => b.type === 'field').length, 1);
  });
});

describe('buildBlocks — nestRepeaters, for collections that declare sections', () => {
  const blocks = buildBlocks(fields, 'Content', { nestRepeaters: true });

  test('a sectioned repeater joins its section instead of becoming a card', () => {
    assert.deepEqual(
      blocks.map((b) => (b.type === 'section' ? `card:${b.title}` : `own:${b.field.key}`)),
      ['card:Pricing', 'card:Booking form'],
    );
  });

  test('the section holds the repeater in declared order', () => {
    const pricing = blocks[0];
    assert.equal(pricing.type, 'section');
    assert.deepEqual(
      pricing.type === 'section' ? pricing.fields.map((x) => x.key) : [],
      ['basePrice', 'seasonalPrices'],
    );
  });

  test('an UNsectioned repeater still stands alone — it has no card to join', () => {
    const loose = [
      f.text('title', { section: 'Main' }),
      f.repeater('blocks', [f.text('x')], { label: 'Blocks' }),
      f.text('after', { section: 'Main' }),
    ];
    const out = buildBlocks(loose, 'Content', { nestRepeaters: true });
    assert.deepEqual(
      out.map((b) => (b.type === 'section' ? `card:${b.title}` : `own:${b.field.key}`)),
      ['card:Main', 'own:blocks', 'card:Main'],
    );
  });

  test('a group joins its section too', () => {
    const withGroup = [
      f.text('a', { section: 'Details' }),
      f.group('meta', [f.text('b')], { label: 'Meta', section: 'Details' }),
    ];
    const out = buildBlocks(withGroup, 'Content', { nestRepeaters: true });
    assert.equal(out.length, 1);
    assert.equal(out[0].type === 'section' && out[0].fields.length, 2);
  });
});

describe('buildBlocks — a repeater between two runs of the same section', () => {
  /*
   * The trap the booking form fell into: `choices` and `formNote` both name
   * "Booking form", but the repeater between them split the run, so the note
   * rendered under a SECOND card with the same heading.
   */
  const split = [
    f.text('intro', { section: 'Booking form' }),
    f.repeater('choices', [f.text('q')], { label: 'Questions', section: 'Booking form' }),
    f.text('note', { section: 'Booking form' }),
  ];

  test('legacy: one heading, three cards, two of them identical', () => {
    const titles = buildBlocks(split).map((b) => (b.type === 'section' ? b.title : `[${b.field.key}]`));
    assert.deepEqual(titles, ['Booking form', '[choices]', 'Booking form']);
  });

  test('nested: one heading, one card', () => {
    const out = buildBlocks(split, 'Content', { nestRepeaters: true });
    assert.equal(out.length, 1);
    assert.deepEqual(
      out[0].type === 'section' ? out[0].fields.map((x) => x.key) : [],
      ['intro', 'choices', 'note'],
    );
  });
});
