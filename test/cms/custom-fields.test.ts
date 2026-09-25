import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildDataSchema } from '@/cms/config/zod';
import { f } from '@/cms/config/fields';
import { resolveCollection } from '@/cms/config/collection';
import {
  compileCustomFields,
  customFieldsForCollection,
  documentCategoryIds,
  groupCustomFieldValues,
  sanitizeCustomFieldsConfig,
  visibleCustomFields,
  withCustomFields,
  type CustomFieldDef,
  type CustomFieldsConfig,
} from '@/cms/core/fields/definitions';

const LOCALES = ['el', 'en'];

const def = (over: Partial<CustomFieldDef> & Pick<CustomFieldDef, 'key'>): CustomFieldDef => ({
  id: over.key,
  kind: 'text',
  label: { el: over.key, en: over.key },
  ...over,
});

const cfg = (fields: CustomFieldDef[], groups: CustomFieldsConfig['groups'] = []): CustomFieldsConfig => ({
  groups,
  fields,
});

/** Schema for a collection carrying only the compiled custom group. */
const schemaFor = (
  config: CustomFieldsConfig,
  visibleIds?: Set<string>,
  opts: { enforceRequired?: boolean } = {},
) => {
  const group = compileCustomFields(config, visibleIds ? { visibleIds } : {});
  assert.ok(group, 'expected a compiled custom group');
  return buildDataSchema([group], LOCALES, opts);
};

// ── Sanitising ────────────────────────────────────────────────────────────────

describe('sanitizeCustomFieldsConfig', () => {
  test('junk degrades to an empty config rather than throwing', () => {
    assert.deepEqual(sanitizeCustomFieldsConfig(null), { groups: [], fields: [] });
    assert.deepEqual(sanitizeCustomFieldsConfig('nope'), { groups: [], fields: [] });
    assert.deepEqual(sanitizeCustomFieldsConfig({ fields: 'x' }), { groups: [], fields: [] });
  });

  test('drops fields with an invalid key, unknown kind or duplicate key', () => {
    const out = sanitizeCustomFieldsConfig({
      fields: [
        { id: '1', key: 'Material', kind: 'text', label: {} }, // capital → invalid
        { id: '2', key: '2bad', kind: 'text', label: {} }, // leading digit
        { id: '3', key: 'ok', kind: 'nope', label: {} }, // unknown kind
        { id: '4', key: 'ok', kind: 'text', label: { el: 'Ok' } },
        { id: '5', key: 'ok', kind: 'text', label: {} }, // duplicate
      ],
    });
    assert.deepEqual(
      out.fields.map((x) => x.key),
      ['ok'],
    );
    assert.deepEqual(out.fields[0].label, { el: 'Ok' });
  });

  test('drops choice fields with no options and relations with no target', () => {
    const out = sanitizeCustomFieldsConfig({
      fields: [
        { id: '1', key: 'size', kind: 'select', label: {} },
        { id: '2', key: 'brand', kind: 'relation', label: {} },
        { id: '3', key: 'colour', kind: 'select', label: {}, options: [{ value: 'red' }] },
      ],
    });
    assert.deepEqual(
      out.fields.map((x) => x.key),
      ['colour'],
    );
  });

  test('repeaters keep one level of sub-fields and drop deeper nesting', () => {
    const out = sanitizeCustomFieldsConfig({
      fields: [
        {
          id: '1',
          key: 'rows',
          kind: 'repeater',
          label: {},
          subFields: [
            { id: 'a', key: 'name', kind: 'text', label: {} },
            { id: 'b', key: 'inner', kind: 'repeater', label: {}, subFields: [{ id: 'c', key: 'x', kind: 'text', label: {} }] },
          ],
        },
      ],
    });
    assert.deepEqual(out.fields[0].subFields?.map((x) => x.key), ['name']);
  });

  test('groups are ordered and deduped; an unknown renderAs falls back to specs', () => {
    const out = sanitizeCustomFieldsConfig({
      groups: [
        { key: 'care', label: {}, renderAs: 'tab', order: 2 },
        { key: 'sizing', label: {}, renderAs: 'wat', order: 1 },
        { key: 'care', label: {}, renderAs: 'specs', order: 0 },
      ],
    });
    assert.deepEqual(out.groups.map((g) => g.key), ['sizing', 'care']);
    assert.equal(out.groups[0].renderAs, 'specs');
  });

  test('customFieldsForCollection picks one collection out of the blob', () => {
    const blob = {
      product: { fields: [{ id: '1', key: 'material', kind: 'text', label: {} }] },
      article: { fields: [{ id: '2', key: 'mood', kind: 'text', label: {} }] },
    };
    assert.deepEqual(customFieldsForCollection(blob, 'product').fields.map((x) => x.key), ['material']);
    assert.deepEqual(customFieldsForCollection(blob, 'page').fields, []);
  });
});

