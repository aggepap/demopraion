/**
 * The reservation status machine — pure, so both flows are provably the same
 * machine entered at different points.
 *
 *   request mode:      pending ──accept──► awaiting_payment ──paid──► paid
 *   instant + gateway:                     awaiting_payment ──paid──► paid
 *   instant, no gateway:                   confirmed   (pay on arrival)
 *                          ↘ cancel / expire ↙
 *                         cancelled  ·  expired
 *
 * The single `awaiting_payment` status is what lets instant checkout reuse the
 * entire pay-later path — link, token, receipt, expiry sweep — instead of
 * growing a parallel one.
 */
import type { BookingModeValue, HoldState, ReservationStatus } from '../../db/adapters/mysql/schema/booking';

export const RESERVATION_STATUSES = [
  'pending',
  'awaiting_payment',
  'confirmed',
  'paid',
  'cancelled',
  'expired',
] as const;

/**
 * Allowed moves.
 *
 * Nothing returns to `pending`: past that point a live bearer token exists in
 * the customer's inbox, and walking the status back would leave a working
 * payment link pointing at a reservation they were told was cancelled.
 *
 * A refund is a `reservation_payments` row, not a status — the reservation
 * itself becomes `cancelled`.
 */
export const RESERVATION_TRANSITIONS: Record<ReservationStatus, readonly ReservationStatus[]> = {
  pending: ['awaiting_payment', 'confirmed', 'cancelled', 'expired'],
  awaiting_payment: ['paid', 'confirmed', 'cancelled', 'expired'],
  confirmed: ['awaiting_payment', 'paid', 'cancelled'],
  paid: ['cancelled'],
  cancelled: [],
  expired: [],
};

export function canTransition(from: ReservationStatus, to: ReservationStatus): boolean {
  return RESERVATION_TRANSITIONS[from]?.includes(to) ?? false;
}

export function allowedTransitions(from: ReservationStatus): readonly ReservationStatus[] {
  return RESERVATION_TRANSITIONS[from] ?? [];
}

/** A terminal reservation is finished; nothing further can happen to it. */
export function isTerminal(status: ReservationStatus): boolean {
  return allowedTransitions(status).length === 0;
}

/**
 * What a status means to the seat ledger — the single source of truth for it.
 *
 * `pending` holding NOTHING is the whole of request mode: several people may ask
 * about one date, and the date is only consumed when the operator accepts.
 */
export function holdStateFor(status: ReservationStatus): HoldState | null {
  switch (status) {
    case 'pending':
      return null; // an enquiry, not a claim
    case 'awaiting_payment':
      return 'held';
    case 'confirmed':
    case 'paid':
      return 'confirmed';
    case 'cancelled':
    case 'expired':
      return 'released';
  }
}

/** Does moving to this status take the date away from everyone else? */
export function consumesCapacity(status: ReservationStatus): boolean {
  const state = holdStateFor(status);
  return state === 'held' || state === 'confirmed';
}

/**
 * Where a reservation enters the machine.
 *
 * Instant mode with no real gateway still confirms outright and takes the date —
 * the customer is told how to pay afterwards. The date being genuinely taken is
 * the part that matters; wiring a gateway later changes which branch runs, not
 * the model.
 */
export function initialStatus(mode: BookingModeValue, hasOnlinePayment: boolean): ReservationStatus {
  if (mode === 'instant') return hasOnlinePayment ? 'awaiting_payment' : 'confirmed';
  return 'pending';
}

/**
 * When a booking an OPERATOR moved to `awaiting_payment` must be paid by.
 *
 * The payment link's lifetime, in days. It used to inherit the instant-checkout
 * hold — 20 minutes, sized for a customer already sitting on the payment page —
 * so an accepted request could be swept away before the customer had even opened
 * the approval email. An accepted booking and its link now end together.
 */
export function operatorPaymentDeadline(now: Date, linkTtlDays: number): Date {
  return new Date(now.getTime() + linkTtlDays * 86_400_000);
}

