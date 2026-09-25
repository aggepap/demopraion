import '../setup/react-global';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { AbandonedCartsTable } from '@/cms/admin/AbandonedCartsTable';
import { CalendarLegend } from '@/cms/admin/AvailabilityCalendar';
import { CouponsManager, type Coupon } from '@/cms/admin/CouponsManager';
import { CourierCredentials } from '@/cms/admin/CourierCredentials';
import { CustomersTable } from '@/cms/admin/CustomersTable';
import { ORDER_STATUS_HELP, OrderEditor } from '@/cms/admin/OrdersTable';
import { ReservationFilterBar } from '@/cms/admin/ReservationsTable';
import { DEFAULT_RESERVATION_FILTERS } from '@/cms/modules/booking/reservation-filters';

/**
 * The "i" tips on the commerce and booking screens.
 *
 * What is pinned is that the explanation exists, is wired to what it explains
 * (`aria-describedby` resolves to the tip) and says the thing an admin needs —
 * not the exact wording. The consequences that must not be missed (the customer
 * is emailed, nothing is refunded) stay visible text and are pinned where they
 * live, in `order-fulfilment.test.tsx`.
 */

const idsIn = (html: string, attr: string) =>
  [...html.matchAll(new RegExp(`${attr}="([^"]+)"`, 'g'))].flatMap((m) => m[1].split(' '));

/** Every `aria-describedby` in the markup points at an element that exists. */
function assertDescribedByResolves(html: string) {
  const described = idsIn(html, 'aria-describedby');
  assert.ok(described.length > 0, 'nothing is described');
  const ids = new Set(idsIn(html, 'id'));
  for (const id of described) assert.ok(ids.has(id), `aria-describedby points at missing id "${id}"`);
}

/** The text of every tooltip bubble in the markup. */
const tips = (html: string) =>
  [...html.matchAll(/role="tooltip"[^>]*>([\s\S]*?)<\/span>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''));

/** The control a `<label for>` with this text points at, as its opening tag. */
function controlFor(html: string, label: RegExp): string {
  const labels = [...html.matchAll(/<label[^>]*for="([^"]+)"[^>]*>([\s\S]*?)<\/label>/g)];
  const hit = labels.find((m) => label.test(m[2].replace(/<[^>]+>/g, '')));
  assert.ok(hit, `no label matching ${label}`);
  const tag = html.match(new RegExp(`<(?:input|select|textarea)[^>]*id="${hit[1]}"[^>]*>`));
  assert.ok(tag, `label ${label} points at nothing`);
  return tag[0];
}

/** The tooltip text a control is described by. */
function descriptionOf(html: string, control: string): string {
  const id = control.match(/aria-describedby="([^" ]+)/)?.[1];
  assert.ok(id, `control is not described: ${control}`);
  const bubble = html.match(new RegExp(`id="${id}"[^>]*>([\\s\\S]*?)</(?:span|p)>`));
  assert.ok(bubble, `description ${id} is missing`);
  return bubble[1];
}

describe('Coupons', () => {
  const coupon: Coupon = {
    code: 'SUMMER',
    type: 'percent',
    value: 10,
    minSubtotal: 0,
    expiresAt: '',
    usageLimit: 0,
    perCustomerLimit: 0,
    active: true,
  };
  const html = renderToStaticMarkup(<CouponsManager initial={[coupon]} currency="EUR" />);

  test('every coupon control has a real label and an explanation behind the "i"', () => {
    for (const label of [/^Code$/, /^Type$/, /^Amount$/, /^Minimum order/, /^Expires$/, /^Max uses$/, /^Per customer$/]) {
      const control = controlFor(html, label);
      assert.ok(descriptionOf(html, control).length > 10, `${label} has no useful description`);
    }
    assertDescribedByResolves(html);
  });

  test('the tips say what the code does: case, last valid day, what counts as a use', () => {
    assert.match(descriptionOf(html, controlFor(html, /^Code$/)), /upper or lower case/i);
    assert.match(descriptionOf(html, controlFor(html, /^Expires$/)), /last day/i);
    assert.match(descriptionOf(html, controlFor(html, /^Max uses$/)), /cancelled or refunded/i);
    assert.match(descriptionOf(html, controlFor(html, /^Per customer$/)), /email/i);
  });

  test('Active is a labelled checkbox with its own tip', () => {
    assert.match(html, /<input[^>]*type="checkbox"[^>]*aria-describedby="[^"]+"/);
    assert.ok(tips(html).some((t) => /checkout/i.test(t) && /inactive|switched off|off/i.test(t)));
  });
});

