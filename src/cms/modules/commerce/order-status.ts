/**
 * Which order statuses an admin may move an order to, from where.
 *
 * The lifecycle in docs/dev-guides/08-commerce.md §4.5, as a map. Enforced by
 * the admin status route (`orderUpdateRoute`) and followed by the status pills
 * in `OrdersTable`, which disable the moves not listed here.
 *
 * Only the ADMIN's moves are limited. The system's own moves (the capture
 * webhook, the stale-order job, a refund) call `updateOrderStatus` directly with
 * their own `onlyFrom` / `unlessAlready` guards.
 *
 * - `paid → cancelled` is allowed: an order that cannot be filled is called
 *   off, and the payment is then refunded under Payments (the confirmation says
 *   so).
 * - `cancelled` and `refunded` are final. Both put the stock back and return
 *   gift card balances; reopening them would not take either again.
 *
 * Pure and client-safe (no schema import): the admin component imports it.
 */

/** Mirrors `orderStatusValues` in the commerce schema. */
export type OrderStatus = 'pending' | 'paid' | 'fulfilled' | 'cancelled' | 'refunded';

export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ['paid', 'cancelled'],
  paid: ['fulfilled', 'refunded', 'cancelled'],
  fulfilled: ['refunded'],
  cancelled: [],
  refunded: [],
};

/** May an admin move an order from `from` to `to`? Staying put is not a move. */
export function canMoveOrderStatus(from: string, to: string): boolean {
  const allowed = (ORDER_STATUS_TRANSITIONS as Record<string, readonly string[] | undefined>)[from];
  return allowed?.includes(to) ?? false;
}
