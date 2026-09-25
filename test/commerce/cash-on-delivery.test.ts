/**
 * Cash on delivery was half-wired: a shipping method's "Cash on delivery
 * allowed" box was never consulted (nothing passed `codSelected` to
 * `quoteMethods`), and nothing wrote `metadata.codAmount`, so a BoxNow voucher
 * was always booked prepaid — the courier handed over a parcel nobody had paid
 * for.
 *
 * The shop has ONE payment provider, chosen in Settings. An order is paid on
 * delivery when that provider is an offline one (`manual`: "bank transfer, cash
 * on arrival"), which is also the provider the COD surcharge is keyed on. So:
 * with an offline provider, methods that do not allow COD are not offered (in
 * the estimate or at checkout), and a delivered order records what the courier
 * must collect. The voucher already sends `codAmount` only while the order is
 * unpaid, so a bank transfer that was confirmed first is booked prepaid.
 *
 * Also here: the shipping-quote route did not import `payments/register`, so the
 * provider (and its surcharge) in the storefront estimate could differ from the
 * one checkout charged.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { codAmountFor, rebaseCodAmount } from '@/cms/modules/commerce/shipping-methods';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('codAmountFor', () => {
  test('an offline order delivered by courier collects what is still due', () => {
    assert.equal(codAmountFor({ online: false, delivered: true, amountDue: 4250 }), 4250);
  });

  test('nothing to collect for an online payment, a pickup or download, or nothing due', () => {
    assert.equal(codAmountFor({ online: true, delivered: true, amountDue: 4250 }), undefined);
    assert.equal(codAmountFor({ online: false, delivered: false, amountDue: 4250 }), undefined);
    assert.equal(codAmountFor({ online: false, delivered: true, amountDue: 0 }), undefined);
  });
});

describe('rebaseCodAmount', () => {
  test('an admin edit moves the amount to collect with the total, keeping what gift cards paid', () => {
    // 5000 total, 1000 paid by gift card → 4000 to collect; total edited to 6000.
    assert.equal(rebaseCodAmount({ prevCod: 4000, prevTotal: 5000, total: 6000 }), 5000);
    assert.equal(rebaseCodAmount({ prevCod: 4000, prevTotal: 5000, total: 500 }), 0);
  });

  test('an order that never had one keeps none', () => {
    assert.equal(rebaseCodAmount({ prevCod: undefined, prevTotal: 5000, total: 6000 }), undefined);
  });
});

describe('wiring', () => {
  const orders = read('src/cms/modules/commerce/orders.ts');
  const shipping = read('src/cms/modules/commerce/shipping.ts');

  test('checkout offers only COD-allowed methods to an offline order', () => {
    assert.match(orders, /codSelected: !isOnlineProvider\(provider\)/);
  });

  test('checkout records codAmount on the order', () => {
    assert.match(orders, /codAmountFor\(\{/);
    assert.match(orders, /codAmount/);
  });

  test('an admin edit keeps codAmount in step with the total', () => {
    assert.match(orders, /rebaseCodAmount\(\{/);
  });

  test('the shipping estimate applies the same COD rule', () => {
    assert.match(shipping, /codSelected: !isOnlineProvider\(provider\)/);
  });

  test('the shipping-quote route registers the payment providers', () => {
    assert.match(read('src/app/api/cms/commerce/shipping-quote/route.ts'), /import '@\/cms\/core\/payments\/register';/);
  });
});
