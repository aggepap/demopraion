import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildDataSchema } from '@/cms/config/zod';
import type { CustomFieldDef } from '@/cms/core/fields/definitions';
import { documentSeo, seoRestrictsRobots } from '@/cms/core/seo/document';
import {
  compileSeoGroup,
  emptySeoOverrides,
  resolveSeoFields,
  sanitizeSeoFieldOverrides,
  seoFieldsByTab,
  type SeoFieldOverrides,
} from '@/cms/core/seo/field-overrides';
import {
  ROBOTS_DEFAULT,
  robotsColumns,
  robotsValue,
  SEO_BUILTIN_KEYS,
  SEO_FIELD_DEFS,
  SEO_FIELDS_DATA_KEY,
} from '@/cms/core/seo/fields';

const LOCALES = ['el', 'en'];

const overrides = (over: Partial<SeoFieldOverrides> = {}): SeoFieldOverrides => ({
  ...emptySeoOverrides(),
  ...over,
});

const extra = (over: Partial<CustomFieldDef> & Pick<CustomFieldDef, 'key'>): CustomFieldDef => ({
  id: over.key,
  kind: 'text',
  label: { el: over.key, en: over.key },
  ...over,
});

describe('the shipped set', () => {
  /*
   * The point of the whole feature: no seeder, no migration, no settings row.
   * If this ever fails, a fresh install has lost its SEO fields.
   */
  test('an empty settings blob still yields every built-in', () => {
    const defs = resolveSeoFields(sanitizeSeoFieldOverrides(undefined));
    assert.equal(defs.length, SEO_FIELD_DEFS.length);
    assert.deepEqual(defs.map((d) => d.key).sort(), [...SEO_BUILTIN_KEYS].sort());
  });

  test('junk in the settings row degrades to the shipped set, not to nothing', () => {
    for (const junk of [null, 42, 'nope', [], { disabled: 'seoTitle' }]) {
      const defs = resolveSeoFields(sanitizeSeoFieldOverrides(junk));
      assert.equal(defs.length, SEO_FIELD_DEFS.length, `for ${JSON.stringify(junk)}`);
    }
  });

  test('every field lands on a known tab and the order is stable', () => {
    const defs = resolveSeoFields(overrides());
    const orders = defs.map((d) => d.order);
    assert.deepEqual(
      orders,
      [...orders].sort((a, b) => a - b)
    );
    assert.deepEqual(
      seoFieldsByTab(defs).map((t) => t.tab),
      ['general', 'social', 'aeo', 'advanced']
    );
  });

  test('five fields write to document columns, the rest to data.seo', () => {
    const defs = resolveSeoFields(overrides());
    const columns = defs.filter((d) => d.storage === 'column');
    assert.deepEqual(columns.map((d) => d.column).sort(), [
      'includeInSitemap',
      'metaDescription',
      'metaTitle',
      'ogImageUuid',
      'robots',
    ]);
    assert.ok(defs.filter((d) => d.storage === 'data').length > 0);
  });
});

describe('compileSeoGroup', () => {
  test('compiles only the data-backed fields, under the `seo` key', () => {
    const defs = resolveSeoFields(overrides());
    const group = compileSeoGroup(defs);
    assert.ok(group);
    assert.equal(group.key, SEO_FIELDS_DATA_KEY);
    assert.equal(group.fields.length, defs.filter((d) => d.storage === 'data').length);
    // A column-backed field must never appear inside `data`, or its value
    // would be stored twice and the two copies would drift.
    assert.equal(
      group.fields.some((f) => f.key === 'seoTitle'),
      false
    );
  });

  test('is not `shared` — SEO copy differs per language', () => {
    const group = compileSeoGroup(resolveSeoFields(overrides()));
    assert.ok(group);
    assert.notEqual(group.shared, true);
  });

  test('is not strict, so a disabled field’s stored value does not break saves', () => {
    const group = compileSeoGroup(resolveSeoFields(overrides()));
    assert.ok(group);
    assert.equal(group.strict, false);

    const schema = buildDataSchema([group], LOCALES);
    const parsed = schema.parse({ seo: { ogTitle: 'kept', someRemovedField: 'orphan' } }) as {
      seo: Record<string, unknown>;
    };
    assert.equal(parsed.seo.ogTitle, 'kept');
    assert.equal('someRemovedField' in parsed.seo, false);
  });

  test('the whole group is optional — an existing document has no data.seo', () => {
    const group = compileSeoGroup(resolveSeoFields(overrides()));
    assert.ok(group);
    assert.deepEqual(buildDataSchema([group], LOCALES).parse({}), {});
  });

  test('returns null when every data field is disabled', () => {
    const dataKeys = SEO_FIELD_DEFS.filter((d) => d.storage === 'data').map((d) => d.key);
    const defs = resolveSeoFields(overrides({ disabled: dataKeys }));
    assert.equal(compileSeoGroup(defs), null);
  });
});

