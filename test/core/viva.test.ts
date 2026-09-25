import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import {
  VIVA_EVENT_PAYMENT_CREATED,
  VIVA_EVENT_REVERSAL_CREATED,
  VIVA_EVENT_TRANSACTION_FAILED,
  vivaEventKind,
} from '@/cms/core/payments/events';
import {
  amountMatches,
  checkoutUrl,
  extractOrderCode,
  extractTransactionId,
  readVivaWebhookKey,
  vivaHosts,
} from '@/cms/core/payments/viva';

/**
 * The order-code tests are the important ones here.
 *
 * Viva issues 16-digit order codes, and 16 digits runs past
 * `Number.MAX_SAFE_INTEGER` (9007199254740991). `JSON.parse` will happily round
 * such a value, and the rounded result is a perfectly plausible-looking number
 * that matches no order — so a payment would be confirmed against nothing, or
 * worse, against a neighbouring order. Every code is therefore read out of the
 * raw response text as a string and never becomes a JS number.
 */
describe('order codes survive as strings', () => {
  test('a 16-digit code beyond MAX_SAFE_INTEGER is read exactly', () => {
    const code = '9999999999999999';
    assert.ok(Number(code) > Number.MAX_SAFE_INTEGER, 'precondition: the code must exceed the safe range');
    assert.equal(extractOrderCode(`{"orderCode":${code}}`), code);
  });

  test('and JSON.parse really would have corrupted it', () => {
    // Documents the hazard rather than the fix — if this ever stops being true,
    // the workaround can go.
    const code = '9999999999999999';
    const viaParse = String((JSON.parse(`{"orderCode":${code}}`) as { orderCode: number }).orderCode);
    assert.notEqual(viaParse, code);
    assert.equal(extractOrderCode(`{"orderCode":${code}}`), code);
  });

  test('reads the capitalised webhook spelling too', () => {
    // API responses say `orderCode`; webhook payloads say `OrderCode`.
    assert.equal(extractOrderCode('{"OrderCode":1234567890123456}'), '1234567890123456');
  });

  test('reads a quoted code, which Viva recommends sending', () => {
    assert.equal(extractOrderCode('{"orderCode":"1234567890123456"}'), '1234567890123456');
  });

  test('finds the code among other fields', () => {
    const raw = '{"email":"a@b.c","amount":10.5,"orderCode":8054238951124567,"statusId":"F"}';
    assert.equal(extractOrderCode(raw), '8054238951124567');
  });

  test('returns null rather than a wrong answer', () => {
    assert.equal(extractOrderCode('{"statusId":"F"}'), null);
    assert.equal(extractOrderCode(''), null);
    assert.equal(extractOrderCode('not json at all'), null);
  });
});

describe('transaction ids', () => {
  test('are read from either spelling', () => {
    assert.equal(
      extractTransactionId('{"TransactionId":"7f8a-1234-abcd"}'),
      '7f8a-1234-abcd',
    );
    assert.equal(extractTransactionId('{"transactionId":"abc"}'), 'abc');
  });

  test('absent means null', () => {
    assert.equal(extractTransactionId('{"OrderCode":1}'), null);
  });
});

describe('vivaEventKind', () => {
  test('maps the three transaction events', () => {
    assert.equal(vivaEventKind({ EventTypeId: VIVA_EVENT_PAYMENT_CREATED }), 'captured');
    assert.equal(vivaEventKind({ EventTypeId: VIVA_EVENT_REVERSAL_CREATED }), 'refunded');
    assert.equal(vivaEventKind({ EventTypeId: VIVA_EVENT_TRANSACTION_FAILED }), 'failed');
  });

  test('the ids are the documented ones', () => {
    assert.equal(VIVA_EVENT_PAYMENT_CREATED, 1796);
    assert.equal(VIVA_EVENT_REVERSAL_CREATED, 1797);
    assert.equal(VIVA_EVENT_TRANSACTION_FAILED, 1798);
  });

  test('everything else is ignored — Viva sends far more than payments', () => {
    // Payouts, account events, price calculations all arrive on the same URL.
    for (const id of [2054, 8448, 5632, 1799, 0, undefined]) {
      assert.equal(vivaEventKind({ EventTypeId: id }), null, `expected ${id} to be ignored`);
    }
  });
});

/**
 * Viva takes order amounts in cents but has reported transaction amounts in
 * major units, and which one a given endpoint uses has moved between API
 * versions. Accepting either is deliberate — the alternative is rejecting good
 * payments after the money has already moved.
 */
describe('amountMatches', () => {
  test('accepts the minor-unit reading', () => {
    assert.equal(amountMatches(10000, 10000), true);
  });

  test('accepts the major-unit reading of the same money', () => {
    assert.equal(amountMatches(10000, 100), true);
    assert.equal(amountMatches(12345, 123.45), true);
  });

  test('rejects a genuinely different amount', () => {
    // The case this exists for: a partial capture against a full-price order.
    assert.equal(amountMatches(10000, 5000), false);
    assert.equal(amountMatches(10000, 50), false);
  });

  test('a missing amount is not a match', () => {
    assert.equal(amountMatches(10000, null), false);
  });
});

describe('environment selection', () => {
  const original = process.env.VIVA_ENV;
  afterEach(() => {
    if (original === undefined) delete process.env.VIVA_ENV;
    else process.env.VIVA_ENV = original;
  });

  test('defaults to demo, and only an exact "live" opts in', () => {
    // Deliberate: a typo'd or missing variable must not move real money.
    for (const value of [undefined, '', 'production', 'LIVE', 'live ']) {
      if (value === undefined) delete process.env.VIVA_ENV;
      else process.env.VIVA_ENV = value;
      assert.ok(
        vivaHosts().api.includes('demo-'),
        `expected VIVA_ENV=${JSON.stringify(value)} to stay on demo`,
      );
    }
  });

  test('live selects the production hosts', () => {
    process.env.VIVA_ENV = 'live';
    const hosts = vivaHosts();
    assert.equal(hosts.accounts, 'https://accounts.vivapayments.com');
    assert.equal(hosts.api, 'https://api.vivapayments.com');
    assert.equal(hosts.checkout, 'https://www.vivapayments.com');
  });

  test('the checkout URL carries the order code as ref', () => {
    process.env.VIVA_ENV = 'live';
    assert.equal(
      checkoutUrl('1234567890123456'),
      'https://www.vivapayments.com/web/checkout?ref=1234567890123456',
    );
  });
});

describe('the webhook verification key', () => {
  const original = process.env.VIVA_WEBHOOK_VERIFICATION_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.VIVA_WEBHOOK_VERIFICATION_KEY;
    else process.env.VIVA_WEBHOOK_VERIFICATION_KEY = original;
  });

  test('is null when unset or blank, so the handshake 404s rather than half-answering', () => {
    delete process.env.VIVA_WEBHOOK_VERIFICATION_KEY;
    assert.equal(readVivaWebhookKey(), null);
    process.env.VIVA_WEBHOOK_VERIFICATION_KEY = '   ';
    assert.equal(readVivaWebhookKey(), null);
  });

  test('is trimmed, because it is pasted from a portal', () => {
    process.env.VIVA_WEBHOOK_VERIFICATION_KEY = '  abc123  ';
    assert.equal(readVivaWebhookKey(), 'abc123');
  });
});
