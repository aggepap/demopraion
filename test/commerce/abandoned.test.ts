import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

// Both set before the import: the reminder body builds absolute links, and the
// unsubscribe link is signed.
process.env.NEXT_PUBLIC_SITE_URL = 'https://praion.gr';
process.env.ADMIN_SESSION_SECRET = 'test-secret-that-is-at-least-32-chars-long';

import { unsubscribeSignatureMatches } from '@/cms/core/email/unsubscribe';
import { cartSubtotalMinor, recoverUrl, reminderBudget, reminderHtml, safeImageUrl } from '@/cms/modules/commerce';

/**
 * Path + query of an absolute link. The host is whatever `NEXT_PUBLIC_SITE_URL`
 * was when the module loaded — imports are hoisted above the assignment above,
 * so a site that sets the variable in its environment wins — and it is not what
 * these tests are about.
 */
const pathOf = (url: string): string => {
  const u = new URL(url);
  return `${u.pathname}${u.search}`;
};

describe('cartSubtotalMinor', () => {
  test('sums unitPrice × quantity in minor units', () => {
    assert.equal(
      cartSubtotalMinor([
        { slug: 'a', title: 'A', unitPrice: 49.99, quantity: 2 },
        { slug: 'b', title: 'B', unitPrice: 5, quantity: 1 },
      ]),
      49.99 * 100 * 2 + 500, // 9998 + 500
    );
  });
  test('rounds each unit price to cents before multiplying', () => {
    assert.equal(cartSubtotalMinor([{ slug: 'a', title: 'A', unitPrice: 0.1, quantity: 3 }]), 30);
  });
  test('treats a fractional/zero quantity as at least 1', () => {
    assert.equal(cartSubtotalMinor([{ slug: 'a', title: 'A', unitPrice: 10, quantity: 0 }]), 1000);
  });
  test('empty cart is zero', () => {
    assert.equal(cartSubtotalMinor([]), 0);
  });
});

describe('recoverUrl', () => {
  test('on a Greek-first site el is unprefixed, en is prefixed; token is encoded', () => {
    assert.equal(pathOf(recoverUrl('abc def', 'el', 'el')), '/cart/recover?token=abc%20def');
    assert.equal(pathOf(recoverUrl('t', 'en', 'el')), '/en/cart/recover?token=t');
  });

  test('on an English-first site en is unprefixed and el is prefixed', () => {
    assert.equal(pathOf(recoverUrl('t', 'en', 'en')), '/cart/recover?token=t');
    assert.equal(pathOf(recoverUrl('t', 'el', 'en')), '/el/cart/recover?token=t');
  });
});

/**
 * The daily reminder ceiling. Cart capture is public and accepts any address at
 * 20/min/IP, so without a cap a scripted flood turns this site into a bulk mailer
 * to strangers — and the reputation damage lands on the transactional mail sharing
 * the same Graph tenant, not on the reminders.
 */
describe('reminderBudget', () => {
  test('is the whole allowance when nothing has gone out', () => {
    assert.equal(reminderBudget(0, 200), 200);
  });

  test('is what remains of the allowance', () => {
    assert.equal(reminderBudget(150, 200), 50);
  });

  test('is zero at the ceiling', () => {
    assert.equal(reminderBudget(200, 200), 0);
  });

  test('never goes negative, so an overshoot cannot re-open the gate', () => {
    // `slice(0, -1)` on a negative budget would send all but one — the opposite of
    // the intent — so this clamp is doing real work.
    assert.equal(reminderBudget(250, 200), 0);
  });

  test('a ceiling of zero stops sending entirely', () => {
    assert.equal(reminderBudget(0, 0), 0);
  });
});

/**
 * The reminder is the site's only unsolicited mail, and it went out with no way
 * to opt out — a consent problem, and a deliverability one, since complaints
 * earned here are charged against the transactional mail sharing the mailbox.
 * These assert that the opt-out is actually in the message.
 */
