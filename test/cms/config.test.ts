import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { collectionSummary, labelText } from '@/cms/admin/shared';
import { resolveCollection } from '@/cms/config/collection';
import { defineConfig } from '@/cms/config/config';
import { f, isRelationKind, walkFields, type Field } from '@/cms/config/fields';

describe('field builders (f.*)', () => {
  test('stamp the right kind and merge options', () => {
    assert.deepEqual(f.text('x'), { kind: 'text', key: 'x' });
    assert.deepEqual(f.mdx('body'), { kind: 'code', key: 'body', language: 'mdx' });
    assert.equal(f.variations('v').attributesKey, 'attributes');
    assert.equal(f.variations('v', { attributesKey: 'attrs' }).attributesKey, 'attrs');
  });

  test('isRelationKind narrows relation fields', () => {
    assert.equal(isRelationKind(f.relation('r', { to: 'c' })), true);
    assert.equal(isRelationKind(f.text('t')), false);
  });

  test('walkFields visits every field with an accumulated path', () => {
    const fields: Field[] = [f.text('title'), f.repeater('rows', [f.text('t'), f.group('g', [f.text('inner')])])];
    const paths: string[][] = [];
    walkFields(fields, (_field, path) => paths.push(path));
    assert.deepEqual(paths, [['title'], ['rows'], ['rows', 't'], ['rows', 'g'], ['rows', 'g', 'inner']]);
  });
});

describe('resolveCollection', () => {
  test('applies defaults and the label fallback chain', () => {
    assert.deepEqual(resolveCollection({ key: 'k', fields: [] }), {
      key: 'k',
      fields: [],
      label: 'k',
      labelPlural: 'k',
      seo: true,
      drafts: true,
      singleton: false,
      hidden: false,
      routing: {},
    });
    assert.equal(resolveCollection({ key: 'k', label: 'L', fields: [] }).labelPlural, 'L');
    assert.equal(resolveCollection({ key: 'k', fields: [], drafts: false }).drafts, false);
  });
});

describe('defineConfig validation', () => {
  const coll = (key: string, fields: Field[] = [f.text('title')]) => ({ key, fields });
  const base = { locales: ['en', 'el'], defaultLocale: 'en' };

  test('rejects bad locales / empty collections', () => {
    assert.throws(() => defineConfig({ ...base, locales: [], collections: [coll('a')] }), /locales/);
    assert.throws(() => defineConfig({ locales: ['en'], defaultLocale: 'el', collections: [coll('a')] }), /defaultLocale/);
    assert.throws(() => defineConfig({ ...base, collections: [] }), /at least one collection/);
  });

  test('rejects bad collection keys, duplicates and bad field keys', () => {
    assert.throws(() => defineConfig({ ...base, collections: [coll('Foo')] }), /collection key/);
    assert.throws(() => defineConfig({ ...base, collections: [coll('a'), coll('a')] }), /duplicate collection key/);
    assert.throws(() => defineConfig({ ...base, collections: [coll('a', [f.text('Bad')])] }), /invalid key/);
    assert.throws(
      () => defineConfig({ ...base, collections: [coll('a', [f.text('t'), f.text('t')])] }),
      /duplicate sibling field key/,
    );
  });

  test('rejects relations that target an unknown collection', () => {
    assert.throws(
      () => defineConfig({ ...base, collections: [coll('a', [f.relation('c', { to: 'ghost' })])] }),
      /unknown collection "ghost"/,
    );
  });

  test('collectionKeyByAlias maps the plural spellings a URL might use', () => {
    const cfg = defineConfig({
      ...base,
      collections: [
        { key: 'page', label: 'Page', labelPlural: 'Pages', fields: [f.text('title')] },
        { key: 'article', label: { en: 'Article', el: 'Άρθρο' }, labelPlural: { en: 'Articles', el: 'Άρθρα' }, fields: [f.text('title')] },
      ],
    });
    // The plural the admin shows, and the mechanical plural of the key.
    assert.equal(cfg.collectionKeyByAlias.get('pages'), 'page');
    assert.equal(cfg.collectionKeyByAlias.get('articles'), 'article');
    // Every locale's spelling, not just the default one.
    assert.equal(cfg.collectionKeyByAlias.get('άρθρα'), 'article');
    // A real key is never an alias — it resolves through collectionByKey.
    assert.equal(cfg.collectionKeyByAlias.has('page'), false);
    assert.equal(cfg.collectionKeyByAlias.has('nonsense'), false);
  });

  test('an alias two collections both claim is dropped, not guessed', () => {
    // Both would claim `notes`: one from its key, one from its plural label.
    const cfg = defineConfig({
      ...base,
      collections: [
        { key: 'note', fields: [f.text('t')] },
        { key: 'memo', labelPlural: 'Notes', fields: [f.text('t')] },
      ],
    });
    assert.equal(cfg.collectionKeyByAlias.has('notes'), false);
  });

  test('happy path: defaults, module merge and lookup map', () => {
    const cfg = defineConfig({
      ...base,
      collections: [coll('category'), coll('article', [f.relation('cat', { to: 'category' })])],
    });
    assert.equal(cfg.name, 'CMS');
    assert.equal(cfg.modules.commerce, false); // default off
    assert.equal(cfg.modules.forms, true); // default on
    assert.equal(cfg.collectionByKey.get('article')?.key, 'article');
    assert.equal(cfg.collections.length, 2);
  });
});

describe('labelText / collectionSummary', () => {
  test('labelText resolves per-locale maps with fallbacks', () => {
    assert.equal(labelText(undefined, 'en', 'fb'), 'fb');
    assert.equal(labelText('L', 'en', 'fb'), 'L');
    assert.equal(labelText({ en: 'E', el: 'G' }, 'el', 'fb'), 'G');
    assert.equal(labelText({ el: 'G' }, 'en', 'fb'), 'G'); // first value fallback
    assert.equal(labelText({}, 'en', 'fb'), 'fb');
  });

  test('collectionSummary picks the serialisable subset', () => {
    const c = resolveCollection({ key: 'k', label: 'L', icon: 'shopping-bag', fields: [f.text('t')], module: 'commerce' });
    assert.deepEqual(collectionSummary(c), {
      key: 'k',
      label: 'L',
      labelPlural: 'L',
      icon: 'shopping-bag',
      singleton: false,
      hidden: false,
      module: 'commerce',
    });
  });
});
