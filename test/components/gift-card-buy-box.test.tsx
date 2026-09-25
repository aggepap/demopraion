import '../setup/react-global';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';

import { CartProvider, cartLineKey, checkoutLine } from '@/components/shop/cart/CartProvider';
import { GiftCardBuyBox } from '@/components/shop/GiftCardBuyBox';

import en from '../../messages/en.json';

/**
 * Buying a gift card on the product page: choose the amount, say who it is for,
 * and — optionally — when it should arrive.
 */

const offer = { enabled: true, presets: [2500, 5000], allowCustom: true, minAmount: 1000, maxAmount: 20000 };

const render = (o: typeof offer) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <CartProvider currency="EUR">
        <GiftCardBuyBox slug="gift-card" title="Gift card" currency="EUR" locale="en" offer={o} />
      </CartProvider>
    </NextIntlClientProvider>,
  );

describe('GiftCardBuyBox', () => {
  test('offers the preset amounts and a custom one within the limits', () => {
    const html = render(offer);
    assert.match(html, /€25\.00/);
    assert.match(html, /€50\.00/);
    assert.match(html, new RegExp(en.shop.giftCard.customAmount));
    assert.match(html, /min="10"/);
    assert.match(html, /max="200"/);
  });

  test('without custom amounts, only the presets are offered', () => {
    assert.doesNotMatch(render({ ...offer, allowCustom: false }), new RegExp(en.shop.giftCard.customAmount));
  });

  test('asks who it is for, a message and a send date', () => {
    const html = render(offer);
    assert.match(html, new RegExp(en.shop.giftCard.recipientName));
    assert.match(html, new RegExp(en.shop.giftCard.recipientEmail));
    assert.match(html, /type="email"[^>]*required|required[^>]*type="email"/);
    assert.match(html, new RegExp(en.shop.giftCard.message));
    assert.match(html, /type="date"/);
    assert.match(html, new RegExp(en.cart.addToCart));
  });

  test('says so when gift cards are switched off, with nothing to buy', () => {
    const html = render({ ...offer, enabled: false });
    assert.match(html, new RegExp(en.shop.giftCard.unavailable));
    assert.doesNotMatch(html, new RegExp(en.cart.addToCart));
  });
});

describe('gift card cart lines', () => {
  const gift = { amount: 2500, recipientName: 'Maria', recipientEmail: 'm@example.com', message: '', sendAt: '' };

  test('two cards for two people are two lines, not one line of two', () => {
    const a = cartLineKey('gift-card', undefined, gift);
    const b = cartLineKey('gift-card', undefined, { ...gift, recipientEmail: 'n@example.com' });
    assert.notEqual(a, b);
    assert.equal(cartLineKey('shirt', 'red'), 'shirt::red');
  });

  test('the checkout line carries the gift card details', () => {
    assert.deepEqual(
      checkoutLine({ slug: 'gift-card', quantity: 1, giftCard: gift }),
      { slug: 'gift-card', variationId: undefined, quantity: 1, giftCard: { amount: 2500, recipientName: 'Maria', recipientEmail: 'm@example.com', message: undefined, sendAt: undefined } },
    );
    assert.deepEqual(checkoutLine({ slug: 'shirt', variationId: 'red', quantity: 2 }), {
      slug: 'shirt',
      variationId: 'red',
      quantity: 2,
    });
  });
});