// ── Compiling ─────────────────────────────────────────────────────────────────

describe('compileCustomFields', () => {
  test('returns null when there is nothing to add', () => {
    assert.equal(compileCustomFields(cfg([])), null);
  });

  test('compiles each kind into a valid, validating field', () => {
    const s = schemaFor(
      cfg([
        def({ key: 'material' }),
        def({ key: 'washTemp', kind: 'number', min: 0, max: 90 }),
        def({ key: 'giftWrap', kind: 'boolean' }),
        def({ key: 'origin', kind: 'select', options: [{ value: 'gr' }, { value: 'it' }] }),
        def({ key: 'tags', kind: 'multiselect', options: [{ value: 'eco' }, { value: 'vegan' }] }),
      ]),
    );
    assert.equal(
      s.safeParse({
        custom: { material: 'Cotton', washTemp: 30, giftWrap: true, origin: 'gr', tags: ['eco'] },
      }).success,
      true,
    );
    // Type + option constraints still apply.
    assert.equal(s.safeParse({ custom: { washTemp: 'hot' } }).success, false);
    assert.equal(s.safeParse({ custom: { washTemp: 200 } }).success, false);
    assert.equal(s.safeParse({ custom: { origin: 'fr' } }).success, false);
  });

  test('perLanguage compiles to a per-locale map', () => {
    const s = schemaFor(cfg([def({ key: 'material', perLanguage: true })]));
    assert.equal(s.safeParse({ custom: { material: { el: 'Βαμβάκι', en: 'Cotton' } } }).success, true);
    assert.equal(s.safeParse({ custom: { material: 'Cotton' } }).success, false);
  });

  test('a deleted definition strips its orphan value instead of failing the save', () => {
    // The group is non-strict precisely so removing a field in the admin can't
    // break every later save of a document that still carries its value.
    const s = schemaFor(cfg([def({ key: 'material' })]));
    const parsed = s.safeParse({ custom: { material: 'Cotton', washTemp: 30 } });
    assert.equal(parsed.success, true);
    assert.deepEqual(parsed.success && parsed.data, { custom: { material: 'Cotton' } });
  });

  test('unknown keys outside the custom group are still rejected', () => {
    const group = compileCustomFields(cfg([def({ key: 'material' })]))!;
    const s = buildDataSchema([f.text('title'), group], LOCALES);
    assert.equal(s.safeParse({ title: 'T', rogue: 1 }).success, false);
  });

  test('relation fields pointing at an unknown collection are dropped', () => {
    const config = cfg([def({ key: 'brandRef', kind: 'relation', relationTo: 'brand' })]);
    assert.equal(compileCustomFields(config, { knownCollections: new Set(['product']) }), null);
    assert.ok(compileCustomFields(config, { knownCollections: new Set(['product', 'brand']) }));
  });

  test('the group label becomes the field section, driving the editor heading', () => {
    const group = compileCustomFields(cfg([def({ key: 'material', group: 'care' })]))!;
    assert.equal(group.kind === 'group' && group.fields[0].section, 'care');
  });
});

// ── Conditional visibility ────────────────────────────────────────────────────

