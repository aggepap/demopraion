import '../setup/react-global';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { StructuredDataSettings } from '@/cms/admin/StructuredDataSettings';
import { SCHEMA_CATEGORIES, parseSchemaPolicy } from '@/cms/core/structured-data/policy';

/**
 * Settings → Structured data: one card per kind of content the site has, each
 * offering only the types — and the parts — that make sense for it.
 */

const categories = (...keys: string[]) => SCHEMA_CATEGORIES.filter((c) => keys.includes(c.key));

const render = (stored: unknown, keys: string[], brandHasAddress = true) =>
  renderToStaticMarkup(
    <StructuredDataSettings
      initial={parseSchemaPolicy(stored)}
      categories={categories(...keys)}
      brandHasAddress={brandHasAddress}
    />,
  );

describe('StructuredDataSettings', () => {
  test('shows the business type and only the categories passed in', () => {
    const html = render(null, ['pages', 'articles']);
    assert.match(html, /Business type/);
    assert.match(html, /Pages/);
    assert.match(html, /Articles/);
    assert.doesNotMatch(html, /Products/);
    assert.doesNotMatch(html, /Stays/);
  });

  test('each type select offers only its category types', () => {
    const html = render(null, ['articles']);
    assert.match(html, /value="NewsArticle"/);
    assert.doesNotMatch(html, /value="Product"/);
    assert.doesNotMatch(html, /value="TouristTrip"/);
  });

  test('article parts appear for BlogPosting', () => {
    const html = render(null, ['articles']);
    assert.match(html, /Author/);
    assert.match(html, /Publish and update dates/);
    assert.match(html, /Speakable/);
    assert.match(html, /Breadcrumbs/);
  });

  test('None hides breadcrumbs, FAQs and parts', () => {
    const html = render({ categories: { articles: { type: 'None' } } }, ['articles']);
    assert.doesNotMatch(html, /Author/);
    assert.doesNotMatch(html, /Speakable/);
    assert.doesNotMatch(html, /Breadcrumbs/);
  });

  test('a stay described as an Apartment offers no price part', () => {
    const html = render({ categories: { bookingStay: { type: 'Apartment' } } }, ['bookingStay']);
    assert.doesNotMatch(html, /Price and availability/);
    assert.match(html, /Images/);
  });

  test('a local business without an address in Branding is flagged', () => {
    assert.match(render({ business: { type: 'Hotel' } }, ['pages'], false), /role="alert"/);
    assert.doesNotMatch(render({ business: { type: 'Hotel' } }, ['pages'], true), /role="alert"/);
    assert.doesNotMatch(render({ business: { type: 'Organization' } }, ['pages'], false), /role="alert"/);
  });
});