/**
 * The payment deadline a status move leaves on the reservation, or null.
 *
 * Only a move that leaves the date merely HELD gets one — accepting a request
 * (`pending → awaiting_payment`) is the case it exists for. A confirmed or paid
 * booking moved back to `awaiting_payment` (to collect a balance, say) keeps its
 * confirmed holds, and used to be given a deadline anyway: the expiry sweep then
 * expired a booking whose date had been confirmed, releasing it for sale.
 */
export function paymentDeadlineForMove(
  from: ReservationStatus,
  to: ReservationStatus,
  deadline: Date,
): Date | null {
  if (holdStateFor(to) !== 'held') return null;
  if (holdStateFor(from) === 'confirmed') return null;
  return deadline;
}

/**
 * Whether issuing a payment link may (re)set the reservation's payment deadline,
 * given the state of its holds.
 *
 * Only while it is awaiting payment on a date that is not yet confirmed: once
 * every hold is confirmed the date is the customer's, and a deadline would only
 * let the expiry sweep take it away again.
 */
export function holdsKeepDeadline(status: ReservationStatus, holdStates: readonly string[]): boolean {
  if (status !== 'awaiting_payment') return false;
  return !(holdStates.length > 0 && holdStates.every((state) => state === 'confirmed'));
}

export type ReservationEmail =
  | 'request_received'
  | 'admin_new_request'
  | 'payment_link'
  | 'confirmed'
  | 'receipt'
  | 'cancelled'
  | 'expired';

/**
 * Which customer email a transition triggers, if any.
 *
 * `expired` always mails: silence after someone asked for a date is worse than
 * one more email.
 */
export function emailForTransition(
  from: ReservationStatus,
  to: ReservationStatus,
): ReservationEmail | null {
  if (to === from) return null;
  switch (to) {
    case 'awaiting_payment':
      return 'payment_link';
    case 'confirmed':
      return 'confirmed';
    case 'paid':
      return 'receipt';
    case 'cancelled':
      return 'cancelled';
    case 'expired':
      return 'expired';
    default:
      return null;
  }
}

/**
 * Which customer email a NEW reservation owes, given where it entered.
 *
 * A new row is not a transition, so `emailForTransition` never sees it and the
 * send site used to branch on `pending` alone — which mailed an unpaid instant
 * booking "your booking is confirmed" while its hold was still ticking down.
 * Every entry status `initialStatus` can produce is answered here.
 */
export function emailForNewReservation(status: ReservationStatus): ReservationEmail {
  if (status === 'pending') return 'request_received';
  if (status === 'awaiting_payment') return 'payment_link';
  return 'confirmed';
}

/** Human wording for a status, for the admin and the customer lookup. */
export const RESERVATION_STATUS_LABELS: Record<ReservationStatus, string> = {
  pending: 'Awaiting your reply',
  awaiting_payment: 'Awaiting payment',
  confirmed: 'Confirmed',
  paid: 'Paid',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

/**
 * The booked dates as a guest reads them: one date for transport, and for a
 * stay `check-in → check-out (N nights)`.
 *
 * The emails, the guest lookup and the pay page all printed the check-in alone,
 * so a fortnight and a single night read the same. Pure and dependency-free so
 * the server email and the client lookup share it; `format` lets each render
 * the dates its own way (the email's long date, the page's ISO date).
 */
export function bookedDatesText(
  r: { slotDate: string; endDate?: string | null; nights?: number | null },
  locale: string,
  format: (isoDate: string) => string = (d) => d,
): string {
  const nights = Number(r.nights ?? 0);
  if (nights <= 0 || !r.endDate) return format(r.slotDate);
  const word =
    locale === 'el' ? (nights === 1 ? 'νύχτα' : 'νύχτες') : nights === 1 ? 'night' : 'nights';
  return `${format(r.slotDate)} → ${format(r.endDate)} (${nights} ${word})`;
}