describe('overrides', () => {
  test('disabling removes a field from the list', () => {
    const defs = resolveSeoFields(overrides({ disabled: ['prosCons'] }));
    assert.equal(
      defs.some((d) => d.key === 'prosCons'),
      false
    );
    assert.equal(defs.length, SEO_FIELD_DEFS.length - 1);
  });

  test('a per-collection exception hides it there and nowhere else', () => {
    const o = overrides({ perCollection: { article: { disabled: ['faqs'] } } });
    assert.equal(
      resolveSeoFields(o, 'article').some((d) => d.key === 'faqs'),
      false
    );
    assert.equal(
      resolveSeoFields(o, 'page').some((d) => d.key === 'faqs'),
      true
    );
  });

  test('relabelling replaces the shipped label', () => {
    const defs = resolveSeoFields(
      overrides({ labels: { seoTitle: { el: 'Τίτλος', en: 'Title' } } })
    );
    const seoTitle = defs.find((d) => d.key === 'seoTitle');
    assert.deepEqual(seoTitle?.field.label, { el: 'Τίτλος', en: 'Title' });
  });

  test('re-ordering and re-tabbing move a field', () => {
    const defs = resolveSeoFields(
      overrides({ order: { schemaOverride: 1 }, tab: { schemaOverride: 'general' } })
    );
    assert.equal(defs[0].key, 'schemaOverride');
    assert.equal(defs[0].tab, 'general');
  });

  test('`required` applies to data fields and is refused for column fields', () => {
    // `metaDescription` is column-backed: the write route validates it with its
    // own zod body, which knows nothing about these overrides, so a rule set
    // here would hold in the form and nowhere else.
    const o = sanitizeSeoFieldOverrides({ required: { ogTitle: true, metaDescription: true } });
    assert.deepEqual(o.required, { ogTitle: true });

    const defs = resolveSeoFields(o);
    assert.equal(defs.find((d) => d.key === 'ogTitle')?.field.required, true);
    assert.notEqual(defs.find((d) => d.key === 'metaDescription')?.field.required, true);
  });

  test('a required data field blocks publishing but not a draft', () => {
    const group = compileSeoGroup(resolveSeoFields(overrides({ required: { ogTitle: true } })));
    assert.ok(group);
    assert.doesNotThrow(() => buildDataSchema([group], LOCALES).parse({ seo: {} }));
    assert.throws(() =>
      buildDataSchema([group], LOCALES, { enforceRequired: true }).parse({ seo: { ogTitle: '' } })
    );
  });
});

describe('extras', () => {
  test('an extra field is added, compiled, and tabbed by its group', () => {
    const defs = resolveSeoFields(
      overrides({ extra: [extra({ key: 'readingTime', kind: 'number', group: 'aeo' })] })
    );
    const added = defs.find((d) => d.key === 'readingTime');
    assert.ok(added);
    assert.equal(added.builtIn, false);
    assert.equal(added.storage, 'data');
    assert.equal(added.tab, 'aeo');

    const group = compileSeoGroup(defs);
    assert.ok(group?.fields.some((f) => f.key === 'readingTime' && f.kind === 'number'));
  });

  test('extras trail the built-ins by default', () => {
    const defs = resolveSeoFields(overrides({ extra: [extra({ key: 'zz' })] }));
    assert.equal(defs[defs.length - 1].key, 'zz');
  });

  test('an extra may not squat on a built-in key', () => {
    const o = sanitizeSeoFieldOverrides({ extra: [extra({ key: 'seoTitle', kind: 'number' })] });
    assert.equal(o.extra.length, 0);
    // And the built-in is untouched.
    assert.equal(resolveSeoFields(o).find((d) => d.key === 'seoTitle')?.storage, 'column');
  });

  test('an unusable extra is dropped by the shared sanitiser', () => {
    const o = sanitizeSeoFieldOverrides({
      extra: [
        extra({ key: 'noOptions', kind: 'select' }),
        extra({ key: '9bad' }),
        extra({ key: 'fine' }),
      ],
    });
    assert.deepEqual(
      o.extra.map((f) => f.key),
      ['fine']
    );
  });
});

describe('the robots codec', () => {
  test('round-trips every combination', () => {
    for (const noindex of [false, true]) {
      for (const nofollow of [false, true]) {
        assert.deepEqual(robotsColumns(robotsValue(noindex, nofollow)), { noindex, nofollow });
      }
    }
  });

  test('the permissive state is the default string', () => {
    assert.equal(robotsValue(false, false), ROBOTS_DEFAULT);
  });

  test('an unrecognised value reads as permissive, never as de-indexed', () => {
    for (const junk of ['noindex', 'NOINDEX, NOFOLLOW', '', null, undefined, 7]) {
      assert.deepEqual(robotsColumns(junk), { noindex: false, nofollow: false });
    }
  });
});

