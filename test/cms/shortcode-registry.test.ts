import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  attrsToZod,
  defineShortcode,
  resolveShortcode,
  type ShortcodeDef,
} from '@/cms/core/shortcodes/registry';

/**
 * A shortcode may render only when the registry says so, and only with
 * attributes it declared.
 *
 * This is the whole XSS story for the feature: attribute values come out of a
 * page body that an editor typed, they are validated against a declared shape
 * here, and anything unknown is dropped rather than passed to a component.
 */

const reviews: ShortcodeDef = defineShortcode({
  name: 'google-reviews',
  label: 'Google reviews',
  module: 'googleReviews',
  attrs: {
    layout: { kind: 'select', options: ['carousel', 'grid', 'badge'], default: 'carousel' },
    limit: { kind: 'int', min: 1, max: 50, default: 6 },
    location: { kind: 'text', maxLength: 40, default: 'all' },
    hideEmpty: { kind: 'boolean', default: false },
  },
});

const registry = { 'google-reviews': reviews };

describe('attrsToZod', () => {
  const schema = attrsToZod(reviews.attrs);

  test('fills in the declared defaults', () => {
    const parsed = schema.parse({});
    assert.deepEqual(parsed, { layout: 'carousel', limit: 6, location: 'all', hideEmpty: false });
  });

  test('numbers arrive as strings from the body and come out as numbers', () => {
    assert.equal(schema.parse({ limit: '12' }).limit, 12);
  });

  test('a number outside the declared range is refused', () => {
    assert.equal(schema.safeParse({ limit: '900' }).success, false);
    assert.equal(schema.safeParse({ limit: '0' }).success, false);
    assert.equal(schema.safeParse({ limit: 'lots' }).success, false);
  });

  test('a select only takes what it offers', () => {
    assert.equal(schema.safeParse({ layout: 'carousel' }).success, true);
    assert.equal(schema.safeParse({ layout: 'onfire' }).success, false);
  });

  test('booleans read the words an author would type', () => {
    assert.equal(schema.parse({ hideEmpty: 'true' }).hideEmpty, true);
    assert.equal(schema.parse({ hideEmpty: 'false' }).hideEmpty, false);
  });

  test('an attribute nobody declared is refused, not passed through', () => {
    // The whole point: an undeclared attribute must never reach a component.
    assert.equal(schema.safeParse({ onclick: 'alert(1)' }).success, false);
    assert.equal(schema.safeParse({ dangerouslySetInnerHTML: 'x' }).success, false);
  });

  test('a text attribute is length-bounded', () => {
    assert.equal(schema.safeParse({ location: 'x'.repeat(200) }).success, false);
  });
});

describe('resolveShortcode', () => {
  const enabled = { googleReviews: true };

  test('returns the definition and the cleaned attributes', () => {
    const result = resolveShortcode(
      registry,
      { name: 'google-reviews', attrs: { limit: '3' } },
      enabled
    );
    assert.equal(result.kind, 'ok');
    if (result.kind === 'ok') {
      assert.equal(result.attrs.limit, 3);
      assert.equal(result.def.name, 'google-reviews');
    }
  });

  test('an unknown name is unknown — never rendered, and flagged for the editor', () => {
    const result = resolveShortcode(registry, { name: 'nope', attrs: {} }, enabled);
    assert.equal(result.kind, 'unknown');
  });

  test('a shortcode whose module is off is disabled, not unknown', () => {
    // The editor needs to tell "you have not switched this on" apart from
    // "this does not exist"; the public site renders nothing either way.
    const result = resolveShortcode(
      registry,
      { name: 'google-reviews', attrs: {} },
      {
        googleReviews: false,
      }
    );
    assert.equal(result.kind, 'disabled');
  });

  test('bad attributes are a failure, not a half-rendered component', () => {
    const result = resolveShortcode(
      registry,
      { name: 'google-reviews', attrs: { limit: 'everything' } },
      enabled
    );
    assert.equal(result.kind, 'invalid');
  });

  test('prototype names are not shortcodes', () => {
    for (const name of ['constructor', '__proto__', 'toString']) {
      assert.equal(resolveShortcode(registry, { name, attrs: {} }, enabled).kind, 'unknown', name);
    }
  });
});

describe('defineShortcode', () => {
  test('refuses a name that is not kebab-case', () => {
    for (const name of ['Bad Name', 'UPPER', 'has_underscore', '']) {
      assert.throws(() => defineShortcode({ name, label: 'x', attrs: {} }), /name/i);
    }
  });

  test('a component name is derived for the MDX allowlist', () => {
    assert.equal(
      defineShortcode({ name: 'google-reviews', label: 'x', attrs: {} }).componentName,
      'GoogleReviews'
    );
  });
});
