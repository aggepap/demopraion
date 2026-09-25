/**
 * What the admin order panel may offer, decided on the server.
 *
 * Pure: the rows come from the database and the provider registry, the rules
 * live here. The panel receives the answers (`refundable` per payment) rather
 * than working them out, because "may this be refunded" is not a UI decision.
 */
import { refundedSoFar } from '../../core/payments/refunds';

interface PaymentLike {
  provider: string;
  status: string;
  amount: number;
  metadata?: unknown;
}

/**
 * How much of this payment can still go back through its gateway.
 *
 * Only a CAPTURED payment, from a provider that can refund online, and only
 * what is left of it after earlier refunds. A manual payment and a gift card
 * redemption are settled outside the gateway, so both answer 0.
 */
export function refundableAmount(payment: PaymentLike, canRefund: (provider: string) => boolean): number {
  if (payment.status !== 'captured') return 0;
  if (payment.amount <= 0) return 0;
  if (!canRefund(payment.provider)) return 0;
  const metadata = (payment.metadata ?? null) as Record<string, unknown> | null;
  return Math.max(0, payment.amount - refundedSoFar(metadata));
}

/**
 * Where the order goes after a refund went through.
 *
 * Only a payment refunded in full makes the order `refunded`: that transition
 * restocks every line, gives back gift card balances and emails the customer,
 * none of which is true after a partial refund.
 */
export function orderStatusAfterRefund(result: { remaining: number }): 'refunded' | null {
  return result.remaining <= 0 ? 'refunded' : null;
}

/**
 * Order statuses that are closed: nothing is sold on them any more. A capture
 * that lands on one of these must not revive it (see `settleCapturedOrder`).
 */
export const CLOSED_ORDER_STATUSES = ['cancelled', 'refunded'] as const;

/**
 * Written to `orders.metadata.refundRequired` when the gateway took money for an
 * order that will not be filled: the capture arrived after the order was closed
 * (`captured_after_close`), or the stock had run out (`stock_short`).
 */
export interface RefundRequiredNote {
  at: string;
  reason: 'captured_after_close' | 'stock_short';
  provider?: string;
  providerRef?: string;
  /** The order's status when the capture arrived. */
  orderStatus?: string;
}

/**
 * The refund an admin still owes on this order, or null.
 *
 * Owed while the order is flagged AND some payment can still be refunded; once
 * the admin has refunded it (from Payments), `refundable` drops to 0 and the
 * notice goes away by itself.
 */
export function refundStillOwed(
  metadata: unknown,
  payments: readonly { refundable: number }[],
): RefundRequiredNote | null {
  const note = ((metadata ?? {}) as { refundRequired?: RefundRequiredNote }).refundRequired;
  if (!note || typeof note !== 'object') return null;
  return payments.some((p) => p.refundable > 0) ? note : null;
}

/** The gift cards that paid for an order, from its `payments` rows. */
export function giftCardAmountsUsed(
  payments: readonly { provider: string; status: string; amount: number; providerRef: string | null }[],
): { cards: { giftCardId: number; amount: number }[]; total: number } {
  const cards = payments
    .filter((p) => p.provider === 'giftcard' && p.status === 'captured' && p.amount > 0)
    .map((p) => ({
      giftCardId: Number(String(p.providerRef ?? '').replace(/^giftcard:/, '')) || 0,
      amount: p.amount,
    }));
  return { cards, total: cards.reduce((sum, c) => sum + c.amount, 0) };
}

/** An order line as the admin editor saves it (prices already in minor units). */
export interface EditedOrderLine {
  /** The stored line this was, when the editor kept an existing one. */
  id?: number;
  name: string;
  sku: string | null;
  variantLabel: string | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  productId: number | null;
}

export interface StoredOrderLine {
  id: number;
  productId: number | null;
  variationId: string | null;
  snapshot: Record<string, unknown> | null;
}

export type OrderLineValues = Omit<EditedOrderLine, 'id'> & { variationId: string | null; snapshot: Record<string, unknown> | null };

/**
 * How an admin save changes an order's lines: which stored lines are updated in
 * place, which are new, and which were dropped.
 *
 * A save used to delete every line and insert the editor's list, so each line
 * lost its `snapshot` and `variationId` — and with them the gift card a line
 * bought (`snapshot.giftCard`, read when the order is paid) and the variation a
 * refund restocks. A line the editor sends back with its id keeps both, and its
 * id, which is also what a minted gift card is keyed on.
 *
 * An id that is not one of THIS order's lines, a second copy of the same id, or
 * a line pointed at a different product is a new line: it carries nothing over,
 * exactly as a manually added line always has.
 */
export function planOrderLines(
  stored: readonly StoredOrderLine[],
  edited: readonly EditedOrderLine[],
): { update: { id: number; values: OrderLineValues }[]; insert: OrderLineValues[]; remove: number[] } {
  const byId = new Map(stored.map((line) => [line.id, line]));
  const kept = new Set<number>();
  const update: { id: number; values: OrderLineValues }[] = [];
  const insert: OrderLineValues[] = [];

  for (const { id, ...line } of edited) {
    const previous = id != null && !kept.has(id) ? byId.get(id) : undefined;
    const sameProduct = previous != null && (line.productId == null || line.productId === previous.productId);
    if (previous && sameProduct) {
      kept.add(previous.id);
      update.push({
        id: previous.id,
        values: {
          ...line,
          productId: previous.productId,
          variationId: previous.variationId,
          snapshot: previous.snapshot,
        },
      });
    } else {
      insert.push({ ...line, variationId: null, snapshot: null });
    }
  }

  return { update, insert, remove: stored.filter((line) => !kept.has(line.id)).map((line) => line.id) };
}
