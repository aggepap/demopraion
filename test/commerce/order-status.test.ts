/**
 * The admin could move an order from any status to any other: `orderUpdateRoute`
 * took any value of the enum, from anywhere. A cancelled order could be marked
 * paid again (its stock and gift card balance already given back), a refunded
 * one fulfilled, a pending one refunded with nothing paid. The lifecycle in
 * docs/dev-guides/08-commerce.md §4.5 is now a map the server enforces and the
 * panel follows.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { orderStatusValues } from '@/cms/db/adapters/mysql/schema/commerce';
import { canMoveOrderStatus, ORDER_STATUS_TRANSITIONS } from '@/cms/modules/commerce/order-status';

describe('ORDER_STATUS_TRANSITIONS', () => {
  test('covers every status', () => {
    assert.deepEqual(Object.keys(ORDER_STATUS_TRANSITIONS).sort(), [...orderStatusValues].sort());
  });

  test('allows the documented moves', () => {
    for (const [from, to] of [
      ['pending', 'paid'],
      ['pending', 'cancelled'],
      ['paid', 'fulfilled'],
      ['paid', 'refunded'],
      ['paid', 'cancelled'],
      ['fulfilled', 'refunded'],
    ] as const) {
      assert.ok(canMoveOrderStatus(from, to), `${from} → ${to}`);
    }
  });

  test('refuses everything else', () => {
    for (const [from, to] of [
      ['cancelled', 'paid'],
      ['cancelled', 'pending'],
      ['refunded', 'fulfilled'],
      ['refunded', 'paid'],
      ['pending', 'refunded'],
      ['pending', 'fulfilled'],
      ['fulfilled', 'pending'],
      ['fulfilled', 'cancelled'],
      ['paid', 'pending'],
      ['paid', 'paid'],
    ] as const) {
      assert.equal(canMoveOrderStatus(from, to), false, `${from} → ${to}`);
    }
  });

  test('an unknown status moves nowhere', () => {
    assert.equal(canMoveOrderStatus('archived', 'paid'), false);
  });
});

describe('enforcement', () => {
  const orders = readFileSync(new URL('../../src/cms/modules/commerce/orders.ts', import.meta.url), 'utf8');

  test('the admin status route checks the move and makes it atomically from the status it checked', () => {
    const start = orders.indexOf('export function orderUpdateRoute(');
    const body = orders.slice(start, orders.indexOf('\n}\n', start));
    assert.match(body, /canMoveOrderStatus\(before\.status, input\.status\)/);
    assert.match(body, /updateOrderStatus\(id, input\.status, \{ onlyFrom: before\.status \}\)/);
  });

  test('the panel disables the moves the server would refuse', () => {
    const table = readFileSync(new URL('../../src/cms/admin/OrdersTable.tsx', import.meta.url), 'utf8');
    assert.match(table, /canMoveOrderStatus\(order\.status, st\)/);
  });
});
