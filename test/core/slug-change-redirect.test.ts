import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import {
  planSlugChangeRedirect,
  SLUG_CHANGE_REASON,
  type SlugChangeInput,
  type SlugRuleRow,
} from '@/cms/core/seo/slug-change-redirect';

/**
 * Changing the slug of a page visitors can already reach used to break every
 * link to it — bookmarks, Google results, links from other sites — because the
 * old address simply stopped answering. The CMS now writes a permanent (301)
 * redirect from the old address to the new one, per language, and keeps those
 * rules tidy: no chains, never over an admin's own rule, never hiding a page
 * that lives at an address a rule once pointed away from.
 *
 * The decision is `planSlugChangeRedirect`, pure. Wiring into the save path and
 * the schema column are pinned at the bottom by reading the source, like the
 * other redirect writers — this suite has no database.
 */

const DOC = 7;

function rule(over: Partial<SlugRuleRow>): SlugRuleRow {
  return {
    id: 1,
    source: '/x',
    target: '/y',
    kind: 'literal',
    active: true,
    documentId: null,
    reason: null,
    ...over,
  };
}

function input(over: Partial<SlugChangeInput> = {}): SlugChangeInput {
  return {
    documentId: DOC,
    wasPublic: true,
    isPublic: true,
    oldPath: '/about',
    newPath: '/about-us',
    rules: [],
    ...over,
  };
}

describe('planSlugChangeRedirect — when a rule is written', () => {
  test('a live page whose slug changes gets a 301 from the old address to the new one', () => {
    assert.deepEqual(planSlugChangeRedirect(input()).create, { source: '/about', target: '/about-us' });
  });

  test('works per language: the paths carry their own locale prefix', () => {
    const plan = planSlugChangeRedirect(input({ oldPath: '/en/about', newPath: '/en/about-us' }));
    assert.deepEqual(plan.create, { source: '/en/about', target: '/en/about-us' });
  });

  test('a page nobody could reach yet (draft, or scheduled and not due) gets nothing', () => {
    assert.equal(planSlugChangeRedirect(input({ wasPublic: false })).create, null);
  });

  test('an unchanged address gets nothing', () => {
    assert.equal(planSlugChangeRedirect(input({ newPath: '/about' })).create, null);
    // Trailing slash and spacing do not make it a different address.
    assert.equal(planSlugChangeRedirect(input({ newPath: '/about/' })).create, null);
  });

  test('a collection with no public address gets nothing', () => {
    assert.equal(planSlugChangeRedirect(input({ oldPath: null, newPath: null })).create, null);
  });

  test('only internal single-slash paths are ever written', () => {
    assert.equal(planSlugChangeRedirect(input({ newPath: '//evil.example/x' })).create, null);
    assert.equal(planSlugChangeRedirect(input({ oldPath: 'about' })).create, null);
  });
});

describe('planSlugChangeRedirect — respecting other rules', () => {
  test("an admin's rule for the old address wins, even a disabled one", () => {
    const active = rule({ id: 5, source: '/about', target: '/team' });
    assert.equal(planSlugChangeRedirect(input({ rules: [active] })).create, null);
    const disabled = rule({ id: 5, source: '/about', target: '/team', active: false });
    assert.equal(planSlugChangeRedirect(input({ rules: [disabled] })).create, null);
  });

  test('an admin wildcard that already covers the old address wins', () => {
    const wildcard = rule({ id: 5, source: '/old/*', kind: 'wildcard', target: '/new' });
    assert.equal(planSlugChangeRedirect(input({ oldPath: '/old/about', rules: [wildcard] })).create, null);
  });

  test('never writes a rule that would close a loop', () => {
    const back = rule({ id: 5, source: '/about-us', target: '/about' });
    assert.equal(planSlugChangeRedirect(input({ rules: [back], isPublic: false })).create, null);
  });

  test('earlier automatic rules that pointed at the old address are moved on, so there are no chains', () => {
    const older = rule({ id: 3, source: '/who-we-are', target: '/about', documentId: DOC, reason: SLUG_CHANGE_REASON });
    const plan = planSlugChangeRedirect(input({ rules: [older] }));
    assert.deepEqual(plan.retarget, [3]);
    assert.deepEqual(plan.create, { source: '/about', target: '/about-us' });
  });

  test("another document's rules and admin rules are never retargeted", () => {
    const admin = rule({ id: 3, source: '/who', target: '/about' });
    const other = rule({ id: 4, source: '/was', target: '/about', documentId: 99, reason: SLUG_CHANGE_REASON });
    assert.deepEqual(planSlugChangeRedirect(input({ rules: [admin, other] })).retarget, []);
  });

  test('unpublish rules are not slug rules: never retargeted or removed here', () => {
    const unpublish = rule({ id: 6, source: '/about-us', target: '/blog', documentId: DOC, reason: 'unpublish' });
    const plan = planSlugChangeRedirect(input({ rules: [unpublish] }));
    assert.deepEqual(plan.remove, []);
    assert.deepEqual(plan.retarget, []);
  });
});

