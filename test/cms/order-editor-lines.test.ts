/**
 * The order editor sends each existing line back with its id and product, so a
 * save keeps the line (and its gift card / variation) instead of replacing it.
 */
import '../setup/react-global';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { editItemsFromOrder, editItemsPayload } from '@/cms/admin/OrdersTable';

describe('the order editor line round-trip', () => {
  const stored = [
    { id: 11, name: 'Gift card', sku: null, variantLabel: null, unitPrice: 5000, quantity: 1, lineTotal: 5000, productId: 9 },
  ];

  test('an existing line goes back with its id and product', () => {
    const [sent] = editItemsPayload(editItemsFromOrder(stored));
    assert.equal(sent.id, 11);
    assert.equal(sent.productId, 9);
    assert.equal(sent.unitPrice, 50);
  });

  test('a line added in the editor goes back without an id', () => {
    const [sent] = editItemsPayload([
      { name: ' New ', sku: '', variantLabel: '', unitPrice: 12, quantity: 1, productId: 4 },
    ]);
    assert.equal(sent.id, undefined);
    assert.equal(sent.name, 'New');
    assert.equal(sent.productId, 4);
  });
});

describe('saving an order keeps the lines the editor kept', () => {
  const orders = readFileSync(new URL('../../src/cms/modules/commerce/orders.ts', import.meta.url), 'utf8');
  const start = orders.indexOf('export async function saveOrder(');
  const body = orders.slice(start, orders.indexOf('\nexport ', start + 1));

  test('the save plans its lines against the stored ones instead of deleting them all', () => {
    assert.match(body, /planOrderLines\(/);
    assert.doesNotMatch(body, /tx\.delete\(schema\.orderItems\)\.where\(eq\(schema\.orderItems\.orderId, orderId\)\)/);
  });

  test('the edit body accepts a line id', () => {
    const schemaStart = orders.indexOf('const orderEditBody');
    const schemaText = orders.slice(schemaStart, orders.indexOf('});\n', schemaStart));
    assert.match(schemaText, /id: z\.coerce\.number\(\)\.int\(\)\.positive\(\)\.optional\(\)/);
  });
});
