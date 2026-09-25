import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

// The links are absolute; the origin is read when a link is built.
process.env.NEXT_PUBLIC_SITE_URL = 'https://example.com';

import { paymentLinkUrl, paymentReturnUrl } from '@/cms/modules/booking';

/**
 * The payment link is emailed to the customer and opened days later, so its
 * locale prefix has to be the one the site actually routes. Which locale is
 * unprefixed is the site's `defaultLocale` — Greek on a Greek-first site,
 * English on an English-first one.
 */

describe('paymentLinkUrl', () => {
  test('on a Greek-first site, Greek is unprefixed and English is prefixed', () => {
    assert.equal(paymentLinkUrl('R1', 'tok', 'el', 'el'), 'https://example.com/booking/pay/R1?t=tok');
    assert.equal(paymentLinkUrl('R1', 'tok', 'en', 'el'), 'https://example.com/en/booking/pay/R1?t=tok');
  });

  test('on an English-first site, English is unprefixed and Greek is prefixed', () => {
    assert.equal(paymentLinkUrl('R1', 'tok', 'en', 'en'), 'https://example.com/booking/pay/R1?t=tok');
    assert.equal(paymentLinkUrl('R1', 'tok', 'el', 'en'), 'https://example.com/el/booking/pay/R1?t=tok');
  });

  test('a reservation with no stored locale links in the site default', () => {
    assert.equal(paymentLinkUrl('R1', 'tok', null, 'en'), 'https://example.com/booking/pay/R1?t=tok');
  });
});

describe('paymentReturnUrl', () => {
  test('is the payment link plus the return marker, under the same prefix rule', () => {
    assert.equal(
      paymentReturnUrl('R1', 'tok', 'el', 'en'),
      'https://example.com/el/booking/pay/R1?t=tok&return=1',
    );
  });
});
