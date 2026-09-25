import '../setup/react-global';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { PathnameContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

import { Sidebar } from '@/cms/admin/Sidebar';
import type { CollectionSummary } from '@/cms/admin/shared';

function render(pathname: string, adminPath = 'admin', collections: CollectionSummary[] = []) {
  return renderToStaticMarkup(
    <PathnameContext.Provider value={pathname}>
      <Sidebar siteName="Praion" collections={collections} locale="el" adminPath={adminPath} />
    </PathnameContext.Provider>,
  );
}

/** The `<a>` element whose visible text includes `text`. */
function anchor(html: string, text: string): string | undefined {
  return html.match(/<a\b[^>]*>(?:(?!<\/a>).)*<\/a>/g)?.find((a) => a.includes(text));
}

describe('admin sidebar: back to site', () => {
  test('links back to the public site', () => {
    const link = anchor(render('/admin'), 'Back to site');
    assert.ok(link, 'no "Back to site" link');
    assert.match(link, /href="\/"/);
  });

  test('sits at the top, under the site name and above the Dashboard', () => {
    const html = render('/admin');
    const back = html.indexOf('Back to site');
    assert.ok(html.indexOf('Praion') < back);
    assert.ok(back < html.indexOf('Dashboard'));
  });

  test('is never marked as the current page', () => {
    for (const path of ['/admin', '/admin/article', '/']) {
      const link = anchor(render(path), 'Back to site');
      assert.ok(link);
      assert.doesNotMatch(link, /text-warm-gold font-medium|aria-current/);
    }
  });
});

/**
 * `ADMIN_PATH` moves the admin, and the sidebar used to hard-code `/admin` for
 * the Dashboard and every collection — every one of them a dead link once the
 * segment had changed.
 */
describe('admin sidebar: follows ADMIN_PATH', () => {
  const article: CollectionSummary = { key: 'article', label: 'Article', labelPlural: 'Articles', singleton: false, hidden: false };

  test('Dashboard and collection links use the configured segment', () => {
    const html = render('/back-office/article/3', 'back-office', [article]);
    assert.match(anchor(html, 'Dashboard') ?? '', /href="\/back-office"/);
    const articles = anchor(html, 'Articles') ?? '';
    assert.match(articles, /href="\/back-office\/article"/);
    // …and is marked current from the URL the browser actually shows.
    assert.match(articles, /text-warm-gold font-medium/);
    assert.doesNotMatch(html, /href="\/admin/);
  });
});
