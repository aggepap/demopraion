/**
 * The rules behind the reservation drawer's money actions — resend a payment
 * link, record a payment, refund one.
 *
 * Pure, and imported by BOTH sides: the drawer decides what to offer with these
 * and the routes decide what to accept with the same functions, so a button the
 * API would refuse is never shown and a request the button would never send is
 * still refused. No `server-only`, no DB, no `next/*`.
 */
import { refundedSoFar } from '../../core/payments/refunds';
import type { ReservationStatus } from '../../db/adapters/mysql/schema/booking';

export interface MoneyState {
  status: ReservationStatus | string;
  total: number;
  amountPaid: number;
  /** The payment deadline, if any. A JSON payload carries it as a string. */
  expiresAt?: Date | string | null;
}

/** What is still owed on the booking, in minor units. Never negative. */
export function balanceDue(r: Pick<MoneyState, 'total' | 'amountPaid'>): number {
  return Math.max(0, r.total - r.amountPaid);
}

function isWholePositive(amount: number): boolean {
  return Number.isInteger(amount) && amount > 0;
}

/** Is the booking waiting for money right now — the state a payment link pays into? */
function awaitsMoney(r: MoneyState): boolean {
  return r.status === 'awaiting_payment' || (r.status === 'confirmed' && balanceDue(r) > 0);
}

/**
 * Why a payment link may not be (re)issued, or null when it may.
 *
 * An unanswered request is allowed: issuing its first link IS accepting it, and
 * `issuePaymentLink` promotes it. Anything paid, cancelled or expired is refused,
 * as is a booking whose deadline has passed — the sweep may not have run yet, but
 * its held date has already stopped counting, so reviving the link could sell a
 * date that is back on sale.
 */
export function paymentLinkRefusal(r: MoneyState, now: Date): string | null {
  if (r.status === 'pending') return null;
  if (!awaitsMoney(r)) return 'Only a booking that is awaiting payment can be sent a payment link.';
  if (r.status === 'awaiting_payment' && r.expiresAt != null) {
    const deadline = new Date(r.expiresAt);
    if (!Number.isNaN(deadline.getTime()) && deadline <= now) {
      return 'The payment deadline for this booking has passed.';
    }
  }
  return null;
}

/**
 * Whether the drawer offers "Resend payment link".
 *
 * Narrower than the route: an unanswered request gets its first link from
 * "Accept", which is the drawer's primary action, so offering a second button
 * that does the same thing under another name would only confuse.
 */
export function canResendPaymentLink(r: MoneyState, now: Date): boolean {
  return r.status !== 'pending' && paymentLinkRefusal(r, now) === null;
}

/**
 * What a (re)issued link asks for, in minor units — the threshold the customer
 * pays up to, not the amount due (that is this minus what is already paid).
 *
 * A confirmed booking has cleared its deposit, so its link collects the rest:
 * asking for the deposit again would open a pay page with nothing due on it.
 */
export function paymentLinkAmount(r: Pick<MoneyState, 'status' | 'total'>, deposit: number): number {
  return r.status === 'confirmed' ? r.total : deposit;
}

/** Why a manually recorded payment is refused, or null when it is fine. */
export function recordPaymentRefusal(r: MoneyState, amount: number): string | null {
  if (r.status === 'cancelled' || r.status === 'expired') {
    return 'A cancelled or expired booking cannot take a payment.';
  }
  const due = balanceDue(r);
  if (r.status === 'paid' || due <= 0) return 'This booking is already paid in full.';
  if (!isWholePositive(amount)) return 'Enter an amount greater than zero.';
  if (amount > due) return 'That is more than the balance due.';
  return null;
}

/**
 * `recordPaymentRefusal`, split the way the route answers it: a dead or settled
 * booking is a state problem (409), a bad figure for a live one is the
 * operator's input (400). Evaluated on the reservation read UNDER ITS LOCK, so
 * two simultaneous records cannot both pass against the same balance.
 */
export function manualPaymentRefusal(
  r: MoneyState,
  amount: number,
): { kind: 'conflict' | 'bad_request'; message: string } | null {
  const state = recordPaymentRefusal(r, 1);
  if (state) return { kind: 'conflict', message: state };
  const figure = recordPaymentRefusal(r, amount);
  if (figure) return { kind: 'bad_request', message: figure };
  return null;
}

/** Whether the drawer offers "Record payment". */
export function canRecordPayment(r: MoneyState): boolean {
  return recordPaymentRefusal(r, 1) === null;
}

export interface PaymentRowLike {
  status: string;
  amount: number;
  metadata?: Record<string, unknown> | null;
}

