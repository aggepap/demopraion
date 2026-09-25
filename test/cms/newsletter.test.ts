/**
 * The newsletter module's decisions, separate from its database calls.
 *
 * `newsletter` has been a declared module flag with a working toggle and a
 * `newsletter_subscribers` table since the schema was ported, and nothing
 * behind either: `subscribeToNewsletter` in `src/lib/newsletter.ts` resolved
 * after a timeout, so the footer band and every article sidebar card told a
 * visitor they were subscribed and dropped the address.
 *
 * What is worth pinning is what cannot be re-derived from a row afterwards:
 * the normalisation that decides whether two signups are one person, the
 * consent record (a NOT NULL column, and the thing an unsubscribe complaint
 * turns on), and which columns are allowed onto a screen.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  consentTextFor,
  newsletterSubscribeBody,
  subscriberPage,
  subscriberView,
} from '@/cms/modules/newsletter/logic';

const parse = (body: unknown) => newsletterSubscribeBody.safeParse(body);

describe('newsletterSubscribeBody', () => {
  test('accepts the shape the footer band and the sidebar card send', () => {
    const res = parse({ email: 'a@b.gr', locale: 'el', source: 'footer' });
    assert.equal(res.success, true);
  });

  test('needs a real address, since the address is the entire record', () => {
    for (const email of ['', 'not-an-email', 'a@b', '@b.gr', 'a b@c.gr']) {
      assert.equal(parse({ email }).success, false, email);
    }
  });

  test('accepts a filled honeypot rather than rejecting it', () => {
    // The route drops these silently and answers 200. A 422 would tell a bot
    // which field caught it, which is the one thing a honeypot must not do.
    assert.equal(parse({ email: 'a@b.gr', _hp: 'bot' }).success, true);
  });

  test('works with nothing but an address', () => {
    // The sidebar card passes a source; a future caller might not.
    assert.equal(parse({ email: 'a@b.gr' }).success, true);
  });

  test('rejects a source or locale too long for its column', () => {
    // `source_page_slug` is varchar(191) and `locale` varchar(8). Rejecting
    // here beats a driver error after the visitor has been thanked.
    assert.equal(parse({ email: 'a@b.gr', source: 'x'.repeat(192) }).success, false);
    assert.equal(parse({ email: 'a@b.gr', locale: 'x'.repeat(9) }).success, false);
    assert.equal(parse({ email: 'a@b.gr', source: 'x'.repeat(191) }).success, true);
  });

  test('normalises the address, so one person is one subscriber', () => {
    // `email` is UNIQUE. Without this, `A@B.gr` and `a@b.gr` are two rows and
    // an unsubscribe only silences one of them.
    const a = parse({ email: '  A@Example.COM ' });
    const b = parse({ email: 'a@example.com' });
    assert.equal(a.success && a.data.email, 'a@example.com');
    assert.equal(b.success && b.data.email, 'a@example.com');
  });
});

describe('consentTextFor', () => {
  test('records something, because the column will not take nothing', () => {
    // `consent_text` is NOT NULL: an empty string is a row that claims consent
    // was recorded while recording none.
    assert.ok(consentTextFor('footer').length > 0);
    assert.ok(consentTextFor(null).length > 0);
  });

  test('names where consent was given', () => {
    // Six months on, "they signed up" is not an answer to a complaint; "they
    // signed up from the footer band" is the start of one.
    assert.match(consentTextFor('footer'), /footer/);
    assert.match(consentTextFor('article:seo-basics'), /article:seo-basics/);
  });

  test('fits the column even when the source does not', () => {
    assert.ok(consentTextFor('x'.repeat(400)).length <= 255);
  });
});

describe('subscriberView', () => {
  const row = {
    id: 7,
    email: 'a@b.gr',
    locale: 'el',
    consentText: 'Newsletter signup (footer)',
    consentGivenAt: new Date('2026-08-01T10:00:00Z'),
    doubleOptInAt: null,
    unsubscribedAt: null,
    sourcePageSlug: 'footer',
    mailchimpId: null,
    mailchimpStatus: null,
    lastSyncedAt: null,
    ipHash: 'deadbeef',
    ua: 'Mozilla/5.0',
    createdAt: new Date('2026-08-01T10:00:00Z'),
    updatedAt: new Date('2026-08-01T10:00:00Z'),
  };

  test('derives the status a person reads off the screen', () => {
    assert.equal(subscriberView(row).status, 'active');
    assert.equal(
      subscriberView({ ...row, unsubscribedAt: new Date('2026-08-02T10:00:00Z') }).status,
      'unsubscribed',
    );
  });

  test('does not put the abuse-triage columns on a browsable screen', () => {
    // `ip_hash` and `ua` exist to investigate a flood of fake signups. They are
    // not part of managing a mailing list, and a list screen is the wrong place
    // to hand them to every role that can read it.
    const keys = Object.keys(subscriberView(row));
    assert.equal(keys.includes('ipHash'), false);
    assert.equal(keys.includes('ua'), false);
  });

  test('keeps what the screen is for', () => {
    const view = subscriberView(row);
    assert.equal(view.id, 7);
    assert.equal(view.email, 'a@b.gr');
    assert.equal(view.locale, 'el');
    assert.equal(view.source, 'footer');
    assert.equal(view.consentText, 'Newsletter signup (footer)');
  });

  test('sends dates as ISO strings, since this crosses the wire', () => {
    const view = subscriberView(row);
    assert.equal(view.subscribedAt, '2026-08-01T10:00:00.000Z');
    assert.equal(view.unsubscribedAt, null);
    assert.equal(
      subscriberView({ ...row, unsubscribedAt: new Date('2026-08-02T10:00:00Z') }).unsubscribedAt,
      '2026-08-02T10:00:00.000Z',
    );
  });
});

describe('subscriberPage', () => {
  test('defaults to a page that exists', () => {
    assert.deepEqual(subscriberPage({}), { page: 1, pageSize: 25 });
  });

  test('refuses a page before the first one', () => {
    assert.equal(subscriberPage({ page: 0 }).page, 1);
    assert.equal(subscriberPage({ page: -5 }).page, 1);
  });

  test('caps the page size, so one request cannot ask for the whole list', () => {
    assert.equal(subscriberPage({ pageSize: 5000 }).pageSize, 100);
    assert.equal(subscriberPage({ pageSize: 0 }).pageSize, 1);
    assert.equal(subscriberPage({ pageSize: 50 }).pageSize, 50);
  });
});
