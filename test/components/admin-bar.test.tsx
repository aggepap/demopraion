import '../setup/react-global';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { AdminBarProvider, AdminBarView } from '@/components/admin-bar/AdminBar';
import { adminBarFor, adminEditHref, exitPreviewHref } from '@/lib/admin-bar';

const user = (permissions: string[], locale = 'el') => ({
  userId: 1,
  email: 'a@example.com',
  name: 'Άγγελος',
  permissions,
  locale,
});

const off = { preview: false, siteLocale: 'el' };
const on = { preview: true, siteLocale: 'el' };

/** The markup of the `<a>` whose href is `href`, or null. */
function link(html: string, href: string): string | null {
  const escaped = href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/&/g, '&amp;');
  return html.match(new RegExp(`<a[^>]*href="${escaped}"[^>]*>((?:(?!</a>).)*)</a>`))?.[1] ?? null;
}

describe('adminBarFor', () => {
  test('shows nothing to a visitor who is not signed in', () => {
    assert.equal(adminBarFor(null, 'admin', off), null);
  });

  test('shows nothing to a signed-in user without admin access', () => {
    assert.equal(adminBarFor(user(['cms.content.read']), 'admin', off), null);
  });

  test('gives an admin a link to the admin home under the configured admin path', () => {
    assert.equal(adminBarFor(user(['cms.access']), 'admin', off)?.admin?.href, '/admin');
    assert.equal(adminBarFor(user(['cms.access']), 'backoffice', off)?.admin?.href, '/backoffice');
  });

  test('allows editing only with the permission the edit screen requires', () => {
    assert.equal(adminBarFor(user(['cms.access']), 'admin', off)?.admin?.canEdit, false);
    assert.equal(
      adminBarFor(user(['cms.access', 'cms.content.read']), 'admin', off)?.admin?.canEdit,
      true,
    );
    assert.equal(adminBarFor(user(['*']), 'admin', off)?.admin?.canEdit, true);
  });

  test("labels follow the admin's own locale, falling back to Greek", () => {
    assert.equal(adminBarFor(user(['*'], 'en'), 'admin', off)?.locale, 'en');
    assert.equal(adminBarFor(user(['*'], 'el'), 'admin', off)?.locale, 'el');
    assert.equal(adminBarFor(user(['*'], 'de'), 'admin', off)?.locale, 'el');
  });

  test('reports preview mode to an admin', () => {
    assert.equal(adminBarFor(user(['*']), 'admin', off)?.preview, false);
    assert.equal(adminBarFor(user(['*']), 'admin', on)?.preview, true);
  });

  test('still offers a way out of preview to someone no longer signed in as admin', () => {
    for (const who of [null, user(['cms.content.read'])]) {
      const bar = adminBarFor(who, 'admin', { preview: true, siteLocale: 'en' });
      assert.ok(bar);
      assert.equal(bar.preview, true);
      assert.equal(bar.admin, null, 'no admin link, name or path for a non-admin');
      assert.equal(bar.locale, 'en', 'labels follow the page they are reading');
    }
  });
});

describe('adminEditHref', () => {
  test("points at the document's admin edit screen with its language tab", () => {
    assert.equal(
      adminEditHref('admin', { type: 'article', id: 12, locale: 'en' }),
      '/admin/article/12?locale=en',
    );
    assert.equal(
      adminEditHref('backoffice', { type: 'booking', id: 7, locale: 'el' }),
      '/backoffice/booking/7?locale=el',
    );
  });
});

describe('exitPreviewHref', () => {
  test('turns preview off and comes back to the same page', () => {
    assert.equal(
      exitPreviewHref('/en/insights/some-post'),
      '/api/cms/preview/disable?redirect=%2Fen%2Finsights%2Fsome-post',
    );
  });

  test('returns home when the current path is unknown', () => {
    assert.equal(exitPreviewHref(null), '/api/cms/preview/disable?redirect=%2F');
  });
});

describe('AdminBarView', () => {
  const bar = adminBarFor(user(['*']), 'admin', off);
  const previewBar = adminBarFor(user(['*']), 'admin', on);
  assert.ok(bar && previewBar);

  test('renders a labelled toolbar with a link back to the admin', () => {
    const html = renderToStaticMarkup(<AdminBarView bar={bar} editHref={null} path="/" />);
    assert.match(html, /<nav[^>]*aria-label="[^"]+"/);
    assert.match(link(html, '/admin') ?? '', /Διαχείριση/);
    assert.match(html, /Άγγελος/);
  });

  test('has no Edit link on a page that is not a CMS document', () => {
    const html = renderToStaticMarkup(<AdminBarView bar={bar} editHref={null} path="/" />);
    assert.doesNotMatch(html, /Επεξεργασία/);
  });

  test('links Edit to the current document when one is registered', () => {
    const html = renderToStaticMarkup(
      <AdminBarView bar={bar} editHref="/admin/article/12?locale=el" path="/" />,
    );
    assert.match(link(html, '/admin/article/12?locale=el') ?? '', /Επεξεργασία/);
  });

  test('uses English labels for an English-speaking admin', () => {
    const en = adminBarFor(user(['*'], 'en'), 'admin', on);
    assert.ok(en);
    const html = renderToStaticMarkup(
      <AdminBarView bar={en} editHref="/admin/page/3?locale=el" path="/en" />,
    );
    assert.match(link(html, '/admin') ?? '', /Admin/);
    assert.match(link(html, '/admin/page/3?locale=el') ?? '', /Edit/);
    assert.match(html, /Preview/);
    assert.match(link(html, exitPreviewHref('/en')) ?? '', /Exit preview/);
  });

  test('shows no preview controls outside preview mode', () => {
    const html = renderToStaticMarkup(<AdminBarView bar={bar} editHref={null} path="/insights" />);
    assert.doesNotMatch(html, /preview\/disable/);
    assert.doesNotMatch(html, /Προεπισκόπηση/);
  });

  test('in preview mode, marks it and links out of it back to this page', () => {
    const html = renderToStaticMarkup(
      <AdminBarView bar={previewBar} editHref={null} path="/insights/draft-post" />,
    );
    assert.match(html, /Προεπισκόπηση/);
    assert.match(link(html, exitPreviewHref('/insights/draft-post')) ?? '', /Έξοδος/);
  });

  test('a preview-only bar carries no admin link or user name', () => {
    const previewOnly = adminBarFor(null, 'backoffice', on);
    assert.ok(previewOnly);
    const html = renderToStaticMarkup(
      <AdminBarView bar={previewOnly} editHref="/backoffice/page/1?locale=el" path="/x" />,
    );
    assert.doesNotMatch(html, /backoffice/);
    assert.doesNotMatch(html, /Άγγελος/);
    assert.match(link(html, exitPreviewHref('/x')) ?? '', /Έξοδος/);
  });
});

describe('AdminBarProvider', () => {
  test('renders only the page for a visitor', () => {
    const html = renderToStaticMarkup(
      <AdminBarProvider bar={null}>
        <p>page</p>
      </AdminBarProvider>,
    );
    assert.equal(html, '<p>page</p>');
  });

  test('renders the bar above the page for an admin', () => {
    const html = renderToStaticMarkup(
      <AdminBarProvider bar={adminBarFor(user(['*']), 'admin', off)}>
        <p>page</p>
      </AdminBarProvider>,
    );
    assert.ok(html.indexOf('<nav') >= 0 && html.indexOf('<nav') < html.indexOf('<p>page</p>'));
  });
});
