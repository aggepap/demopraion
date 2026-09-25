import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildDataSchema } from '@/cms/config/zod';
import type { SelectField } from '@/cms/config/fields';
import { documentSeo } from '@/cms/core/seo/document';
import {
  compileSeoGroup,
  emptySeoOverrides,
  resolveSeoFields,
  sanitizeSeoFieldOverrides,
} from '@/cms/core/seo/field-overrides';
import { SCHEMA_TYPE_FIELD_KEY } from '@/cms/core/structured-data/policy';

/**
 * One document may say it is something other than its category's default — a
 * page that is the Contact page, an article that is news — but only from the
 * types its category allows.
 */

const field = (collection?: string) =>
  resolveSeoFields(emptySeoOverrides(), collection).find((d) => d.key === SCHEMA_TYPE_FIELD_KEY);
const values = (collection: string) => (field(collection)?.field as SelectField).options.map((o) => o.value);

describe('the per-document schema type', () => {
  test('offers inherit plus the category types, on the Advanced tab before the raw override', () => {
    const def = field('article');
    assert.ok(def);
    assert.equal(def.tab, 'advanced');
    assert.equal(def.storage, 'data');
    assert.deepEqual(values('article'), ['inherit', 'BlogPosting', 'Article', 'NewsArticle', 'TechArticle', 'None']);
    assert.equal((def.field as SelectField).default, 'inherit');
    const defs = resolveSeoFields(emptySeoOverrides(), 'article').map((d) => d.key);
    assert.ok(defs.indexOf(SCHEMA_TYPE_FIELD_KEY) < defs.indexOf('schemaOverride'));
  });

  test('bookings list the day-trip and stay types together', () => {
    const list = values('booking');
    assert.ok(list.includes('TouristTrip'));
    assert.ok(list.includes('Apartment'));
    // Product and None are in both lists but offered once.
    assert.equal(list.filter((v) => v === 'Product').length, 1);
  });

  test('is absent where there is no category, or no collection', () => {
    assert.equal(field('testimonial'), undefined);
    assert.equal(field(), undefined);
  });

  test('a value outside the list is refused on save', () => {
    const group = compileSeoGroup(resolveSeoFields(emptySeoOverrides(), 'page'));
    assert.ok(group);
    const schema = buildDataSchema([group], ['en']);
    assert.equal(schema.safeParse({ seo: { schemaType: 'ContactPage' } }).success, true);
    assert.equal(schema.safeParse({ seo: { schemaType: 'Product' } }).success, false);
  });

  test('an admin-added SEO field cannot take its key', () => {
    const o = sanitizeSeoFieldOverrides({
      extra: [{ id: 'x', key: SCHEMA_TYPE_FIELD_KEY, kind: 'text', label: { en: 'x' } }],
    });
    assert.equal(o.extra.length, 0);
  });

  test('documentSeo reads inherit and junk as no override', () => {
    const of = (schemaType: unknown) => documentSeo({ data: { seo: { schemaType } } }).schemaType;
    assert.equal(of('NewsArticle'), 'NewsArticle');
    for (const none of ['inherit', '', '  ', 42, null, undefined]) assert.equal(of(none), null);
  });
});
