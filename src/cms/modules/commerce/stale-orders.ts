/**
 * Cancel gateway orders nobody paid for.
 *
 * A customer sent to a payment page who closes the tab leaves the order
 * `pending` for ever. Its stock is safe — a gateway order only takes stock when
 * the capture arrives — but anything else reserved at checkout is not, so
 * these orders get an end: after `ecommerce.pendingOrderTtlHours` they are
 * cancelled through `updateOrderStatus`, which releases whatever the order
 * held and tells the customer.
 *
 * Only orders whose every payment attempt was ONLINE qualify. A manual
 * (bank transfer / pay on delivery) order is legitimately pending until the
 * money arrives, and an order with any authorized or captured payment has
 * money attached that a person has to look at.
 */
import 'server-only';

import { and, eq, exists, inArray, lte, notExists, or } from 'drizzle-orm';

import { getSetting } from '../../core/settings';
import { getDb, schema } from '../../db';
import type { OrderStatus, PaymentStatus } from '../../db/adapters/mysql/schema/commerce';
import { updateOrderStatus } from './orders';

/** The `site_settings` key: hours before an unpaid gateway order is cancelled. */
export const PENDING_ORDER_TTL_KEY = 'ecommerce.pendingOrderTtlHours';
export const DEFAULT_PENDING_ORDER_TTL_HOURS = 48;

/** The offline provider's key (`manualProvider.key`); a literal so the planner
 *  does not pull the payment registry into its tests. */
const OFFLINE_PROVIDER = 'manual';
const MONEY_ATTACHED_STATUSES = [
  'authorized',
  'captured',
] as const satisfies readonly PaymentStatus[];
const MONEY_ATTACHED: ReadonlySet<PaymentStatus> = new Set(MONEY_ATTACHED_STATUSES);

/** Whole hours, 0 = off. Anything unreadable is the default, never "off" or "now". */
export function parsePendingOrderTtlHours(raw: unknown): number {
  if (typeof raw !== 'string' || !/^\d{1,5}$/.test(raw.trim())) {
    return DEFAULT_PENDING_ORDER_TTL_HOURS;
  }
  return Number(raw.trim());
}

export interface StaleOrderCandidate {
  id: number;
  status: OrderStatus;
  createdAt: Date;
  payments: { provider: string; status: PaymentStatus }[];
}

export function planStaleOrderCancellations(
  orders: readonly StaleOrderCandidate[],
  opts: { now: Date; ttlHours: number }
): number[] {
  if (opts.ttlHours <= 0) return [];
  const cutoff = opts.now.getTime() - opts.ttlHours * 3_600_000;
  return orders
    .filter(
      (o) =>
        o.status === 'pending' &&
        o.createdAt.getTime() <= cutoff &&
        o.payments.length > 0 &&
        o.payments.every((p) => p.provider !== OFFLINE_PROVIDER && !MONEY_ATTACHED.has(p.status))
    )
    .map((o) => o.id);
}

/** Upper bound on one run, so a backlog is worked through over several runs. */
const BATCH = 200;

/** The job: find, plan, cancel. One failed cancellation does not stop the rest. */
export async function cancelStaleOrders(): Promise<{ checked: number; cancelled: number[] }> {
  const ttlHours = parsePendingOrderTtlHours(await getSetting(PENDING_ORDER_TTL_KEY));
  if (ttlHours === 0) return { checked: 0, cancelled: [] };

  const now = new Date();
  const db = getDb();
  const paymentsOf = eq(schema.payments.orderId, schema.orders.id);
  /*
   * The planner's rules are repeated in SQL so the batch only ever holds real
   * candidates. Selecting "the 200 oldest pending orders" and filtering after
   * would stall for good once 200 manual orders sat at the front of the queue.
   */
  const rows = await db
    .select({
      id: schema.orders.id,
      status: schema.orders.status,
      createdAt: schema.orders.createdAt,
    })
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.status, 'pending'),
        lte(schema.orders.createdAt, new Date(now.getTime() - ttlHours * 3_600_000)),
        exists(db.select({ id: schema.payments.id }).from(schema.payments).where(paymentsOf)),
        notExists(
          db
            .select({ id: schema.payments.id })
            .from(schema.payments)
            .where(
              and(
                paymentsOf,
                or(
                  eq(schema.payments.provider, OFFLINE_PROVIDER),
                  inArray(schema.payments.status, [...MONEY_ATTACHED_STATUSES])
                )
              )
            )
        )
      )
    )
    .orderBy(schema.orders.id)
    .limit(BATCH);
  if (rows.length === 0) return { checked: 0, cancelled: [] };

  const payments = await db
    .select({
      orderId: schema.payments.orderId,
      provider: schema.payments.provider,
      status: schema.payments.status,
    })
    .from(schema.payments)
    .where(
      inArray(
        schema.payments.orderId,
        rows.map((r) => r.id)
      )
    );

  const candidates: StaleOrderCandidate[] = rows.map((r) => ({
    ...r,
    payments: payments.filter((p) => p.orderId === r.id),
  }));
  const ids = planStaleOrderCancellations(candidates, { now, ttlHours });

  const cancelled: number[] = [];
  for (const id of ids) {
    try {
      // Conditional: a capture that landed since the query wins.
      if (await updateOrderStatus(id, 'cancelled', { onlyFrom: 'pending' })) cancelled.push(id);
    } catch (err) {
      console.error('[commerce/stale-orders] could not cancel order', id, err);
    }
  }
  return { checked: rows.length, cancelled };
}
