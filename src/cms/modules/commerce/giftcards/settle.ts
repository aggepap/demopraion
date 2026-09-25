import 'server-only';

import { eq } from 'drizzle-orm';

import { getDb, schema } from '../../../db';

/**
 * An order paid for entirely with gift cards.
 *
 * There is no gateway to wait for, so it settles immediately: stock leaves the
 * shelf and the order is paid. Kept apart from `orders.ts` to avoid a circular
 * import, and deliberately going through the same stock path as every other
 * settlement rather than a second copy of it.
 */
export async function settleFullyCoveredOrder(orderId: number): Promise<void> {
  const { decrementStockForOrder } = await import('../stock');
  await decrementStockForOrder(orderId);
  await getDb().update(schema.orders).set({ status: 'paid' }).where(eq(schema.orders.id, orderId));
  // Paid means any gift cards this order bought can be minted — with no
  // gateway, there is no webhook to do it later.
  try {
    const { issueGiftCardsForOrder } = await import('./service');
    await issueGiftCardsForOrder(orderId);
  } catch (err) {
    console.error('[commerce/giftcards] issue after full cover failed', orderId, err);
  }
}