/**
 * How much of one payment row can still be refunded online, in minor units.
 *
 * Only a captured, positive row through a provider that can refund on its own
 * (`canRefundOnline`) — a bank transfer is reversed at the bank, and a refund
 * row is the refund, not something to refund again.
 */
export function refundableAmount(row: PaymentRowLike, canRefundOnline: boolean): number {
  if (!canRefundOnline || row.status !== 'captured' || row.amount <= 0) return 0;
  return Math.max(0, row.amount - refundedSoFar(row.metadata));
}

/**
 * Why a refund request is refused, or null.
 *
 * `requested` undefined means "everything that is left". An amount above what
 * is left is refused rather than quietly capped: the operator typed a figure,
 * and refunding a different one without saying so is how money goes missing.
 */
export function refundRefusal(remaining: number, requested: number | undefined): string | null {
  if (remaining <= 0) return 'There is nothing left to refund on that payment.';
  if (requested === undefined) return null;
  if (!isWholePositive(requested)) return 'Enter an amount greater than zero.';
  if (requested > remaining) return 'That is more than is left to refund on that payment.';
  return null;
}

/**
 * What an operator typed in major units (`120`, `99.90`, `99,90`) → minor units.
 *
 * Null for anything that is not a plain non-negative amount with at most two
 * decimals — the caller shows a message rather than guessing.
 */
export function parseMoneyInput(text: string): number | null {
  const cleaned = text.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const minor = Math.round(Number(cleaned) * 100);
  return Number.isFinite(minor) ? minor : null;
}

/**
 * What "Mark paid" does: record the outstanding balance as a manual payment, or
 * — when nothing is owed — just move the status.
 *
 * It used to PATCH the status to `paid` and nothing else, so a booking reported
 * paid with no `reservation_payments` row and an `amount_paid` still at zero:
 * the balance, the refund figures and every report disagreed with the badge.
 */
export function markPaidPlan(
  r: Pick<MoneyState, 'status' | 'total' | 'amountPaid'>,
): { kind: 'record'; amount: number } | { kind: 'status' } {
  const due = balanceDue(r);
  return due > 0 ? { kind: 'record', amount: due } : { kind: 'status' };
}

/* ── "Needs action": money that arrived and could not be applied ─────────── */

/**
 * Why a booking has been flagged for a human.
 *
 * - `hold_lapsed`: the payment landed after the hold on the date had expired
 *   (or been released by the sweep) — the date may have been sold again.
 * - `no_capacity`: the hold was live but the date no longer has room for it
 *   (its capacity was lowered after the hold was taken).
 * - `booking_closed`: the booking was already cancelled or expired.
 *
 * In every case the payment is recorded but NOT credited to the booking, and
 * the operator refunds it or rebooks the customer by hand.
 */
export type AttentionReason = 'hold_lapsed' | 'no_capacity' | 'booking_closed';

export interface ReservationAttention {
  reason: AttentionReason;
  /** Minor units received. */
  amount: number;
  provider: string;
  /** ISO timestamp. */
  at: string;
}

/** The reservation's `metadata` with the attention flag set. */
export function withAttention(
  metadata: Record<string, unknown> | null | undefined,
  attention: ReservationAttention,
): Record<string, unknown> {
  return { ...(metadata ?? {}), attention };
}

/** The reservation's `metadata` with the attention flag removed. */
export function withoutAttention(metadata: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const rest = { ...(metadata ?? {}) };
  delete rest.attention;
  return rest;
}

/** The flag, if the booking carries one. */
export function readAttention(metadata: Record<string, unknown> | null | undefined): ReservationAttention | null {
  const raw = metadata?.attention;
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  if (typeof a.reason !== 'string') return null;
  return {
    reason: a.reason as AttentionReason,
    amount: Number(a.amount) || 0,
    provider: typeof a.provider === 'string' ? a.provider : '',
    at: typeof a.at === 'string' ? a.at : '',
  };
}

export function needsAttention(metadata: Record<string, unknown> | null | undefined): boolean {
  return readAttention(metadata) !== null;
}

/** The drawer's words for each reason. */
export const ATTENTION_MESSAGES: Record<AttentionReason, string> = {
  hold_lapsed:
    'A payment arrived after the hold on this date had lapsed, so the booking was not confirmed — the date may already be taken. Refund the payment, or rebook the customer by hand.',
  no_capacity:
    'A payment arrived but the date no longer has room for this booking, so it was not confirmed. Refund the payment, or rebook the customer by hand.',
  booking_closed:
    'A payment arrived for a booking that was already cancelled or expired. It was recorded but not credited. Refund it, or rebook the customer by hand.',
};