describe('Orders', () => {
  test('every status has a plain explanation', () => {
    for (const status of ['pending', 'paid', 'fulfilled', 'cancelled', 'refunded'] as const) {
      assert.ok(ORDER_STATUS_HELP[status].length > 20, `${status} is unexplained`);
    }
    assert.match(ORDER_STATUS_HELP.fulfilled, /email/i);
    assert.match(ORDER_STATUS_HELP.cancelled, /stock/i);
  });

  const order = {
    id: 7,
    reference: 'PR-0007',
    status: 'paid' as const,
    email: 'reader@example.com',
    customerName: 'Maria P.',
    currency: 'EUR',
    subtotal: 4500,
    total: 5000,
    locale: 'el',
    createdAt: '2026-08-01T10:00:00.000Z',
    notes: null,
    metadata: { costs: { shipping: 500 } },
    items: [{ id: 1, name: 'Lamp', sku: null, variantLabel: null, unitPrice: 4500, quantity: 1, lineTotal: 4500 }],
    payments: [],
  };
  const html = renderToStaticMarkup(
    <OrderEditor order={order} currency="EUR" onClose={() => {}} onSaved={() => {}} onStatus={async () => {}} />,
  );

  test('the cost fields say they are charged as entered, not recalculated', () => {
    assert.match(descriptionOf(html, controlFor(html, /^Shipping/)), /not recalculated/i);
    assert.match(descriptionOf(html, controlFor(html, /^Discount/)), /not recalculated/i);
    assert.ok(descriptionOf(html, controlFor(html, /^Surcharge/)).length > 10);
    assert.ok(descriptionOf(html, controlFor(html, /^Gift wrap/)).length > 10);
  });

  test('Notes says whether the customer sees it', () => {
    const notes = html.match(/<textarea[^>]*>/)?.[0] ?? '';
    assert.match(descriptionOf(html, notes), /not shown to the customer/i);
  });

  test('the status pills are explained by a tip, and the warnings stay in the dialogs', () => {
    assert.ok(tips(html).some((t) => /move the order/i.test(t)));
  });
});

describe('Availability calendar legend', () => {
  const html = renderToStaticMarkup(<CalendarLegend />);

  test('names every mark a day cell can carry, visibly', () => {
    for (const word of ['Available', 'Full', 'Closed', 'Overbooked', 'Has an exception', '3/8', '€250']) {
      assert.ok(html.includes(word), `legend is missing "${word}"`);
    }
  });

  test('each entry has its own tip, and held/confirmed are explained', () => {
    const buttons = html.match(/<button[^>]*aria-label="[^"]+"/g) ?? [];
    assert.ok(buttons.length >= 7, `expected a tip per legend entry, found ${buttons.length}`);
    assertDescribedByResolves(html);
    const all = tips(html).join(' ');
    assert.match(all, /held/i);
    assert.match(all, /confirmed/i);
    assert.match(all, /price override/i);
  });
});

describe('Courier credentials', () => {
  const html = renderToStaticMarkup(
    <CourierCredentials
      initial={[
        { key: 'courier.boxnow.clientId', label: 'BoxNow client ID', module: 'commerce', set: true, masked: '1234', updatedAt: null },
        { key: 'courier.boxnow.clientSecret', label: 'BoxNow client secret', module: 'commerce', set: false, masked: null, updatedAt: null },
      ]}
    />,
  );

  test('whether a key is set stays visible text', () => {
    assert.match(html, /Set · 1234/);
    assert.match(html, />Not set</);
  });

  test('the tip explains the key, not its status', () => {
    const idTip = descriptionOf(html, controlFor(html, /^BoxNow client ID$/));
    const secretTip = descriptionOf(html, controlFor(html, /^BoxNow client secret$/));
    assert.doesNotMatch(idTip, /^Set \(|Not set/);
    assert.match(idTip, /partner account/i);
    assert.match(secretTip, /encrypted/i);
  });
});

describe('Customers', () => {
  const html = renderToStaticMarkup(
    <CustomersTable
      initial={[
        {
          id: 1,
          email: 'a@example.com',
          name: null,
          status: 'active',
          emailVerifiedAt: null,
          createdAt: '2026-01-01T00:00:00Z',
          lastLoginAt: null,
          orderCount: 0,
          deletedAt: null,
        },
      ]}
      initialTotal={1}
      canWrite
    />,
  );

  test('Unconfirmed and Disable are explained in the column headers', () => {
    const all = tips(html).join(' ');
    assert.match(all, /Unconfirmed/);
    assert.match(all, /signs the customer out/i);
  });
});

describe('Abandoned carts', () => {
  const html = renderToStaticMarkup(<AbandonedCartsTable initial={[]} />);

  test('says when a cart is due for its reminder', () => {
    const all = tips(html).join(' ');
    assert.match(all, /due/i);
    assert.match(all, /hour/i);
  });
});

describe('Reservation filters', () => {
  const html = renderToStaticMarkup(
    <ReservationFilterBar filters={DEFAULT_RESERVATION_FILTERS} experiences={[]} onChange={() => {}} />,
  );

  test('explains Needs action and what the date range filters on', () => {
    const all = tips(html).join(' ');
    assert.match(all, /awaiting your reply/i);
    assert.match(all, /booking date|check-in/i);
    assert.match(all, /not the day/i);
  });
});
