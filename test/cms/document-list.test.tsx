import '../setup/react-global';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext, type AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';

import { DocumentList, type DocumentListItem } from '@/cms/admin/DocumentList';
import { canDeleteDocumentGroup, parseDocumentListQuery } from '@/cms/admin/document-list-query';
import { resolveCollection } from '@/cms/config/collection';

const collection = resolveCollection({ key: 'article', label: 'Article', fields: [] });

function withRouter(children: ReactNode, search = '') {
  const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} } as unknown as AppRouterInstance;
  return createElement(
    AppRouterContext.Provider,
    { value: router },
    createElement(
      PathnameContext.Provider,
      { value: '/admin/article' },
      createElement(SearchParamsContext.Provider, { value: new URLSearchParams(search) }, children),
    ),
  );
}

const item = (status: string, id = 1): DocumentListItem => ({
  id,
  slug: `doc-${id}`,
  title: `Doc ${id}`,
  metaTitle: null,
  updatedAt: '2026-01-01T00:00:00.000Z',
  variants: [{ id, locale: 'el', status }],
});

function render(
  items: DocumentListItem[],
  opts: { adminPath?: string; canWrite?: boolean; canPublish?: boolean; search?: string } = {},
) {
  return renderToStaticMarkup(
    withRouter(
      <DocumentList
        collection={collection}
        locales={['el']}
        initialItems={items}
        total={items.length}
        pageSize={25}
        adminPath={opts.adminPath ?? 'admin'}
        canWrite={opts.canWrite ?? true}
        canPublish={opts.canPublish ?? true}
      />,
      opts.search,
    ),
  );
}

const deleteButtons = (html: string) => (html.match(/>Delete<\/button>/g) ?? []).length;

/**
 * Reloading `?status=draft` used to show every document, unfiltered page 1,
 * with "draft" selected above them: the server page ignored the query and the
 * client skipped its first fetch trusting the server. Both now read the URL
 * through `parseDocumentListQuery`.
 */
describe('document list: the URL is the filter', () => {
  test('reads page, status and search from URLSearchParams and from a Next searchParams record', () => {
    const expected = { page: 3, status: 'draft', search: 'hello' };
    assert.deepEqual(parseDocumentListQuery(new URLSearchParams('page=3&status=draft&q=%20hello%20')), expected);
    assert.deepEqual(parseDocumentListQuery({ page: '3', status: 'draft', q: ' hello ' }), expected);
    assert.deepEqual(parseDocumentListQuery({ page: ['3', '4'], status: 'draft', q: 'hello' }), expected);
  });

  test('anything unreadable falls back to the unfiltered first page', () => {
    for (const qs of ['', 'page=0', 'page=-2', 'page=abc', 'page=1.5', 'status=bogus']) {
      const q = parseDocumentListQuery(new URLSearchParams(qs));
      assert.equal(q.page, 1, qs);
      assert.equal(q.status, '', qs);
    }
    assert.equal(parseDocumentListQuery({ q: 'x'.repeat(500) }).search.length, 200);
  });

  test('the controls start from the same query the server rendered', () => {
    const html = render([item('draft')], { search: 'status=draft&q=hello&page=2' });
    assert.match(html, /<option value="draft" selected="">/);
    assert.match(html, /value="hello"/);
    assert.match(html, /Page 2 of/);
  });
});

/**
 * Delete was offered to everyone who could read the list. The DELETE route
 * wants `cms.content.write`, plus publishing rights once a language is live —
 * and the list deletes every language, so a refused live one left the group
 * half deleted.
 */
describe('document list: Delete only for those allowed to delete', () => {
  test('the rule mirrors the DELETE route', () => {
    const draft = [{ status: 'draft' }];
    const live = [{ status: 'draft' }, { status: 'published' }];
    assert.equal(canDeleteDocumentGroup(draft, { canWrite: false, canPublish: false }), false);
    assert.equal(canDeleteDocumentGroup(draft, { canWrite: false, canPublish: true }), false);
    assert.equal(canDeleteDocumentGroup(draft, { canWrite: true, canPublish: false }), true);
    assert.equal(canDeleteDocumentGroup(live, { canWrite: true, canPublish: false }), false);
    assert.equal(canDeleteDocumentGroup([{ status: 'scheduled' }], { canWrite: true, canPublish: false }), false);
    assert.equal(canDeleteDocumentGroup(live, { canWrite: true, canPublish: true }), true);
  });

  test('a reader sees no Delete at all', () => {
    assert.equal(deleteButtons(render([item('draft', 1), item('archived', 2)], { canWrite: false, canPublish: false })), 0);
  });

  test('a writer without publishing rights can delete drafts but not live documents', () => {
    const html = render([item('draft', 1), item('published', 2)], { canWrite: true, canPublish: false });
    assert.equal(deleteButtons(html), 1);
  });

  test('an editor with both sees Delete on every row', () => {
    assert.equal(deleteButtons(render([item('draft', 1), item('published', 2)])), 2);
  });
});

describe('document list: links follow ADMIN_PATH', () => {
  test('rows link under the configured segment', () => {
    const html = render([item('draft', 7)], { adminPath: 'back-office' });
    assert.match(html, /href="\/back-office\/article\/7"/);
    assert.doesNotMatch(html, /href="\/admin\//);
  });
});
