import '../setup/react-global';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { CourierCredentials } from '@/cms/admin/CourierCredentials';
import { GiftCardHistory, GiftCardsTable } from '@/cms/admin/GiftCardsTable';
import { GiftCardSettings, giftCardSettingsFromForm } from '@/cms/admin/GiftCardSettings';
import { ShippingMethodsManager } from '@/cms/admin/ShippingMethodsManager';
import { checkStructuredSetting } from '@/cms/core/settings/structured';
import { ECOMMERCE_GIFTCARDS_KEY } from '@/cms/core/settings/schema';

/**
 * Settings → Ecommerce: the parts of commerce that had an API and no screen.
 */

describe('Settings → Ecommerce → Gift cards', () => {
  const initial = { enabled: false, presets: [2500, 5000], allowCustom: true, minAmount: 1000, maxAmount: 50000, expiryMonths: 24 };

  test('offers every setting, amounts shown in major units', () => {
    const html = renderToStaticMarkup(<GiftCardSettings initial={initial} currency="EUR" />);
    assert.match(html, /Sell gift cards/);
    assert.match(html, /Preset amounts/);
    assert.match(html, /value="25, 50"/);
    assert.match(html, /Allow a custom amount/);
    assert.match(html, /Smallest custom amount/);
    assert.match(html, /value="10"/);
    assert.match(html, /Largest custom amount/);
    assert.match(html, /value="500"/);
    assert.match(html, /Expires after \(months\)/);
    assert.match(html, /value="24"/);
    assert.match(html, />Save</);
  });

  const form = (over: Record<string, unknown> = {}) => ({
    enabled: true,
    presets: '25, 50,100',
    allowCustom: true,
    minAmount: '10',
    maxAmount: '500',
    expiryMonths: '0',
    ...over,
  });

  test('turns the form into the stored config, in minor units', () => {
    const res = giftCardSettingsFromForm(form());
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.deepEqual(res.value, {
      enabled: true,
      presets: [2500, 5000, 10000],
      allowCustom: true,
      minAmount: 1000,
      maxAmount: 50000,
      expiryMonths: 0,
    });
    // And what it produces is what the server accepts.
    assert.equal(checkStructuredSetting(ECOMMERCE_GIFTCARDS_KEY, res.value)?.ok, true);
  });

  test('explains a mistake instead of saving it', () => {
    const bad = (over: Record<string, unknown>) => {
      const res = giftCardSettingsFromForm(form(over));
      assert.equal(res.ok, false);
      return res.ok ? '' : res.message;
    };
    assert.match(bad({ presets: '25, lots' }), /Preset amounts/);
    assert.match(bad({ minAmount: '600' }), /largest/i);
    assert.match(bad({ expiryMonths: '-1' }), /months/i);
    assert.match(bad({ minAmount: '0' }), /smallest/i);
  });

  test('the server refuses what the form refuses', () => {
    const res = checkStructuredSetting(ECOMMERCE_GIFTCARDS_KEY, { ...initial, minAmount: 60000 });
    assert.equal(res?.ok, false);
  });
});

describe('Gift cards page', () => {
  const card = {
    id: 3,
    codeLast4: 'PQRS',
    currency: 'EUR',
    initialAmount: 5000,
    balance: 3500,
    status: 'active',
    expiresAt: null,
    recipientEmail: 'maria@example.com',
    sendAt: null,
    sentAt: '2026-09-01T00:00:00.000Z',
    createdAt: '2026-09-01T00:00:00.000Z',
  };

  test('the issue form asks for a recipient and a message', () => {
    const html = renderToStaticMarkup(<GiftCardsTable initial={[card]} canWrite />);
    assert.match(html, /Send to \(optional\)/);
    assert.match(html, /Message \(optional\)/);
    assert.match(html, /Issue a card/);
  });

  test('each card can open its history', () => {
    const html = renderToStaticMarkup(<GiftCardsTable initial={[card]} canWrite={false} />);
    assert.match(html, /aria-expanded="false"/);
    assert.match(html, /History/);
  });

  test('the history lists every movement with the balance after it', () => {
    const html = renderToStaticMarkup(
      <GiftCardHistory
        currency="EUR"
        entries={[
          { key: 'issue', at: '2026-09-01T00:00:00.000Z', label: 'Issued', amount: 5000, balanceAfter: 5000, orderId: null, note: null },
          { key: '1', at: '2026-09-04T00:00:00.000Z', label: 'Redeemed', amount: -1500, balanceAfter: 3500, orderId: 7, note: null },
        ]}
      />,
    );
    assert.match(html, /Issued/);
    assert.match(html, /Redeemed/);
    assert.match(html, /-15\.00 EUR/);
    assert.match(html, /35\.00 EUR/);
    assert.match(html, /Order #7/);
  });
});

describe('Settings → Ecommerce → Shipping → Shipping methods', () => {
  const zones = [{ id: 1, name: 'Greece', countries: ['GR', 'CY'], sort: 0 }];
  const methods = [
    {
      id: 4,
      zoneId: 1,
      name: 'ACS next day',
      courier: 'acs' as const,
      kind: 'address' as const,
      cost: 450,
      freeThreshold: 5000,
      etaMinDays: 1,
      etaMaxDays: 2,
      codAllowed: true,
      active: true,
      sort: 0,
      pickupLocationId: null,
    },
  ];

  test('lists zones and their methods with what a shopper is charged', () => {
    const html = renderToStaticMarkup(
      <ShippingMethodsManager initialZones={zones} initialMethods={methods} currency="EUR" pickupLocations={[]} />,
    );
    assert.match(html, /Shipping methods/);
    assert.match(html, /Greece/);
    assert.match(html, /GR, CY/);
    assert.match(html, /ACS next day/);
    assert.match(html, /4\.50 EUR/);
    assert.match(html, /free over 50\.00 EUR/);
    assert.match(html, /1–2 days/);
    assert.match(html, /Add zone/);
    assert.match(html, /Add method/);
  });

  test('says how the old calculation still applies while there are no methods', () => {
    const html = renderToStaticMarkup(
      <ShippingMethodsManager initialZones={[]} initialMethods={[]} currency="EUR" pickupLocations={[]} />,
    );
    assert.match(html, /No shipping methods yet/);
  });
});

describe('Settings → Ecommerce → Shipping → Couriers', () => {
  test('shows whether each credential is set, never its value', () => {
    const html = renderToStaticMarkup(
      <CourierCredentials
        initial={[
          { key: 'courier.boxnow.clientId', label: 'BoxNow client ID', module: 'commerce', set: true, masked: '••••ab12', updatedAt: '2026-09-01T00:00:00.000Z' },
          { key: 'courier.boxnow.clientSecret', label: 'BoxNow client secret', module: 'commerce', set: false, masked: null, updatedAt: null },
        ]}
      />,
    );
    assert.match(html, /Couriers/);
    assert.match(html, /BoxNow client ID/);
    assert.match(html, /••••ab12/);
    assert.match(html, /Not set/);
    assert.match(html, /type="password"/);
    // The inputs start empty: a stored secret is never put back into the page.
    assert.doesNotMatch(html, /value="[^"]+"[^>]*type="password"|type="password"[^>]*value="[^"]+"/);
  });
});
