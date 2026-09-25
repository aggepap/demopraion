/**
 * The order total, in one place.
 *
 * `createOrder` and the admin `saveOrder` each computed it inline; a third copy
 * was about to arrive with gift cards. Everything here is minor units (integer
 * cents), and a fraction is refused rather than rounded — it means a caller
 * forgot to convert, and rounding would hide that.
 *
 * `tenders` are amounts already settled by something other than the order's
 * gateway (a gift card balance). They reduce `amountDue`, which is what the
 * gateway is asked to charge, and never `total`, which is what the order is
 * worth: the merchant's reports and the customer's receipt show the full price.
 *
 * Pure and dependency-free, so it is unit-tested directly.
 */

export interface OrderTotalsInput {
  subtotal: number;
  discount: number;
  shipping: number;
  surcharge: number;
  giftWrap: number;
  /** Amounts paid by other means, applied in order. */
  tenders?: readonly number[];
}

export interface OrderTotals {
  /** What the order is worth: `max(0, subtotal − discount + costs)`. */
  total: number;
  /** How much of `total` the tenders cover. Never more than `total`. */
  tendered: number;
  /** What is left for the payment provider to charge. */
  amountDue: number;
}

function assertMinor(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(
      `${name} must be a non-negative whole number of minor units, got ${value}.`
    );
  }
}

export function computeOrderTotals(input: OrderTotalsInput): OrderTotals {
  const { subtotal, discount, shipping, surcharge, giftWrap } = input;
  assertMinor('subtotal', subtotal);
  assertMinor('discount', discount);
  assertMinor('shipping', shipping);
  assertMinor('surcharge', surcharge);
  assertMinor('giftWrap', giftWrap);

  const total = Math.max(0, subtotal - discount + shipping + surcharge + giftWrap);

  let tendered = 0;
  for (const tender of input.tenders ?? []) {
    assertMinor('tender', tender);
    tendered += Math.min(tender, total - tendered);
  }

  return { total, tendered, amountDue: total - tendered };
}

export type OrderSummaryKey = 'subtotal' | 'discount' | 'shipping' | 'surcharge' | 'giftWrap' | 'total';

/**
 * The money lines under an order's items, as the order emails print them:
 * subtotal, then each charge that applies (discount negative), then the total.
 *
 * Every component of `computeOrderTotals` is here, so the lines above the total
 * add up to it — the emails used to leave out gift wrap, and did not. Reads
 * the `metadata.costs` of a stored order, so anything unparseable counts as 0.
 */
export function orderSummaryLines(order: {
  subtotal: number;
  total: number;
  costs: { discount?: unknown; shipping?: unknown; surcharge?: unknown; giftWrap?: unknown };
}): { key: OrderSummaryKey; cents: number }[] {
  const amount = (value: unknown) => Number(value) || 0;
  const lines: { key: OrderSummaryKey; cents: number }[] = [{ key: 'subtotal', cents: order.subtotal }];
  const discount = amount(order.costs.discount);
  if (discount > 0) lines.push({ key: 'discount', cents: -discount });
  for (const key of ['shipping', 'surcharge', 'giftWrap'] as const) {
    const cents = amount(order.costs[key]);
    if (cents > 0) lines.push({ key, cents });
  }
  lines.push({ key: 'total', cents: order.total });
  return lines;
}