describe('documentSeo', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    data: {},
    metaTitle: null,
    metaDescription: null,
    noindex: false,
    nofollow: false,
    includeInSitemap: true,
    ogImageUuid: null,
    ...over,
  });

  test('a document written before the feature existed reads as all-unset', () => {
    const seo = documentSeo(row());
    assert.deepEqual(seo.faqs, []);
    assert.equal(seo.ogTitle, null);
    assert.equal(seo.schemaOverride, null);
    assert.equal(seo.robots, ROBOTS_DEFAULT);
    assert.equal(seoRestrictsRobots(seo), false);
    // Absent must read as "in the sitemap" — the column default. Reading it as
    // false would silently drop every existing page from sitemap.xml.
    assert.equal(seo.includeInSitemap, true);
  });

  test('a garbage data blob does not throw', () => {
    for (const data of [null, 'nope', 42, [], { seo: 'not-an-object' }, { seo: [] }]) {
      assert.doesNotThrow(() => documentSeo(row({ data })));
    }
  });

  test('reads the columns and the JSON side by side', () => {
    const seo = documentSeo(
      row({
        metaTitle: 'Title',
        noindex: true,
        includeInSitemap: false,
        ogImageUuid: 'uuid-1',
        data: { seo: { ogTitle: 'Social', twitterCard: 'summary', canonicalUrl: '/the-original' } },
      })
    );
    assert.equal(seo.metaTitle, 'Title');
    assert.equal(seo.canonicalUrl, '/the-original');
    assert.equal(seo.ogTitle, 'Social');
    assert.equal(seo.twitterCard, 'summary');
    assert.equal(seo.ogImageUuid, 'uuid-1');
    assert.equal(seo.robots, 'noindex, follow');
    assert.equal(seoRestrictsRobots(seo), true);
    assert.equal(seo.includeInSitemap, false);
  });

  test('blank strings read as unset, so a cleared field falls back', () => {
    const seo = documentSeo(row({ metaTitle: '   ', data: { seo: { ogTitle: '' } } }));
    assert.equal(seo.metaTitle, null);
    assert.equal(seo.ogTitle, null);
  });

  test('an unknown twitter card is ignored rather than emitted', () => {
    assert.equal(documentSeo(row({ data: { seo: { twitterCard: 'player' } } })).twitterCard, null);
  });

  test('half an FAQ pair is dropped — search engines reject the whole block', () => {
    const seo = documentSeo(
      row({
        data: {
          seo: {
            faqs: [
              { question: 'Q1', answer: 'A1' },
              { question: 'Q2' },
              { answer: 'A3' },
              'nonsense',
            ],
          },
        },
      })
    );
    assert.deepEqual(seo.faqs, [{ question: 'Q1', answer: 'A1' }]);
  });

  test('repeaters of one string flatten, empties dropped', () => {
    const seo = documentSeo(
      row({
        data: {
          seo: {
            focusKeywords: [{ keyword: 'aeo' }, { keyword: '  ' }, {}],
            keyFacts: [{ fact: 'Founded 2019' }],
          },
        },
      })
    );
    assert.deepEqual(seo.focusKeywords, ['aeo']);
    assert.deepEqual(seo.keyFacts, ['Founded 2019']);
  });

  test('a key fact may be a whole sentence, not 200 characters', () => {
    /*
     * It was a 200-character single-line field, and a markdown import of a real
     * article failed the WHOLE document on `seo.keyFacts.3.fact` — over a fact
     * with a qualifying clause on the end. The cap that remains is a bound on
     * an unbounded write, not advice about how to write a fact.
     */
    // Trimmed by the reader, like every other stored string.
    const fact = 'Open 9–5 on weekdays, '.repeat(20).trim(); // ~440 characters
    const def = SEO_FIELD_DEFS.find((d) => d.key === 'keyFacts');
    const item = def?.field.kind === 'repeater' ? def.field.fields[0] : undefined;
    assert.equal(item?.kind, 'textarea');
    assert.ok((item?.maxLength ?? 0) >= 1000, 'a fact should not be capped at a phrase');

    const seo = documentSeo(row({ data: { seo: { keyFacts: [{ fact }] } } }));
    assert.deepEqual(seo.keyFacts, [fact]);
  });

  test('a schema override parses only when it is an object or an array', () => {
    const of = (schemaOverride: unknown) =>
      documentSeo(row({ data: { seo: { schemaOverride } } })).schemaOverride;
    assert.deepEqual(of('{"@type":"FAQPage"}'), { '@type': 'FAQPage' });
    assert.deepEqual(of('[{"@type":"Thing"}]'), [{ '@type': 'Thing' }]);
    // Broken or meaningless input must leave the generated graph standing
    // rather than blanking out a page's structured data.
    for (const bad of ['{"broken":', '"just a string"', '42', 'null', '', '   ']) {
      assert.equal(of(bad), null, `for ${JSON.stringify(bad)}`);
    }
  });
});
