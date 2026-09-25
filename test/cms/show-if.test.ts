/**
 * `showIf` — conditional field visibility.
 *
 * The rule these tests exist to protect: a field the editor cannot see must
 * never block a publish, and its stored value must survive being hidden. Both
 * halves are load-bearing for the booking module, where switching an experience
 * between Transport and Stay hides half the form each way.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { f, isFieldVisible, visibleFields } from '@/cms/config/fields';
import { buildDataSchema } from '@/cms/config/zod';
import { buildBlocks } from '@/cms/admin/shared';

const LOCALES = ['en', 'el'];
const ok = (schema: ReturnType<typeof buildDataSchema>, data: unknown) => schema.safeParse(data).success;

const kind = f.select('kind', {
  default: 'transport',
  options: [
    { value: 'transport', label: 'Transport' },
    { value: 'stay', label: 'Stay' },
  ],
});

describe('isFieldVisible', () => {
  const departures = f.text('departures', { showIf: { field: 'kind', equals: 'transport' } });

  test('a field with no condition is always visible', () => {
    assert.equal(isFieldVisible(f.text('title'), {}), true);
    assert.equal(isFieldVisible(f.text('title'), undefined), true);
  });

  test('visible when the sibling matches, hidden when it does not', () => {
    assert.equal(isFieldVisible(departures, { kind: 'transport' }), true);
    assert.equal(isFieldVisible(departures, { kind: 'stay' }), false);
  });

  test('an unset discriminator falls back to its declared default', () => {
    // Every experience written before `kind` existed has no `kind` key. Without
    // this fallback the whole transport half of the form would vanish from
    // every one of them.
    assert.equal(isFieldVisible(departures, {}, [kind]), true);
    assert.equal(isFieldVisible(departures, { kind: '' }, [kind]), true);
    // …and with no peers to consult, an unset discriminator matches nothing.
    assert.equal(isFieldVisible(departures, {}), false);
  });

  test('any of several values may match', () => {
    const field = f.text('x', { showIf: { field: 'kind', equals: ['transport', 'stay'] } });
    assert.equal(isFieldVisible(field, { kind: 'stay' }), true);
    assert.equal(isFieldVisible(field, { kind: 'other' }), false);
  });

  test('a multi-select sibling matches when ANY selected value matches', () => {
    const field = f.text('x', { showIf: { field: 'tags', equals: 'b' } });
    assert.equal(isFieldVisible(field, { tags: ['a', 'b'] }), true);
    assert.equal(isFieldVisible(field, { tags: ['a'] }), false);
    assert.equal(isFieldVisible(field, { tags: [] }), false);
  });

  test('several conditions are ANDed — every one has to hold', () => {
    // `extrasPerNight` is the real case: meaningless on transport, which has no
    // nights, AND meaningless when nothing is sold as an extra. Either alone is
    // reason enough to hide it.
    const field = f.boolean('extrasPerNight', {
      showIf: [
        { field: 'kind', equals: 'stay' },
        { field: 'extrasEnabled', equals: 'true' },
      ],
    });
    assert.equal(isFieldVisible(field, { kind: 'stay', extrasEnabled: true }), true);
    assert.equal(isFieldVisible(field, { kind: 'stay', extrasEnabled: false }), false);
    assert.equal(isFieldVisible(field, { kind: 'transport', extrasEnabled: true }), false);
    assert.equal(isFieldVisible(field, { kind: 'stay' }), false);
  });

  test('a boolean switch reads as OFF until it is explicitly on', () => {
    // What makes "hidden until you ask for it" the default for a new document:
    // the key is simply absent, and absent must not mean visible.
    const field = f.text('optionsLabel', { showIf: { field: 'optionsEnabled', equals: 'true' } });
    assert.equal(isFieldVisible(field, {}), false);
    assert.equal(isFieldVisible(field, { optionsEnabled: false }), false);
    assert.equal(isFieldVisible(field, { optionsEnabled: true }), true);
  });
});

describe('visibleFields', () => {
  const fields = [
    kind,
    f.text('vessel', { showIf: { field: 'kind', equals: 'transport' } }),
    f.text('nightlyRate', { showIf: { field: 'kind', equals: 'stay' } }),
    f.text('title'),
  ];

  test('keeps the unconditional fields and only the matching branch', () => {
    assert.deepEqual(
      visibleFields(fields, { kind: 'stay' }).map((x) => x.key),
      ['kind', 'nightlyRate', 'title'],
    );
    assert.deepEqual(
      visibleFields(fields, { kind: 'transport' }).map((x) => x.key),
      ['kind', 'vessel', 'title'],
    );
  });
});

describe('buildDataSchema — conditional required', () => {
  const fields = [
    kind,
    f.text('vessel', { required: true, showIf: { field: 'kind', equals: 'transport' } }),
    f.text('nightlyRate', { required: true, showIf: { field: 'kind', equals: 'stay' } }),
  ];

  test('a hidden required field does not block publishing', () => {
    const s = buildDataSchema(fields, LOCALES, { enforceRequired: true });
    // A stay needs no vessel. Requiring one would be unsatisfiable: the field
    // is not on screen, so there is nowhere to type the value.
    assert.equal(ok(s, { kind: 'stay', nightlyRate: '180' }), true);
    assert.equal(ok(s, { kind: 'transport', vessel: 'Blue Pearl' }), true);
  });

  test('a VISIBLE required field still blocks publishing', () => {
    const s = buildDataSchema(fields, LOCALES, { enforceRequired: true });
    assert.equal(ok(s, { kind: 'transport' }), false);
    assert.equal(ok(s, { kind: 'transport', vessel: '' }), false);
    assert.equal(ok(s, { kind: 'stay' }), false);
  });

  test('the message names the field that is missing', () => {
    const s = buildDataSchema(
      [kind, f.text('vessel', { label: 'Vessel', required: true, showIf: { field: 'kind', equals: 'transport' } })],
      LOCALES,
      { enforceRequired: true },
    );
    const parsed = s.safeParse({ kind: 'transport' });
    assert.equal(parsed.success, false);
    const issue = parsed.success ? null : parsed.error.issues[0];
    assert.deepEqual(issue?.path, ['vessel']);
    assert.match(String(issue?.message), /Vessel is required/);
  });

  test('nothing is required on a draft write', () => {
    const s = buildDataSchema(fields, LOCALES);
    assert.equal(ok(s, { kind: 'transport' }), true);
  });

  test('the other branch’s data is kept, not rejected', () => {
    // Switching Transport -> Stay -> Transport must return the vessel
    // untouched, so the hidden key has to remain valid on the way through.
    const s = buildDataSchema(fields, LOCALES, { enforceRequired: true });
    const parsed = s.safeParse({ kind: 'stay', nightlyRate: '180', vessel: 'Blue Pearl' });
    assert.equal(parsed.success, true);
    assert.equal((parsed.success ? (parsed.data as Record<string, unknown>) : {}).vessel, 'Blue Pearl');
  });

  test('an unset discriminator uses its default when deciding what is required', () => {
    const s = buildDataSchema(fields, LOCALES, { enforceRequired: true });
    // `kind` defaults to transport, so the vessel is required even though the
    // payload never mentions the discriminator.
    assert.equal(ok(s, {}), false);
    assert.equal(ok(s, { vessel: 'Blue Pearl' }), true);
  });

  test('a required localized field counts as empty when every locale is', () => {
    const s = buildDataSchema(
      [kind, f.text('name', { localized: true, required: true, showIf: { field: 'kind', equals: 'stay' } })],
      LOCALES,
      { enforceRequired: true },
    );
    assert.equal(ok(s, { kind: 'stay', name: { en: '', el: '' } }), false);
    assert.equal(ok(s, { kind: 'stay', name: { en: 'Villa', el: 'Βίλα' } }), true);
  });
});

describe('buildBlocks — a section whose fields are all hidden', () => {
  test('disappears rather than rendering an empty card', () => {
    // `visibleFields` runs BEFORE `buildBlocks` in DocumentForm for exactly
    // this reason: a heading over nothing reads as a broken form.
    const fields = [
      kind,
      f.text('vessel', { section: 'Vessels', showIf: { field: 'kind', equals: 'transport' } }),
      f.text('departures', { section: 'Vessels', showIf: { field: 'kind', equals: 'transport' } }),
      f.text('title', { section: 'General' }),
    ];
    const titles = buildBlocks(visibleFields(fields, { kind: 'stay' }))
      .filter((b) => b.type === 'section')
      .map((b) => (b.type === 'section' ? b.title : ''));
    assert.equal(titles.includes('Vessels'), false);

    const transport = buildBlocks(visibleFields(fields, { kind: 'transport' }))
      .filter((b) => b.type === 'section')
      .map((b) => (b.type === 'section' ? b.title : ''));
    assert.equal(transport.includes('Vessels'), true);
  });
});
