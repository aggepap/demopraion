import '../setup/react-global';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { scrubQuery, scrubUrl } from '@/components/layout/AnalyticsLoader';

/**
 * The booking payment link carries its bearer token in the URL, because the
 * provider's return leg has to bring it back. That makes every analytics event
 * on that page a potential place to hand a live credential to a third party.
 */
describe('scrubUrl', () => {
  test('redacts the payment-link token', () => {
    const out = scrubUrl('https://praion.gr/booking/pay/BKG-2026-7F3K9QMXVR?t=SECRETTOKENVALUE');
    assert.ok(!out.includes('SECRETTOKENVALUE'), 'the token must not survive');
    assert.match(out, /t=redacted/);
  });

  test('redacts rather than drops, so the page is still identifiable in reports', () => {
    const out = scrubUrl('https://praion.gr/booking/pay/BKG-1?t=abc');
    assert.match(out, /\/booking\/pay\/BKG-1/);
  });

  test('also covers a `token` param', () => {
    assert.match(scrubUrl('https://praion.gr/x?token=abc'), /token=redacted/);
  });

  test('leaves ordinary URLs untouched', () => {
    assert.equal(scrubUrl('https://praion.gr/insights'), 'https://praion.gr/insights');
    assert.match(scrubUrl('https://praion.gr/shop?page=2'), /page=2/);
  });

  test('keeps other params while redacting the sensitive one', () => {
    const out = scrubUrl('https://praion.gr/booking/pay/BKG-1?t=abc&return=1');
    assert.match(out, /t=redacted/);
    assert.match(out, /return=1/);
  });

  test('an unparseable href reports nothing rather than reporting it raw', () => {
    // Failing open here would send the very string we could not inspect.
    assert.equal(scrubUrl('not a url'), '');
  });
});

describe('scrubQuery', () => {
  test('redacts the token inside a page_path query string', () => {
    const out = scrubQuery('t=SECRETTOKENVALUE&return=1');
    assert.ok(!out.includes('SECRETTOKENVALUE'));
    assert.match(out, /t=redacted/);
    assert.match(out, /return=1/);
  });

  test('an empty query stays empty', () => {
    assert.equal(scrubQuery(''), '');
  });
});
