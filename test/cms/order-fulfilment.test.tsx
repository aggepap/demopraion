import '../setup/react-global';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { OrderDelivery, OrderPayments, OrderShipments } from '@/cms/admin/OrderFulfilment';
import { ORDER_STATUS_CONFIRM, OrderEditor } from '@/cms/admin/OrdersTable';

/**
 * The order panel: what was paid and how, how it travels, and the two things an
 * admin does to an order after it is placed — send money back, and send the
 * parcel. Both used to exist only as API routes.
 */

const pay = (over: Record<string, unknown> = {}) => ({
  id: 11,
  provider: 'stripe',
  status: 'captured',
  amount: 5000,
  currency: 'EUR',
  method: 'card',
  providerRef: 'pi_123',
  refundable: 5000,
  ...over,
});

const payments = (canWrite: boolean, list = [pay()]) =>
  renderToStaticMarkup(
    <OrderPayments payments={list} currency="EUR" locale="en" canWrite={canWrite} onRefund={async () => {}} />,
  );

describe('cancel / refunded confirmations', () => {
  test('cancelling says the customer IS emailed, and that no money moves', () => {
    const message = ORDER_STATUS_CONFIRM.cancelled.message;
    assert.match(message, /emailed/i);
    assert.doesNotMatch(message, /not told/i);
    assert.match(message, /not refunded/i);
  });

  test('the manual "refunded" record says what it really does', () => {
    // Marking an order refunded emails the customer (STATUS_EMAIL.refunded) and
    // restocks it; the old text told the admin to tell the customer themselves.
    const { message } = ORDER_STATUS_CONFIRM.refunded;
    assert.match(message, /customer is emailed/);
    assert.match(message, /back into stock/);
    assert.match(message, /does not move any money/);
    assert.doesNotMatch(message, /tell the customer/);
  });
});

describe('OrderPayments', () => {
  test('lists each payment with its provider, amount and status', () => {
    const html = payments(false, [pay(), pay({ id: 12, provider: 'giftcard', method: 'giftcard', refundable: 0, amount: 1500 })]);
    assert.match(html, /Payments/);
    assert.match(html, /Stripe/);
    assert.match(html, /Gift card/);
    assert.match(html, /€50\.00/);
    assert.match(html, /€15\.00/);
    assert.match(html, /captured/);
  });

  test('a captured gateway payment offers a refund to someone who may write', () => {
    assert.match(payments(true), /aria-label="Refund payment 11"/);
  });

  test('a reader is offered no refund', () => {
    assert.doesNotMatch(payments(false), /Refund payment/);
  });

  test('nothing refundable, no refund button', () => {
    assert.doesNotMatch(payments(true, [pay({ refundable: 0 })]), /Refund payment/);
    assert.doesNotMatch(payments(true, [pay({ status: 'pending' })]), /Refund payment/);
  });

  test('says so when there are no payments', () => {
    assert.match(payments(true, []), /No payments recorded/);
  });
});

describe('OrderDelivery', () => {
  const render = (shipping: Record<string, unknown>, list = [pay()]) =>
    renderToStaticMarkup(<OrderDelivery shipping={shipping} payments={list} currency="EUR" locale="en" />);

  test('shows the chosen method and courier', () => {
    const html = render({ shippingMethod: { id: 1, name: 'ACS next day', courier: 'acs', kind: 'address', cost: 450 } });
    assert.match(html, /ACS next day/);
    assert.match(html, /ACS/);
  });

  test('shows the BoxNow locker the customer picked', () => {
    const html = render({
      shippingMethod: { id: 2, name: 'Locker', courier: 'boxnow', kind: 'locker', cost: 250 },
      locker: { id: 'L42', name: 'Syntagma kiosk' },
    });
    assert.match(html, /Syntagma kiosk/);
    assert.match(html, /L42/);
  });

  test('shows what gift cards paid', () => {
    const html = render({}, [pay({ id: 3, provider: 'giftcard', providerRef: 'giftcard:8', amount: 2000, refundable: 0 })]);
    assert.match(html, /Gift cards used/);
    assert.match(html, /€20\.00/);
  });

  test('renders nothing when there is nothing to say', () => {
    assert.equal(render({}, []), '');
  });
});

describe('OrderShipments', () => {
  const ship = { id: 1, courier: 'acs', voucher: '7012345678', trackingUrl: 'https://track.example/7012345678', status: 'created', createdAt: '2026-09-20T10:00:00.000Z' };
  const render = (canWrite: boolean, orderCourier: string | null, list = [ship]) =>
    renderToStaticMarkup(
      <OrderShipments orderId={5} shipments={list} orderCourier={orderCourier} canWrite={canWrite} onChange={() => {}} />,
    );

  test('lists each parcel with a tracking link', () => {
    const html = render(false, 'acs');
    assert.match(html, /Shipments/);
    assert.match(html, /7012345678/);
    assert.match(html, /href="https:\/\/track\.example\/7012345678"/);
  });

  test('an editor can add a tracking number', () => {
    const html = render(true, 'acs');
    assert.match(html, /Add tracking number/);
    assert.match(html, /<option value="speedex"/);
    assert.doesNotMatch(html, /Create BoxNow voucher/);
  });

  test('a BoxNow order offers to create the voucher', () => {
    assert.match(render(true, 'boxnow'), /Create BoxNow voucher/);
  });

  test('a reader sees the parcels and nothing to change them with', () => {
    const html = render(false, 'boxnow');
    assert.doesNotMatch(html, /Add tracking number/);
    assert.doesNotMatch(html, /Create BoxNow voucher/);
  });

  test('says so when nothing has been sent', () => {
    assert.match(render(false, null, []), /No shipments yet/);
  });
});

describe('OrderEditor wires the sections in', () => {
  test('an existing order shows payments and shipments', () => {
    const html = renderToStaticMarkup(
      <OrderEditor
        order={{
          id: 7,
          reference: 'ORD-1',
          status: 'paid',
          email: 'a@b.co',
          customerName: null,
          currency: 'EUR',
          subtotal: 5000,
          total: 5000,
          locale: 'en',
          createdAt: '2026-09-01T00:00:00.000Z',
          notes: null,
          metadata: { shipping: {} },
          items: [],
          payments: [pay()],
          shipments: [],
        }}
        currency="EUR"
        onClose={() => {}}
        onSaved={() => {}}
        canWrite
      />,
    );
    assert.match(html, /Payments/);
    assert.match(html, /Shipments/);
  });
});
