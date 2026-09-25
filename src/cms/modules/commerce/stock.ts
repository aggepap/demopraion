/**
 * Order stock movements, applied after the money is confirmed.
 *
 * Stock used to be decremented inside the checkout transaction, before payment.
 * With a redirect gateway that means every abandoned payment quietly holds
 * units nobody bought, and ECOMMERCE.md flags moving it as part of wiring a
 * real provider. So checkout now only *checks* availability, and these
 * functions move it: once at capture, and back on a refund.
 *
 * Both are driven from `order_items`, which snapshots the product id, the
 * variation id and the quantity at purchase time — so a later price or catalogue
 * change cannot alter what a paid order takes off the shelf.
 */
import 'server-only';

import { and, eq } from 'drizzle-orm';

import { revalidateDocument } from '../../core';
import { getDb, schema } from '../../db';
import { DEFAULT_PRODUCT_TYPE } from './read';

export type RawVariation = { id?: string; stock?: number };

/** How many units of a product/variation are available in a data blob. */
export function availableStock(
  data: Record<string, unknown>,
  variationId: string | null | undefined,
): number {
  const limits: number[] = [];
  if (typeof data.stock === 'number') limits.push(data.stock);
  if (variationId && Array.isArray(data.variations)) {
    const v = (data.variations as RawVariation[]).find((x) => x.id === variationId);
    if (typeof v?.stock === 'number') limits.push(v.stock);
  }
  // No numeric stock anywhere means the product is not stock-tracked.
  return limits.length ? Math.min(...limits) : Infinity;
}

/**
 * Move a product/variation's stock by `delta` (negative to sell, positive to
 * restock). Product-level and matching-variation stock both move, because a
 * variation's stock is a subset of the product's.
 */
export function applyStockDelta(
  data: Record<string, unknown>,
  variationId: string | null | undefined,
  delta: number,
): Record<string, unknown> {
  const next = { ...data };
  if (typeof next.stock === 'number') next.stock = Math.max(0, next.stock + delta);
  if (variationId && Array.isArray(next.variations)) {
    next.variations = (next.variations as RawVariation[]).map((v) =>
      v.id === variationId && typeof v.stock === 'number'
        ? { ...v, stock: Math.max(0, v.stock + delta) }
        : v,
    );
  }
  return next;
}

interface StockMoveResult {
  /** Lines that could not be satisfied — empty when everything moved. */
  short: { name: string; available: number; wanted: number }[];
  /** True when stock actually moved (so a caller knows to revalidate/email). */
  moved: boolean;
  /**
   * Set when a sale was refused because the order was in one of the caller's
   * `unlessStatus` statuses: the status it was in. Nothing moved.
   */
  refusedStatus?: string;
}

interface StockMoveOptions {
  /**
   * Selling only: refuse, and take nothing, while the order is in one of these
   * statuses. Decided under the order's row lock, so it cannot race a
   * cancellation that lands between a caller's read and this move.
   */
  unlessStatus?: readonly string[];
}

/**
 * Apply an order's lines to stock, in one transaction, under `FOR UPDATE`.
 *
 * `direction` is -1 to sell and +1 to restock. Selling is refused outright if
 * ANY line is short — a partially-decremented order is a worse state than one
 * that failed cleanly, and the caller needs to refund the whole payment.
 * Restocking never refuses; the units are coming back regardless.
 */
async function moveOrderStock(
  orderId: number,
  direction: -1 | 1,
  opts: StockMoveOptions = {},
): Promise<StockMoveResult> {
  const db = getDb();
  const affected: { type: string; locale: string; slug: string; canonicalPath: string | null }[] = [];

  const result = await db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .for('update')
      .limit(1);
    if (!order) return { short: [], moved: false };
    if (direction === -1 && opts.unlessStatus?.includes(order.status)) {
      return { short: [], moved: false, refusedStatus: order.status };
    }

    /*
     * Whether this order's units are currently off the shelf.
     *
     * Recorded on the order rather than inferred from its status, because
     * status is not a reliable proxy: an offline order decrements at creation
     * while still `pending`, whereas a gateway order sitting at `pending` has
     * taken nothing. Cancelling those two must do opposite things, and only
     * this flag can tell them apart. It also makes both directions idempotent,
     * which matters because a refund can arrive from the admin AND from the
     * provider's webhook.
     */
    const metadata = (order.metadata ?? {}) as Record<string, unknown>;
    const taken = metadata.stockTaken === true;
    if (direction === -1 && taken) return { short: [], moved: false };
    if (direction === 1 && !taken) return { short: [], moved: false };

    const items = await tx
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, orderId));

    const short: StockMoveResult['short'] = [];
    const writes: { rowId: number; data: Record<string, unknown> }[] = [];

    for (const item of items) {
      // A deleted product nulls `product_id` (ON DELETE SET NULL). There is no
      // shelf left to put anything back on, so the line is skipped rather than
      // failing the whole movement.
      if (item.productId == null) continue;

      const [target] = await tx
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, item.productId))
        .for('update')
        .limit(1);
      if (!target) continue;

      // Stock is shared across a product's locale rows, so all of them move
      // together — and all are locked before any is written.
      const rows = await tx
        .select()
        .from(schema.documents)
        .where(
          and(eq(schema.documents.type, DEFAULT_PRODUCT_TYPE), eq(schema.documents.slug, target.slug)),
        )
        .for('update');

      const data = target.data as Record<string, unknown>;
      if (direction === -1) {
        const available = availableStock(data, item.variationId);
        if (available < item.quantity) {
          short.push({ name: item.name, available, wanted: item.quantity });
          continue;
        }
      }

      for (const row of rows) {
        writes.push({
          rowId: row.id,
          data: applyStockDelta(
            row.data as Record<string, unknown>,
            item.variationId,
            direction * item.quantity,
          ),
        });
        affected.push({
          type: row.type,
          locale: row.locale,
          slug: row.slug,
          canonicalPath: row.canonicalPath,
        });
      }
    }

    // All-or-nothing on the way out: nothing has been written yet, so returning
    // here leaves stock exactly as it was.
    if (direction === -1 && short.length > 0) return { short, moved: false };

    for (const w of writes) {
      await tx.update(schema.documents).set({ data: w.data }).where(eq(schema.documents.id, w.rowId));
    }

    // Flipped inside the same transaction as the writes, so the flag and the
    // stock it describes can never disagree.
    await tx
      .update(schema.orders)
      .set({ metadata: { ...metadata, stockTaken: direction === -1 } })
      .where(eq(schema.orders.id, orderId));

    return { short, moved: writes.length > 0 };
  });

  // Purge product caches so the storefront reflects the new stock.
  if (result.moved) {
    for (const row of affected) revalidateDocument(row);
  }
  return result;
}

/**
 * Take a paid order's units off the shelf.
 *
 * Returns the short lines when it could not: the caller refunds and cancels,
 * because the money has already moved by the time this runs.
 */
export function decrementStockForOrder(
  orderId: number,
  opts: StockMoveOptions = {},
): Promise<StockMoveResult> {
  return moveOrderStock(orderId, -1, opts);
}

/** Put a cancelled or refunded order's units back. */
export function restockOrder(orderId: number): Promise<StockMoveResult> {
  return moveOrderStock(orderId, 1);
}
