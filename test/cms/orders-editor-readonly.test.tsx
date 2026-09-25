import '../setup/react-global';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { OrderEditor } from '@/cms/admin/OrdersTable';

/**
 * The order panel for someone who may look but not touch.
 *
 * `canWrite` reached this component and was spent entirely on the Save button and
 * the status pills. Every field below them — email, name, phone, address, each
 * item's name and price, shipping, discount — took typing as happily as it does
 * for an editor, so a reader on `ordersRead` alone got a form that accepts input
 * and has nowhere to send it. Nothing could be saved (the routes are behind
 * `ordersWrite`), which is why this was only ever a lie told by the UI: it invites
 * an edit it will silently drop when the panel closes.
 *
 * The same prop carries the lock case — `canWrite && !lock.readOnly` at the call
 * site — so this covers the admin who opened an order somebody else is holding.
 *
 * Read-only here means `readonly`, not `disabled`: the address on a pickup order
 * is something people copy out into a courier form, and a disabled input cannot
 * be selected or tabbed to. Buttons have no such state, so the two ways of
 * changing the item list are removed instead.
 */
const ORDER = {
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
  notes: 'Leave with the neighbour.',
  version: 3,
  metadata: { shipping: { phone: '+30 210 0000000', address1: 'Ermou 1', city: 'Athens' }, costs: { shipping: 500 } },
  items: [{ id: 1, name: 'Lamp', sku: 'LMP-1', variantLabel: 'Brass', unitPrice: 4500, quantity: 1, lineTotal: 4500 }],
  payments: [],
};

const render = (canWrite: boolean) =>
  renderToStaticMarkup(
    <OrderEditor order={ORDER} currency="EUR" onClose={() => {}} onSaved={() => {}} canWrite={canWrite} />,
  );

/** Every form control in the panel, as its raw opening tag. */
const controls = (html: string) => html.match(/<(?:input|textarea)\b[^>]*>/g) ?? [];

/** React 19 serialises the prop as `readOnly=""`; HTML attribute names are case-insensitive. */
const isReadOnly = (tag: string) => /\sreadonly=/i.test(tag);

describe('OrderEditor without write permission', () => {
  test('renders no control the reader can type into', () => {
    const found = controls(render(false));
    assert.ok(found.length > 0, 'no form controls rendered at all — the fixture stopped exercising the form');
    const editable = found.filter((tag) => !isReadOnly(tag));
    assert.deepEqual(editable, [], 'these controls still accept typing for a read-only role');
  });

  test('covers the customer fields, the item row, the costs and the notes', () => {
    // Not a count for its own sake: it pins that the guard reaches every group,
    // rather than one block of fields being fixed and the rest missed.
    const html = render(false);
    assert.equal(controls(html).length, 17, 'unexpected number of controls — a group may be ungated');
    assert.equal(controls(html).filter(isReadOnly).length, 17);
  });

  test('offers no way to add or remove an item', () => {
    const html = render(false);
    assert.doesNotMatch(html, /aria-label="Remove"/, 'the per-item remove button is still clickable');
    assert.doesNotMatch(html, /Add product/, 'the product search still offers to add a line');
  });
});

describe('OrderEditor with write permission', () => {
  test('leaves every control editable', () => {
    const readonly = controls(render(true)).filter(isReadOnly);
    assert.deepEqual(readonly, [], 'an editor was locked out of their own form');
  });

  test('keeps the add and remove affordances', () => {
    const html = render(true);
    assert.match(html, /aria-label="Remove"/);
    assert.match(html, /Add product/);
  });
});