describe('visibility', () => {
  const config = cfg([
    def({ key: 'material', categoryIds: [7] }),
    def({ key: 'washTemp', kind: 'number' }),
  ]);

  test('unscoped fields apply everywhere; scoped ones need a matching category', () => {
    assert.deepEqual(visibleCustomFields(config, []).map((d) => d.key), ['washTemp']);
    assert.deepEqual(visibleCustomFields(config, [7]).map((d) => d.key), ['material', 'washTemp']);
    assert.deepEqual(visibleCustomFields(config, [9]).map((d) => d.key), ['washTemp']);
  });

  test('documentCategoryIds reads the relation, ignoring junk', () => {
    assert.deepEqual(documentCategoryIds({ categories: [1, '2', 0, -3, 4] }), [1, 4]);
    assert.deepEqual(documentCategoryIds({}), []);
    assert.deepEqual(documentCategoryIds(undefined), []);
  });

  test('required applies only to visible fields', () => {
    // `required` is enforced when the document goes live; a draft may be
    // incomplete. Both halves matter, so both are asserted here.
    const required = cfg([def({ key: 'material', required: true, categoryIds: [7] })]);
    const inCategory = schemaFor(required, new Set(['material']), { enforceRequired: true });
    const outside = schemaFor(required, new Set(), { enforceRequired: true });
    assert.equal(inCategory.safeParse({ custom: {} }).success, false);
    assert.equal(outside.safeParse({ custom: {} }).success, true);
  });

  test('required is not enforced while the document is a draft', () => {
    const required = cfg([def({ key: 'material', required: true, categoryIds: [7] })]);
    const draft = schemaFor(required, new Set(['material']));
    assert.equal(draft.safeParse({ custom: {} }).success, true);
  });

  test('a hidden field keeps its stored value (it stays in the schema)', () => {
    // Re-categorising a product must never silently discard what was authored.
    const config = cfg([def({ key: 'material', categoryIds: [7] })]);
    const outside = schemaFor(config, new Set());
    const parsed = outside.safeParse({ custom: { material: 'Cotton' } });
    assert.equal(parsed.success, true);
    assert.deepEqual(parsed.success && parsed.data, { custom: { material: 'Cotton' } });
  });
});

// ── Merging into a collection ─────────────────────────────────────────────────

describe('withCustomFields', () => {
  const base = resolveCollection({ key: 'product', fields: [f.text('title', { required: true })] });

  test('appends the custom group, leaving the code-defined fields intact', () => {
    const merged = withCustomFields(base, cfg([def({ key: 'material' })]));
    assert.deepEqual(merged.fields.map((x) => x.key), ['title', 'custom']);
    assert.notEqual(merged, base);
  });

  test('returns the collection untouched when there are no definitions', () => {
    assert.equal(withCustomFields(base, cfg([])), base);
  });

  test('a definition cannot shadow a code-defined `custom` field', () => {
    const shadowed = resolveCollection({ key: 'product', fields: [f.text('custom')] });
    assert.equal(withCustomFields(shadowed, cfg([def({ key: 'material' })])), shadowed);
  });
});

// ── Public-page projection ────────────────────────────────────────────────────

describe('groupCustomFieldValues', () => {
  const config = cfg(
    [
      def({ key: 'material', group: 'care' }),
      def({ key: 'washTemp', kind: 'number', group: 'care' }),
      def({ key: 'origin' }),
      def({ key: 'internalNote', showOnPdp: false }),
      def({ key: 'secret', group: 'ops' }),
      def({ key: 'sizeOnly', group: 'care', categoryIds: [7] }),
    ],
    [
      { key: 'care', label: { en: 'Care' }, renderAs: 'tab', order: 0 },
      { key: 'ops', label: { en: 'Ops' }, renderAs: 'hidden', order: 1 },
    ],
  );

  const data = {
    custom: {
      material: 'Cotton',
      washTemp: 30,
      origin: 'GR',
      internalNote: 'do not ship Fridays',
      secret: 'x',
      sizeOnly: 'M',
      stale: 'orphan value from a deleted definition',
    },
  };

  test('splits by group, honouring renderAs, showOnPdp and category scope', () => {
    const groups = groupCustomFieldValues(config, data, []);
    assert.deepEqual(
      groups.map((g) => [g.key, g.renderAs, g.fields.map((x) => x.key)]),
      [
        ['care', 'tab', ['material', 'washTemp']],
        ['', 'specs', ['origin']],
      ],
    );
  });

  test('a scoped field joins its group once the product is in the category', () => {
    const groups = groupCustomFieldValues(config, data, [7]);
    assert.deepEqual(groups[0].fields.map((x) => x.key), ['material', 'washTemp', 'sizeOnly']);
  });

  test('empty values and values with no definition are skipped', () => {
    const groups = groupCustomFieldValues(config, { custom: { origin: '', material: 'Wool' } }, []);
    assert.deepEqual(groups.map((g) => g.fields.map((x) => x.key)), [['material']]);
  });

  test('no custom data yields no groups', () => {
    assert.deepEqual(groupCustomFieldValues(config, {}, []), []);
  });
});
