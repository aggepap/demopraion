import '../setup/react-global';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { SubscribersTable } from '@/cms/admin/SubscribersTable';

/**
 * `<thead>` takes rows, not cells.
 *
 * The admin's `Thead` renders the `<thead>` element and nothing else — the
 * `<tr>` is the caller's to supply. `SubscribersTable` was written from an
 * existing table that omits it, so its header cells sat directly inside the
 * `<thead>`: invalid HTML, which React's server renderer emits happily and the
 * browser's parser then rearranges, so the client tree no longer matches the
 * server one and the whole subtree is thrown away and re-rendered.
 *
 * The failure is loud in development and silent in production, which is exactly
 * the kind that survives review — hence an assertion on the markup rather than
 * a note to be careful.
 */
const row = {
  id: 1,
  email: 'someone@example.com',
  locale: 'el',
  status: 'active' as const,
  source: 'footer',
  consentText: 'Newsletter signup (footer)',
  subscribedAt: '2026-08-28T13:40:18.000Z',
  unsubscribedAt: null,
};

const render = (canWrite: boolean) =>
  renderToStaticMarkup(
    <SubscribersTable
      initial={[row]}
      initialPageInfo={{ total: 1, pageSize: 25, pageCount: 1 }}
      counts={{ all: 1, active: 1, unsubscribed: 0 }}
      canWrite={canWrite}
    />,
  );

describe('subscribers table markup', () => {
  test('puts a row between the thead and its cells', () => {
    const html = render(true);
    assert.match(html, /<thead[^>]*>\s*<tr>/, '<th> is sitting directly inside <thead>');
    assert.doesNotMatch(html, /<thead[^>]*>\s*<th/, '<th> is sitting directly inside <thead>');
  });

  test('renders the subscriber', () => {
    // Guards the assertion above: a table that rendered nothing would pass it.
    const html = render(true);
    assert.match(html, /someone@example\.com/);
    assert.match(html, /mailto:someone@example\.com/);
  });

  test('offers unsubscribe and delete only to a writer', () => {
    // The server enforces this too — `newsletterWrite` guards the route.
    //
    // Anchored on the element text, not a bare substring: the "Unsubscribed"
    // filter tab is always on the page and contains "Unsubscribe", so a loose
    // match passes whatever the buttons do.
    assert.match(render(true), />Unsubscribe</);
    assert.match(render(true), /aria-label="Delete someone@example\.com"/);
    assert.doesNotMatch(render(false), />Unsubscribe</);
    assert.doesNotMatch(render(false), /aria-label="Delete /);
    assert.match(render(false), /Read-only/);
  });
});