describe('planSlugChangeRedirect — never hiding a live page', () => {
  test('changing the slug back removes the rule that would now hide the page', () => {
    // /about → /about-us earlier; now renamed back to /about.
    const earlier = rule({ id: 3, source: '/about', target: '/about-us', documentId: DOC, reason: SLUG_CHANGE_REASON });
    const plan = planSlugChangeRedirect(input({ oldPath: '/about-us', newPath: '/about', rules: [earlier] }));
    assert.deepEqual(plan.remove, [3]);
    assert.deepEqual(plan.create, { source: '/about-us', target: '/about' });
  });

  test('a new live page at an address an automatic rule points away from takes the address back', () => {
    const leftover = rule({ id: 3, source: '/offers', target: '/deals', documentId: 42, reason: SLUG_CHANGE_REASON });
    const plan = planSlugChangeRedirect(
      input({ wasPublic: false, oldPath: null, newPath: '/offers', rules: [leftover] }),
    );
    assert.deepEqual(plan.remove, [3]);
    assert.equal(plan.create, null);
  });

  test('a draft at that address does not take it yet — old links keep working until it goes live', () => {
    const leftover = rule({ id: 3, source: '/offers', target: '/deals', documentId: 42, reason: SLUG_CHANGE_REASON });
    const plan = planSlugChangeRedirect(input({ wasPublic: false, isPublic: false, oldPath: null, newPath: '/offers', rules: [leftover] }));
    assert.deepEqual(plan.remove, []);
  });

  test("an admin's rule at the new address is left alone — that is the admin's call", () => {
    const admin = rule({ id: 3, source: '/about-us', target: '/elsewhere' });
    assert.deepEqual(planSlugChangeRedirect(input({ rules: [admin] })).remove, []);
  });
});

describe('wiring', () => {
  const service = readFileSync('src/cms/core/documents/service.ts', 'utf8');
  const unpublish = readFileSync('src/cms/core/seo/unpublish-redirect.ts', 'utf8');
  const schema = readFileSync('src/cms/db/adapters/mysql/schema/seo.ts', 'utf8');

  test("the Slug field's tip tells the editor old links keep working", () => {
    const form = readFileSync('src/cms/admin/DocumentForm.tsx', 'utf8');
    const tip = form.match(/description="(The last part of the web address[^"]*)"/)?.[1] ?? '';
    assert.match(tip, /redirect/i);
    assert.doesNotMatch(tip, /stop working unless/);
  });

  test('both create and update reconcile slug redirects inside their transaction', () => {
    const calls = service.match(/applySlugChangeRedirect\(/g) ?? [];
    assert.ok(calls.length >= 2, 'createDocument and updateDocument must both call applySlugChangeRedirect');
  });

  test('the unpublish reconciler only touches its own rules', () => {
    assert.match(unpublish, /UNPUBLISH_REASON/);
    assert.match(unpublish, /schema\.seoRedirects\.reason/);
  });

  test('seo_redirects records why the CMS wrote a rule, and a migration adds the column', () => {
    assert.match(schema, /reason: varchar\('reason'/);
    const migrations = readFileSync('src/cms/db/adapters/mysql/migrations/meta/_journal.json', 'utf8');
    const tags = [...migrations.matchAll(/"tag": "([^"]+)"/g)].map((m) => m[1]);
    const sql = tags.map((t) => readFileSync(`src/cms/db/adapters/mysql/migrations/${t}.sql`, 'utf8')).join('\n');
    assert.match(sql, /ALTER TABLE `seo_redirects` ADD `reason`/);
    assert.match(sql, /UPDATE `seo_redirects` SET `reason` = 'unpublish' WHERE `document_id` IS NOT NULL/);
  });
});
