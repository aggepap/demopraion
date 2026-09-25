import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  deliverIssuedGiftCard,
  giftCardHistory,
  isGiftCardAmountAllowed,
  validateGiftCardPurchase,
} from '@/cms/modules/commerce/giftcards/rules';
import type { GiftCardConfig } from '@/cms/modules/commerce/giftcards/policy';

/**
 * Buying a gift card, issuing one by hand, and reading its history.
 *
 * The amount a shopper picks is a price the server did not set, so it is
 * checked against the shop's own rules again at checkout — the product page's
 * limits are a convenience, not a control.
 */

const config = (over: Partial<GiftCardConfig> = {}): GiftCardConfig => ({
  enabled: true,
  presets: [2500, 5000],
  allowCustom: true,
  minAmount: 1000,
  maxAmount: 20000,
  expiryMonths: 24,
  ...over,
});

const today = new Date('2026-09-23T10:00:00Z');

const purchase = (over: Record<string, unknown> = {}) => ({
  amount: 2500,
  recipientName: 'Maria',
  recipientEmail: 'maria@example.com',
  message: 'Happy birthday',
  sendAt: '2026-10-01',
  ...over,
});

describe('isGiftCardAmountAllowed', () => {
  test('a preset is always allowed', () => {
    assert.equal(isGiftCardAmountAllowed(config({ allowCustom: false }), 5000), true);
  });

  test('a custom amount is allowed only when the shop allows one, within its limits', () => {
    assert.equal(isGiftCardAmountAllowed(config(), 1234), true);
    assert.equal(isGiftCardAmountAllowed(config({ allowCustom: false }), 1234), false);
    assert.equal(isGiftCardAmountAllowed(config(), 999), false);
    assert.equal(isGiftCardAmountAllowed(config(), 20001), false);
  });

  test('zero, negative and fractional amounts are refused', () => {
    assert.equal(isGiftCardAmountAllowed(config(), 0), false);
    assert.equal(isGiftCardAmountAllowed(config(), -2500), false);
    assert.equal(isGiftCardAmountAllowed(config(), 2500.5), false);
  });
});

describe('validateGiftCardPurchase', () => {
  test('a well-formed purchase is accepted and normalised', () => {
    const res = validateGiftCardPurchase(config(), purchase(), today);
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.deepEqual(res.value, {
      amount: 2500,
      recipientName: 'Maria',
      recipientEmail: 'maria@example.com',
      message: 'Happy birthday',
      sendAt: '2026-10-01',
    });
  });

  test('refused while gift cards are switched off', () => {
    const res = validateGiftCardPurchase(config({ enabled: false }), purchase(), today);
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.message, /not available/i);
  });

  test('an amount outside the limits is refused, naming the limits', () => {
    const res = validateGiftCardPurchase(config(), purchase({ amount: 50_000 }), today);
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.message, /amount/i);
  });

  test('a recipient email is required, and must look like one', () => {
    assert.equal(validateGiftCardPurchase(config(), purchase({ recipientEmail: '' }), today).ok, false);
    assert.equal(validateGiftCardPurchase(config(), purchase({ recipientEmail: 'nope' }), today).ok, false);
  });

  test('a send date in the past is refused; no date means today', () => {
    assert.equal(validateGiftCardPurchase(config(), purchase({ sendAt: '2026-01-01' }), today).ok, false);
    const res = validateGiftCardPurchase(config(), purchase({ sendAt: undefined }), today);
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.value.sendAt, '2026-09-23');
  });

  test('a send date more than a year away is refused', () => {
    assert.equal(validateGiftCardPurchase(config(), purchase({ sendAt: '2027-12-01' }), today).ok, false);
  });

  test('a missing purchase is refused rather than minting a card for nothing', () => {
    assert.equal(validateGiftCardPurchase(config(), undefined, today).ok, false);
  });
});

describe('deliverIssuedGiftCard', () => {
  const card = { code: 'ABCD-EFGH-JKMN-PQRS', message: null, amount: 2500, currency: 'EUR' };

  test('with a recipient, the card is emailed', async () => {
    const sent: string[] = [];
    const res = await deliverIssuedGiftCard({ ...card, recipientEmail: 'a@b.co' }, async (c) => {
      sent.push(c.recipientEmail ?? '');
    });
    assert.deepEqual(sent, ['a@b.co']);
    assert.equal(res.emailed, true);
  });

  test('without a recipient, nothing is sent', async () => {
    let calls = 0;
    const res = await deliverIssuedGiftCard({ ...card, recipientEmail: null }, async () => {
      calls += 1;
    });
    assert.equal(calls, 0);
    assert.equal(res.emailed, false);
  });

  test('a failed send is reported, not thrown — the card already exists', async () => {
    const res = await deliverIssuedGiftCard({ ...card, recipientEmail: 'a@b.co' }, async () => {
      throw new Error('mail down');
    });
    assert.equal(res.emailed, false);
  });
});

describe('giftCardHistory', () => {
  const issued = new Date('2026-09-01T09:00:00Z');

  test('starts with the issue, then every movement in order', () => {
    const rows = giftCardHistory({ initialAmount: 5000, createdAt: issued, orderId: null }, [
      { id: 2, type: 'reversal', amount: 1500, balanceAfter: 5000, orderId: 7, note: 'Order cancelled', createdAt: new Date('2026-09-05T00:00:00Z') },
      { id: 1, type: 'redeem', amount: -1500, balanceAfter: 3500, orderId: 7, note: null, createdAt: new Date('2026-09-04T00:00:00Z') },
    ]);
    assert.deepEqual(
      rows.map((r) => [r.label, r.amount, r.balanceAfter]),
      [
        ['Issued', 5000, 5000],
        ['Redeemed', -1500, 3500],
        ['Restored (order cancelled)', 1500, 5000],
      ],
    );
    assert.equal(rows[1]?.orderId, 7);
  });

  test('a refund credit and a void are named for what they are', () => {
    const rows = giftCardHistory({ initialAmount: 1000, createdAt: issued, orderId: 3 }, [
      { id: 1, type: 'refund_credit', amount: 400, balanceAfter: 1400, orderId: 9, note: null, createdAt: issued },
      { id: 2, type: 'void', amount: 0, balanceAfter: 1400, orderId: null, note: null, createdAt: issued },
    ]);
    assert.deepEqual(rows.map((r) => r.label), ['Issued (bought with an order)', 'Refunded to card', 'Voided']);
  });
});
