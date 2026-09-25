import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { STATUS_HELP } from '@/cms/admin/status-options';
import { shortcodeAttrHelp } from '@/cms/admin/fields/InsertShortcodeDialog';
import { taxonomyCollection, type CollectionDefinition } from '@/cms/config';
import { brandCollection } from '@/cms/core/content/brand';
import { testimonialCollection } from '@/cms/core/content/testimonial';
import { shortcodeList } from '@/cms/core/shortcodes';
import { popupCollection } from '@/cms/modules/popups';
import config from '@/site.config';

import { missingDescriptions } from '../setup/field-help';

/**
 * Every field an owner fills in says what it does.
 *
 * The admin shows a field's `description` behind an "i" beside its label. These
 * are the content collections a non-technical owner meets first — a popup, a
 * testimonial, a brand logo, a category, a page, and the blog / FAQ / case-study
 * collections the new-site skill generates — and a field without one leaves the
 * owner guessing what "Priority" or "Other spelling" does. A new field added
 * without a sentence fails here, which is the point.
 *
 * The collections the new-site skill generates are checked where the generator
 * lives, in `test/tools/generated-field-help.test.ts`; in a generated site they
 * are part of `site.config.ts` and are checked here.
 */
describe('field help: every owner-facing field has a description', () => {
  const owned: CollectionDefinition[] = [
    popupCollection(),
    testimonialCollection(),
    brandCollection(),
    taxonomyCollection({
      key: 'article_category',
      label: 'Blog category',
      labelPlural: 'Blog categories',
      pathTemplate: '/blog/categories/{slug}',
      hierarchical: true,
    }),
    // Everything the site declares: the page collection in the base, and in a
    // generated site its blog / FAQ / case-study collections too.
    ...config.collections,
  ];

  for (const collection of owned) {
    test(`${collection.key}`, () => {
      assert.deepEqual(missingDescriptions(collection), []);
    });
  }

  test('the page collection is among them', () => {
    assert.ok(owned.some((c) => c.key === 'page'));
  });
});

describe('status help', () => {
  test('explains all four statuses, not only to writers', () => {
    for (const word of ['Draft', 'Published', 'Scheduled', 'Archived']) {
      assert.match(STATUS_HELP, new RegExp(word), `${word} is not explained`);
    }
  });
});

describe('shortcode attribute help', () => {
  /**
   * `form` and `popup` are declared in the core but this site renders nothing
   * for them (no entry in `src/shortcodes`), so there is no behaviour to
   * describe truthfully yet.
   */
  const NO_RENDERER = new Set(['form', 'popup']);

  for (const def of shortcodeList().filter((d) => !NO_RENDERER.has(d.name))) {
    test(`${def.name}: every attribute says what it does`, () => {
      const missing = Object.keys(def.attrs).filter((attr) => !shortcodeAttrHelp(def.name, attr)?.trim());
      assert.deepEqual(missing, []);
    });
  }

  test('an unknown attribute has no help rather than a wrong one', () => {
    assert.equal(shortcodeAttrHelp('brands', 'nope'), undefined);
  });
});
