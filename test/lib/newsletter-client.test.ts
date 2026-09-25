/**
 * What the browser side of a newsletter signup hands back to the form.
 *
 * `subscribeToNewsletter` was a stub that resolved, then a fetch that resolved;
 * it now has to report WHICH of three things happened, because the forms show a
 * different message for one of them. That makes its return value a contract
 * rather than an implementation detail, and the failure mode if it drifts is a
 * form telling somebody they are already subscribed when they are not.
 *
 * `fetch` is stubbed on the global rather than mocked through the module
 * system: this runner has no module mocking, and the function's whole job is
 * the shape of one request and one response.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import { subscribeToNewsletter } from '@/lib/newsletter';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Stub `fetch` and capture what was sent. */
function stub(response: Response) {
  const calls: { url: string; body: unknown }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? 'null')) });
    return response;
  }) as typeof fetch;
  return calls;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('subscribeToNewsletter', () => {
  test('sends the address, the placement and the language', () => {
    const calls = stub(json({ ok: true, data: { status: 'subscribed' } }));
    return subscribeToNewsletter('a@b.gr', 'footer', 'en').then(() => {
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, '/api/newsletter');
      assert.deepEqual(calls[0].body, { email: 'a@b.gr', source: 'footer', locale: 'en' });
    });
  });

  test('reports a first-time signup', async () => {
    stub(json({ ok: true, data: { status: 'subscribed' } }));
    assert.equal(await subscribeToNewsletter('a@b.gr', 'footer'), 'subscribed');
  });

  test('reports an address that was already on the list', async () => {
    // The one outcome the forms show a different message for.
    stub(json({ ok: true, data: { status: 'already-subscribed' } }));
    assert.equal(await subscribeToNewsletter('a@b.gr', 'footer'), 'already-subscribed');
  });

  test('reports a return after unsubscribing as its own outcome', async () => {
    stub(json({ ok: true, data: { status: 'resubscribed' } }));
    assert.equal(await subscribeToNewsletter('a@b.gr', 'footer'), 'resubscribed');
  });

  test('still throws when the request fails', async () => {
    // The module being off answers 404 here, and both forms have an error
    // branch waiting for it.
    stub(json({ ok: false, error: 'not_found' }, 404));
    await assert.rejects(() => subscribeToNewsletter('a@b.gr', 'footer'));
  });

  test('treats an unreadable success as a plain signup rather than throwing', async () => {
    // A 200 that this cannot parse still means the address went in. Throwing
    // would show an error for a signup that worked, which is the worse of the
    // two wrong answers.
    stub(new Response('not json', { status: 200 }));
    assert.equal(await subscribeToNewsletter('a@b.gr', 'footer'), 'subscribed');
  });

  test('treats an unrecognised status as a plain signup', async () => {
    stub(json({ ok: true, data: { status: 'something-new' } }));
    assert.equal(await subscribeToNewsletter('a@b.gr', 'footer'), 'subscribed');
  });
});
