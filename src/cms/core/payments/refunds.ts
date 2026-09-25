/**
 * Refund bookkeeping shared by both payment tables.
 *
 * ## The problem this exists for
 *
 * Both refund paths — `modules/commerce/payments.ts` for orders and
 * `modules/booking/payments.ts` for reservations — read the captured row, check
 * `status === 'captured'`, call the provider, and then insert a separate
 * negative-amount `refunded` row. The capture row is deliberately never mutated:
 * a capture and a refund are two events, and the payment history should say what
 * happened rather than only where it ended up.
 *
 * The consequence nobody intended is that `status === 'captured'` stays true
 * forever, so it is not a guard. Two refund requests for the same payment both
 * read `captured`, both pass, and both call the gateway; the only thing that
 * refuses the second one is the provider, if it happens to. There was no
 * transaction and no row lock either, so it did not even need two clicks to be
 * simultaneous.
 *
 * ## How it is fixed
 *
 * How much of a payment has already been sent back is recorded on the capture row
 * itself, under `metadata.refundedAmount`, and it is written **inside a
 * transaction that locked the row, before the provider is called**. A second
 * request blocks on the lock, then reads the amount the first one claimed and has
 * nothing left to refund. `metadata` is a JSON column that already carries
 * `captureId`, so this needs no migration — and unlike flipping `status`, it
 * keeps partial refunds coherent: a 3000-cent capture refunded 1000 twice has
 * 1000 left, which a boolean could not express.
 *
 * Pure functions only, matching the rest of `core/payments` — the two modules own
 * their own tables and do their own locking; this owns the arithmetic and the
 * rules, and `test/core/refunds.test.ts` covers them.
 */
import { conflict } from '../errors';

/** The key `refundedAmount` lives under on a capture row's `metadata`. */
export const REFUNDED_AMOUNT_KEY = 'refundedAmount';

type Metadata = Record<string, unknown> | null | undefined;

/**
 * How much of this capture has already been refunded (or claimed by a refund in
 * flight), in minor units.
 *
 * Tolerant of anything unexpected in the column: a missing key, a string written
 * by an older code path, a negative number. Nonsense reads as zero, so the worst
 * case is that a refund is *allowed*, which is the pre-existing behaviour, rather
 * than a legitimate refund being refused because a JSON column had junk in it.
 */
export function refundedSoFar(metadata: Metadata): number {
  const raw = (metadata ?? {})[REFUNDED_AMOUNT_KEY];
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** The capture row's `metadata` with the claim recorded. */
export function withRefundClaim(metadata: Metadata, refundedTotal: number): Record<string, unknown> {
  return { ...(metadata ?? {}), [REFUNDED_AMOUNT_KEY]: refundedTotal };
}

/**
 * Decide how much of `capturedAmount` a refund request may take, given what has
 * already gone back.
 *
 * `requested` undefined means "all of it" — which now means all of what is
 * *left*, not all of the original capture. Throws the same conflicts the two
 * modules threw inline, so their behaviour on a bad request is unchanged.
 */
export function resolveRefundAmount(args: {
  capturedAmount: number;
  alreadyRefunded: number;
  requested?: number;
}): number {
  const remaining = args.capturedAmount - args.alreadyRefunded;
  if (remaining <= 0) {
    throw conflict('That payment has already been refunded in full.');
  }
  const amount = args.requested != null ? Math.min(args.requested, remaining) : remaining;
  if (amount <= 0) throw conflict('A refund must be for more than nothing.');
  return amount;
}

/**
 * Where a capture stands after the PROVIDER reports a refund on it (a webhook).
 *
 * `reportedTotal` is the running total the provider says has gone back on this
 * capture, in minor units, when the event states one. The larger of it and what
 * this site already claimed wins: the admin's claim is written before the
 * gateway is called, so the webhook for that refund reports no more than the
 * claim and adds nothing (no double count, replays included), while a refund
 * made in the provider's own dashboard raises the total past it.
 *
 * With no stated total, the claim stands if there is one — the refund came from
 * here — and otherwise the whole capture is taken as refunded, which is what
 * every refund event used to mean.
 */
export function reconcileProviderRefund(args: {
  capturedAmount: number;
  metadata: Metadata;
  reportedTotal?: number;
}): { refundedTotal: number; remaining: number } {
  const claimed = refundedSoFar(args.metadata);
  const reported =
    args.reportedTotal != null && Number.isFinite(args.reportedTotal) && args.reportedTotal > 0
      ? Math.floor(args.reportedTotal)
      : null;
  const total = reported != null ? Math.max(claimed, reported) : claimed > 0 ? claimed : args.capturedAmount;
  const refundedTotal = Math.min(total, args.capturedAmount);
  return { refundedTotal, remaining: Math.max(0, args.capturedAmount - refundedTotal) };
}

/**
 * Which metadata key holds the id a provider's refund call must be pointed at,
 * for providers where that is NOT the payment row's own `provider_ref`.
 *
 * Viva keys the row by its ORDER CODE (what `start()` returns and the webhook
 * matches on), but its refund call — `DELETE /api/transactions/{id}` — takes the
 * TRANSACTION id, which the webhook stores as `metadata.transactionId` when it
 * confirms the capture. There is no fallback for Viva: the order code is never a
 * valid refund target, so a row without a transaction id cannot be refunded
 * online.
 */
const REFUND_TARGET_KEY: Record<string, string> = { viva: 'transactionId' };

/**
 * The id to pass as `providerRef` to `provider.refund`, from a capture row —
 * the orders' `payments` row or the reservations' `reservation_payments` row.
 *
 * - Viva: `metadata.transactionId`, or null when it was never recorded.
 * - Everyone else: `metadata.captureId` when present (PayPal refunds the
 *   capture, recorded by the webhook), otherwise the row's `provider_ref`
 *   (Stripe refunds the PaymentIntent, which is the row's ref).
 *
 * Null means there is nothing valid to refund against; the caller refuses.
 */
export function refundTargetRef(row: {
  provider: string;
  providerRef: string | null;
  metadata: Metadata | unknown;
}): string | null {
  const metadata = (row.metadata ?? {}) as Record<string, unknown>;
  const read = (key: string): string | null => {
    const value = metadata[key];
    return typeof value === 'string' && value ? value : null;
  };
  const key = REFUND_TARGET_KEY[row.provider];
  if (key) return read(key);
  return read('captureId') ?? (row.providerRef || null);
}
