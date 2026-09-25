import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  applyGiftCards,
  formatGiftCardCode,
  generateGiftCardCode,
  hashGiftCardCode,
  isGiftCardUsable,
  normalizeGiftCardCode,
  parseGiftCardConfig,
  planGiftCardRefund,
  type GiftCardRow,
} from '@/cms/modules/commerce/giftcards/policy';

/**
 * Gift cards, which are money.
 *
 * Three rules carry the whole feature:
 *
 * 1. A code is a bearer credential, so only its HMAC is stored — a database
 *    dump must not be a wallet.
 * 2. Redeeming is a PAYMENT, not a discount. The order's total stays what the
 *    shop earned; only the amount still due goes down. Anything else quietly
 *    misstates revenue and VAT.
 * 3. A card can never pay more than it holds, and never more than is owed.
 */

const card = (over: Partial<GiftCardRow> = {}): GiftCardRow => ({
  id: 1,
  codeHash: 'x',
  balance: 5000,
  initialAmount: 5000,
  currency: 'EUR',
  status: 'active',
  expiresAt: null,
  ...over,
});

const now = new Date('2026-09-17T12:00:00Z');

describe('codes', () => {
  test('a generated code is long, unambiguous and grouped for reading aloud', () => {
    const code = generateGiftCardCode();
    assert.match(code, /^[0-9A-Z-]+$/);
    // Crockford base32: no I, L, O or U, so nothing is misread over a phone.
    assert.doesNotMatch(code, /[ILOU]/);
    assert.ok(code.replace(/-/g, '').length >= 16);
  });

  test('two codes are never the same', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateGiftCardCode()));
    assert.equal(seen.size, 200);
  });

  test('typed however, a code normalises to one form', () => {
    const code = 'abcd-efgh-jkmn-pqrs';
    assert.equal(normalizeGiftCardCode(' AbCd efgh-JKMN pqrs '), 'ABCDEFGHJKMNPQRS');
    assert.equal(normalizeGiftCardCode(code), normalizeGiftCardCode(code.toUpperCase()));
  });

  test('the hash needs the pepper, so a stolen table is not a wallet', () => {
    const code = generateGiftCardCode();
    const a = hashGiftCardCode(code, 'pepper-one');
    const b = hashGiftCardCode(code, 'pepper-two');
    assert.notEqual(a, b);
    assert.equal(a, hashGiftCardCode(code, 'pepper-one'));
    assert.equal(a.length, 64);
    assert.doesNotMatch(a, new RegExp(normalizeGiftCardCode(code)));
  });

  test('formatting is for humans, hashing is for storage', () => {
    assert.match(formatGiftCardCode('ABCDEFGHJKMNPQRS'), /^ABCD-EFGH-JKMN-PQRS$/);
  });
});

describe('isGiftCardUsable', () => {
  test('an active card with a balance is usable', () => {
    assert.equal(isGiftCardUsable(card(), now), true);
  });

  test('an empty, void or expired card is not', () => {
    assert.equal(isGiftCardUsable(card({ balance: 0 }), now), false);
    assert.equal(isGiftCardUsable(card({ status: 'void' }), now), false);
    assert.equal(
      isGiftCardUsable(card({ expiresAt: new Date('2026-09-16T00:00:00Z') }), now),
      false
    );
  });

  test('a card that has not been sent yet cannot be spent', () => {
    assert.equal(isGiftCardUsable(card({ status: 'scheduled' }), now), false);
  });
});

describe('applyGiftCards', () => {
  test('a card covers part of the order and the rest is still due', () => {
    const result = applyGiftCards([card({ balance: 2000 })], 5000);
    assert.deepEqual(result.applied, [{ giftCardId: 1, amount: 2000 }]);
    assert.equal(result.amountDue, 3000);
  });

  test('a card larger than the order only spends what is owed', () => {
    const result = applyGiftCards([card({ balance: 10_000 })], 4000);
    assert.deepEqual(result.applied, [{ giftCardId: 1, amount: 4000 }]);
    assert.equal(result.amountDue, 0);
  });

  test('several cards are spent in order until nothing is owed', () => {
    const result = applyGiftCards(
      [card({ id: 1, balance: 1000 }), card({ id: 2, balance: 9000 })],
      5000
    );
    assert.deepEqual(result.applied, [
      { giftCardId: 1, amount: 1000 },
      { giftCardId: 2, amount: 4000 },
    ]);
    assert.equal(result.amountDue, 0);
  });

  test('a card is not touched once nothing is owed', () => {
    const result = applyGiftCards(
      [card({ id: 1, balance: 9000 }), card({ id: 2, balance: 9000 })],
      1000
    );
    assert.deepEqual(result.applied, [{ giftCardId: 1, amount: 1000 }]);
  });

  test('an unusable card contributes nothing', () => {
    const result = applyGiftCards([card({ status: 'void', balance: 5000 })], 1000);
    assert.deepEqual(result.applied, []);
    assert.equal(result.amountDue, 1000);
  });

  test('a card in another currency is refused rather than converted', () => {
    // Converting at some rate we invented is worse than saying no.
    const result = applyGiftCards([card({ currency: 'USD' })], 1000, 'EUR');
    assert.deepEqual(result.applied, []);
  });

  test('an order that owes nothing spends no card', () => {
    assert.deepEqual(applyGiftCards([card()], 0).applied, []);
  });
});

describe('planGiftCardRefund', () => {
  test('money goes back to the gateway first, then to the card', () => {
    // The customer's own money before the shop's voucher.
    const plan = planGiftCardRefund({ amount: 5000, gatewayPaid: 3000, giftCardPaid: 2000 });
    assert.deepEqual(plan, { toGateway: 3000, toGiftCard: 2000 });
  });

  test('a small refund never reaches the card', () => {
    const plan = planGiftCardRefund({ amount: 1000, gatewayPaid: 3000, giftCardPaid: 2000 });
    assert.deepEqual(plan, { toGateway: 1000, toGiftCard: 0 });
  });

  test('an order paid entirely by card is refunded entirely to it', () => {
    const plan = planGiftCardRefund({ amount: 2000, gatewayPaid: 0, giftCardPaid: 2000 });
    assert.deepEqual(plan, { toGateway: 0, toGiftCard: 2000 });
  });

  test('never refunds more than was actually paid', () => {
    const plan = planGiftCardRefund({ amount: 9999, gatewayPaid: 1000, giftCardPaid: 500 });
    assert.deepEqual(plan, { toGateway: 1000, toGiftCard: 500 });
  });
});

describe('parseGiftCardConfig', () => {
  test('unset is off, with no amounts offered', () => {
    const config = parseGiftCardConfig(null);
    assert.equal(config.enabled, false);
    assert.deepEqual(config.presets, []);
  });

  test('keeps the amounts a shop offers, in minor units', () => {
    const config = parseGiftCardConfig({ enabled: true, presets: [2500, 5000], expiryMonths: 12 });
    assert.deepEqual(config.presets, [2500, 5000]);
    assert.equal(config.expiryMonths, 12);
  });

  test('refuses nonsense amounts rather than storing them', () => {
    const config = parseGiftCardConfig({ enabled: true, presets: [-100, 0, 'lots', 5000] });
    assert.deepEqual(config.presets, [5000]);
  });
});