describe('reminderHtml', () => {
  const cart = (overrides: Record<string, unknown> = {}) =>
    ({
      id: 1,
      token: 'tok-123',
      email: 'shopper@example.com',
      items: [{ slug: 'a', title: 'Wide Brim Hat', unitPrice: 25, quantity: 2 }],
      currency: 'EUR',
      locale: 'en',
      subtotal: 5000,
      status: 'pending',
      reminderSentAt: null,
      recoveredAt: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      ...overrides,
    }) as never;

  /** Every href in the body, unescaped. */
  const hrefs = (html: string): string[] =>
    [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));

  /** The path + query of the body's recovery link. */
  const recoveryPath = (html: string): string | undefined =>
    hrefs(html)
      .filter((h) => h.includes('/cart/recover'))
      .map(pathOf)[0];

  test('carries an unsubscribe link signed for the recipient', () => {
    const link = hrefs(reminderHtml(cart(), 'el')).find((h) => h.includes('/unsubscribe'));
    assert.ok(link, 'no unsubscribe link in the reminder');
    const url = new URL(link);
    assert.equal(url.searchParams.get('e'), 'shopper@example.com');
    // Signed for THIS recipient — a link that verified for any address would let
    // anyone suppress anyone.
    assert.equal(
      unsubscribeSignatureMatches('shopper@example.com', url.searchParams.get('s')),
      true,
    );
  });

  test('the unsubscribe link is present in both locales', () => {
    for (const locale of ['el', 'en']) {
      const html = reminderHtml(cart({ locale }), 'el');
      assert.ok(
        hrefs(html).some((h) => h.includes('/unsubscribe')),
        `no unsubscribe link for locale ${locale}`,
      );
    }
  });

  test('still carries the recovery link', () => {
    // The opt-out must not have displaced what the email is for.
    assert.ok(hrefs(reminderHtml(cart(), 'el')).some((h) => h.includes('/cart/recover?token=tok-123')));
  });

  test('a cart with no stored locale is written in the site default, and links unprefixed', () => {
    // Greek-first site: Greek copy, `/cart/recover` with no prefix.
    const onGreekSite = reminderHtml(cart({ locale: null }), 'el');
    assert.ok(onGreekSite.includes('Επιστροφή στο καλάθι'), 'expected the Greek reminder');
    assert.equal(recoveryPath(onGreekSite), '/cart/recover?token=tok-123');

    // English-first site: English copy, still unprefixed — English IS the default.
    const onEnglishSite = reminderHtml(cart({ locale: null }), 'en');
    assert.ok(onEnglishSite.includes('Return to your cart'), 'expected the English reminder');
    assert.equal(recoveryPath(onEnglishSite), '/cart/recover?token=tok-123');
  });

  test('a Greek cart on an English-first site links under /el', () => {
    const html = reminderHtml(cart({ locale: 'el' }), 'en');
    assert.ok(html.includes('Επιστροφή στο καλάθι'));
    assert.equal(recoveryPath(html), '/el/cart/recover?token=tok-123');
  });

  test('escapes item titles rather than emitting them as markup', () => {
    // `catalogItems` replaces titles from the catalogue, so this is defence in
    // depth — but the body is HTML assembled by hand and a product name is
    // editor-authored.
    const html = reminderHtml(
      cart({ items: [{ slug: 'a', title: '<script>alert(1)</script>', unitPrice: 1, quantity: 1 }] }),
      'el',
    );
    assert.ok(!html.includes('<script>'), 'unescaped title reached the body');
    assert.ok(html.includes('&lt;script&gt;'));
  });
});

/**
 * Capture is public and unauthenticated, and this value ends up in an `<img src>`
 * on a recovering shopper's page — so an absolute URL here is a way to make a
 * stranger's browser call out to a host of the attacker's choosing.
 */
describe('safeImageUrl', () => {
  test('keeps a site-relative media path', () => {
    assert.equal(safeImageUrl('/api/cms/media/file/abc'), '/api/cms/media/file/abc');
  });

  test('rejects an absolute URL', () => {
    assert.equal(safeImageUrl('https://evil.example/track.gif'), undefined);
  });

  test('rejects a protocol-relative URL, which also starts with a slash', () => {
    assert.equal(safeImageUrl('//evil.example/track.gif'), undefined);
  });

  test('rejects non-strings and blanks', () => {
    assert.equal(safeImageUrl(undefined), undefined);
    assert.equal(safeImageUrl(42), undefined);
    assert.equal(safeImageUrl(''), undefined);
  });

  test('trims before deciding', () => {
    assert.equal(safeImageUrl('  /media/x.png  '), '/media/x.png');
    assert.equal(safeImageUrl('  https://evil.example  '), undefined);
  });
});
