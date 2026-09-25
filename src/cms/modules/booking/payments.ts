/**
 * Booking payments — the tokenised pay-later link, and recording what was paid.
 *
 * The provider contract lives in `@/cms/core` so commerce and booking share it
 * without depending on each other. Only the rows are ours.
 */
import 'server-only';

import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { z } from 'zod';

import {
  badRequest,
  conflict,
  createRoute,
  idParam,
  getPaymentProvider,
  isOnlineProvider,
  localePrefix,
  logAudit,
  notFound,
  ok,
  refundedSoFar,
  refundTargetRef,
  resolveRefundAmount,
  siteOrigin,
  withRefundClaim,
} from '../../core';
import { authorizeCronRequest } from '../../core/cron/policy';
import { adapter, getDb, schema } from '../../db';
import { PERMISSIONS, requireApiPerm } from '../auth';
import { confirmHoldsChecked } from './allocation';
import { sendPaymentLinkEmail, sendStatusEmail } from './emails';
import { canTransition, holdsKeepDeadline } from './lifecycle';
import type { Reservation, ReservationStatus } from '../../db/adapters/mysql/schema/booking';
import {
  manualPaymentRefusal,
  markPaidPlan,
  needsAttention,
  paymentLinkAmount,
  paymentLinkRefusal,
  refundRefusal,
  withAttention,
  withoutAttention,
  type AttentionReason,
} from './payment-actions';
import { surchargeAmount } from './pricing';
import { hashToken, isTokenLive, normalizeReference, paymentToken, tokenMatches } from './reference';
import {
  getBookingPaymentProvider,
  getDefaultCapacity,
  getDepositPercentBps,
  getPaymentLinkTtlDays,
  getSurchargeBps,
} from './settings-read';

/** The emailed payment link, prefixed for the reservation's locale (`defaultLocale` is unprefixed). */
export function paymentLinkUrl(
  reference: string,
  token: string,
  locale: string | null | undefined,
  defaultLocale: string,
): string {
  return `${siteOrigin()}${localePrefix(locale, defaultLocale)}/booking/pay/${reference}?t=${token}`;
}

/**
 * Where a hosted provider sends the customer back to.
 *
 * The pay page itself, carrying the same token plus a marker. On a successful
 * payment the token has been destroyed by the time they land, so the page
 * cannot look anything up — it shows a neutral acknowledgement instead, which
 * is the correct amount to tell someone holding a spent credential.
 */
export function paymentReturnUrl(
  reference: string,
  token: string,
  locale: string | null | undefined,
  defaultLocale: string,
): string {
  return `${paymentLinkUrl(reference, token, locale, defaultLocale)}&return=1`;
}

/**
 * How much to ask for now.
 *
 * A per-item deposit overrides the site default; 0 means the full amount. The
 * result is always at least 1 cent when the total is non-zero — a "deposit" of
 * nothing is a payment link that cannot be paid.
 */
export async function resolveDepositAmount(total: number, itemPercent?: number | null): Promise<number> {
  const bps =
    itemPercent != null && Number.isFinite(itemPercent) && itemPercent > 0
      ? Math.round(Math.min(100, itemPercent) * 100)
      : await getDepositPercentBps();
  if (bps <= 0 || bps >= 10_000) return total;
  return Math.max(1, Math.round((total * bps) / 10_000));
}

export interface IssuedLink {
  url: string;
  token: string;
  expiresAt: Date;
  amount: number;
}

/**
 * Issue (or re-issue) a payment link.
 *
 * Rotating the hash kills the previous link, so a re-send is also a revocation
 * and there is no separate revocation list to keep.
 */
export async function issuePaymentLink(
  reservationId: number,
  opts: {
    /** The site's default locale — decides which locale the link leaves unprefixed. */
    defaultLocale: string;
    amount?: number;
    /**
     * Cap the token's life. An instant booking's link pays for a hold measured
     * in minutes, so the default multi-day TTL would leave a token live after
     * `expireStaleReservations` released the date — a window in which someone
     * pays for a night that is back on sale. The earlier of the two wins.
     */
    expiresAt?: Date;
    /** The experience's own "Deposit %", which overrides the site default. */
    itemDepositPercent?: number | null;
  },
): Promise<IssuedLink> {
  const db = getDb();
  const [reservation] = await db
    .select()
    .from(schema.reservations)
    .where(eq(schema.reservations.id, reservationId))
    .limit(1);
  if (!reservation) throw notFound('Reservation not found.');

  // Issuing a link to an enquiry IS accepting it. A `pending` reservation holds
  // no capacity, so without this the customer could pay for a date that was
  // never taken off the calendar — and `pending → paid` is not even a legal
  // move. Promoting first allocates the holds and puts the reservation in the
  // state the payment will settle from.
  // `notify: false` because the caller emails the link itself; a notifying move
  // would ask for payment again and issue a second link.
  let status = reservation.status;
  if (status === 'pending') {
    const { updateReservationStatus } = await import('./reservations');
    await updateReservationStatus(reservationId, 'awaiting_payment', { notify: false });
    status = 'awaiting_payment';
  }

  const token = paymentToken();
  const ttlDays = await getPaymentLinkTtlDays();
  const ttlExpiry = new Date(Date.now() + ttlDays * 86_400_000);
  const expiresAt = opts.expiresAt && opts.expiresAt < ttlExpiry ? opts.expiresAt : ttlExpiry;
  const itemPercent =
    opts.itemDepositPercent !== undefined ? opts.itemDepositPercent : await readItemDepositPercent(reservation.bookingId);
  const amount =
    opts.amount ?? paymentLinkAmount({ status, total: reservation.total }, await resolveDepositAmount(reservation.total, itemPercent));

  await db.transaction(async (tx) => {
    // A booking whose date is already confirmed (moved back to awaiting payment
    // to collect a balance) gets no deadline: the sweep would expire it and put
    // a confirmed date back on sale. The link itself still expires.
    const holds =
      status === 'awaiting_payment'
        ? await tx
            .select({ state: schema.reservationHolds.state })
            .from(schema.reservationHolds)
            .where(eq(schema.reservationHolds.reservationId, reservationId))
        : [];
    const setsDeadline = holdsKeepDeadline(status, holds.map((h) => h.state));
    await tx
      .update(schema.reservations)
      .set({
        paymentTokenHash: hashToken(token),
        paymentTokenExpiresAt: expiresAt,
        paymentLinkSentAt: new Date(),
        depositAmount: amount,
        // While the booking waits for this link to be paid, its deadline IS the
        // link's. A resend therefore gives the customer the full window again
        // instead of a fresh link to a booking the sweep is about to expire.
        ...(setsDeadline ? { expiresAt } : {}),
      })
      .where(eq(schema.reservations.id, reservationId));
    if (setsDeadline) {
      await tx
        .update(schema.reservationHolds)
        .set({ expiresAt })
        .where(and(eq(schema.reservationHolds.reservationId, reservationId), eq(schema.reservationHolds.state, 'held')));
    }
  });

  await logAudit({
    action: 'booking.payment_link',
    subjectType: 'booking',
    subjectId: String(reservationId),
  });

  return {
    url: paymentLinkUrl(reservation.reference, token, reservation.locale, opts.defaultLocale),
    token,
    expiresAt,
    amount,
  };
}

/** The experience's own "Deposit %", read from the document the reservation was made on. */
async function readItemDepositPercent(bookingId: number | null): Promise<number | null> {
  if (!bookingId) return null;
  const [doc] = await getDb()
    .select({ data: schema.documents.data })
    .from(schema.documents)
    .where(eq(schema.documents.id, bookingId))
    .limit(1);
  const raw = doc?.data && typeof doc.data === 'object' ? (doc.data as Record<string, unknown>).depositPercent : null;
  const n = raw === '' || raw == null ? Number.NaN : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Ask the customer for payment after an operator moved the booking to
 * `awaiting_payment` — which is what "Accept" does.
 *
 * With a gateway configured this issues a real payment link and emails it. With
 * manual payment, or if the link cannot be issued, the approval email carries
 * the "Payment instructions" from Settings → Booking instead (see `emails.ts`).
 * Never throws: the status change has committed, and a mail or link failure is
 * recorded on the booking's history rather than unwinding the acceptance.
 */
export async function requestPayment(
  reservationId: number,
  from: ReservationStatus,
  opts: { defaultLocale?: string },
): Promise<void> {
  const online = isOnlineProvider(getPaymentProvider(await getBookingPaymentProvider()));
  if (online && opts.defaultLocale) {
    try {
      const issued = await issuePaymentLink(reservationId, { defaultLocale: opts.defaultLocale });
      await sendPaymentLinkEmail(reservationId, issued.url);
      return;
    } catch (err) {
      console.error('[booking/payments] payment link on accept failed; sending instructions instead', {
        reservationId,
        err,
      });
    }
  }
  await sendStatusEmail(reservationId, from, 'awaiting_payment');
}

/**
 * Resolve a presented token to its reservation, or null.
 *
 * Returns null for every kind of failure — unknown reference, wrong token,
 * expired, already spent — so the caller can 404 uniformly. A wrong token must
 * be indistinguishable from a wrong reference.
 */
export async function redeemPaymentToken(reference: string, token: string) {
  const db = getDb();
  const [reservation] = await db
    .select()
    .from(schema.reservations)
    .where(eq(schema.reservations.reference, normalizeReference(reference)))
    .limit(1);
  if (!reservation) return null;

  if (!isTokenLive(reservation.paymentTokenHash, reservation.paymentTokenExpiresAt)) return null;
  if (!tokenMatches(hashToken(token), reservation.paymentTokenHash)) return null;
  if (reservation.status === 'paid' || reservation.status === 'cancelled' || reservation.status === 'expired') {
    return null;
  }
  return reservation;
}

/**
 * How long one payment attempt owns the link.
 *
 * Long enough that a customer sitting on the provider's page is not raced by
 * their own second tab; short enough that an abandoned or failed attempt frees
 * the booking without anyone intervening. Nothing depends on this being exact —
 * it is the width of a guard, not a deadline.
 */
const PAYMENT_START_CLAIM_MS = 2 * 60_000;

/**
 * Take exclusive ownership of "starting a payment" for this reservation, or fail.
 *
 * `redeemPaymentToken` is a plain read, and the token deliberately stays live
 * until a payment is credited — the provider's return URL carries it back, so it
 * cannot be burned on use. That left nothing serialising the gap between
 * checking the token and calling `provider.start()`: two requests with the same
 * live token both passed, and both opened a charge session on one booking. A
 * double-clicked Pay button was enough; if both sessions were then completed the
 * reservation was overpaid and the money had to be refunded by hand.
 *
 * One conditional UPDATE is the whole mechanism. `affectedRows` counts rows
 * MATCHED, so exactly one of two concurrent callers sees 1 and the other sees 0 —
 * the database decides, not the order the two requests happen to interleave in.
 * The `IS NULL OR older than the window` clause is what makes the claim expire,
 * so a start that never completes does not strand the booking.
 *
 * Deliberately NOT a transaction held across `provider.start()`: that is a
 * network call to Stripe/Viva/PayPal, and holding a row lock across it would put
 * a third party's latency inside our transaction.
 */
async function claimPaymentStart(reservationId: number): Promise<boolean> {
  const cutoff = new Date(Date.now() - PAYMENT_START_CLAIM_MS);
  const claimed = await getDb()
    .update(schema.reservations)
    .set({ paymentStartedAt: new Date() })
    .where(
      and(
        eq(schema.reservations.id, reservationId),
        or(
          isNull(schema.reservations.paymentStartedAt),
          lt(schema.reservations.paymentStartedAt, cutoff),
        ),
      ),
    );
  return adapter.affectedRows(claimed) === 1;
}

/**
 * Give the claim back, so a failed attempt does not cost the customer two minutes.
 *
 * The expiry window exists for attempts that vanish — a crashed process, a
 * customer who closes the tab on the provider's page. An attempt that fails
 * where we can see it fail is not one of those: the person is still sitting
 * there, and telling them "a payment is already being started" when we have just
 * told them their card was declined would be both wrong and infuriating.
 */
async function releasePaymentStart(reservationId: number): Promise<void> {
  await getDb()
    .update(schema.reservations)
    .set({ paymentStartedAt: null })
    .where(eq(schema.reservations.id, reservationId));
}

/**
 * Where a credited payment leaves the reservation.
 *
 * Split out and pure so the matrix can be tested without a database, and so the
 * two callers (an admin recording a transfer, a webhook crediting a capture)
 * cannot disagree about it.
 *
 * The deposit case is the one that used to be wrong: settlement compared the
 * running total against `total` alone, so clearing a deposit advanced nothing —
 * the link then reported nothing due while the reservation sat in its old
 * status, unable to be either paid or progressed. A cleared deposit secures the
 * date, which is `confirmed`; only the full amount is `paid`.
 */
export function settlementFor(
  reservation: { status: ReservationStatus; total: number; depositAmount: number; amountPaid: number },
  credit: number,
): { paid: number; next: ReservationStatus; secured: boolean; refused?: boolean } {
  const paid = reservation.amountPaid + credit;

  const target: ReservationStatus | null =
    paid >= reservation.total
      ? 'paid'
      : reservation.depositAmount > 0 && paid >= reservation.depositAmount
        ? 'confirmed'
        : null;

  if (!target) return { paid, next: reservation.status, secured: false };

  // Never invent an illegal move. `pending → paid` is the case that matters: an
  // enquiry holds no capacity (`holdStateFor` gives it no holds), so a payment
  // landing straight onto one would produce a paid booking that consumes
  // nothing and can be double-booked. The machine refuses it, and settling to
  // the nearest legal state — `confirmed`, which is what secures the date — is
  // both truthful and safe. `issuePaymentLink` promotes an enquiry before a
  // link can be paid, so this is a backstop rather than the normal path.
  if (target !== reservation.status && !canTransition(reservation.status, target)) {
    const fallback: ReservationStatus = 'confirmed';
    if (canTransition(reservation.status, fallback)) {
      return { paid, next: fallback, secured: true };
    }
    // Neither the target nor the fallback is legal, which in practice means a
    // terminal reservation: `cancelled` and `expired` have no outgoing moves at
    // all. Money cleared the bill on a booking that no longer exists, so this is
    // not a settlement that merely hasn't happened yet — it is one that cannot.
    // `refused` is what tells the caller to record the payment without crediting
    // it, rather than writing a balance onto a dead row.
    return { paid, next: reservation.status, secured: false, refused: true };
  }

  return { paid, next: target, secured: true };
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

/**
 * Money arrived that the booking cannot take — flag it for a human.
 *
 * The payment row is already written (the money moved; the trail must show it).
 * This marks the reservation so it surfaces under "Needs action", writes the
 * reason on its history, and kills any live payment link so the customer cannot
 * pay a second time for a booking that was never confirmed. Nothing is credited.
 */
async function flagForAttention(
  tx: Tx,
  reservation: Pick<Reservation, 'id' | 'status' | 'metadata'>,
  reason: AttentionReason,
  detail: { amount: number; provider: string; actorUserId?: number },
): Promise<void> {
  await tx
    .update(schema.reservations)
    .set({
      metadata: withAttention(reservation.metadata, {
        reason,
        amount: detail.amount,
        provider: detail.provider,
        at: new Date().toISOString(),
      }),
      paymentTokenHash: null,
      paymentTokenExpiresAt: null,
    })
    .where(eq(schema.reservations.id, reservation.id));
  await tx.insert(schema.reservationEvents).values({
    reservationId: reservation.id,
    kind: 'payment.needs_action',
    fromStatus: reservation.status,
    toStatus: reservation.status,
    actorUserId: detail.actorUserId ?? null,
    detail: { reason, amount: detail.amount, provider: detail.provider },
  });
  console.error('[booking/payments] payment could not be applied; flagged for action', {
    reservationId: reservation.id,
    reason,
  });
}

/** Record a payment against a reservation, and settle it if that clears the bill. */
export async function recordBookingPayment(input: {
  reservationId: number;
  provider: string;
  amount: number;
  method?: string;
  providerRef?: string;
  isDeposit?: boolean;
  status?: 'pending' | 'captured' | 'failed';
  actorUserId?: number;
  metadata?: Record<string, unknown>;
  /**
   * Part of `amount` that is a payment-method surcharge rather than money owed
   * on the booking. Charged to the customer, but NOT credited against the
   * balance — otherwise the surcharge would settle the bill it was added to.
   */
  surcharge?: number;
  /**
   * Refuse the payment if the booking cannot take it — dead, settled, or more
   * than the balance due (`manualPaymentRefusal`) — judged on the row read under
   * the lock. For an operator's "Record payment": checked before the lock, two
   * records at once both saw the same balance and could overpay the booking.
   * Not for gateway captures, where the money has already moved.
   */
  enforceBalance?: boolean;
}): Promise<void> {
  const db = getDb();
  const status = input.status ?? 'captured';
  const credit = Math.max(0, input.amount - (input.surcharge ?? 0));
  // Read before the transaction: a settings read is a pool query, and one made
  // from inside an open transaction waits on a second connection.
  const defaultCapacity = await getDefaultCapacity();

  /*
   * The reservation is read INSIDE the transaction, under `FOR UPDATE`.
   *
   * It used to be read before the transaction opened, with no lock, and
   * `settlementFor` — which decides `amountPaid` and whether the booking is now
   * secured — was computed from that unlocked snapshot. Two payments arriving
   * together (a webhook retry alongside a manual record, say) both read the same
   * `amountPaid`, both added their own amount to it, and the second write
   * overwrote the first: money recorded in `reservation_payments` that the
   * reservation's balance never reflected, and a booking that could stay
   * unsecured after being paid twice. `refundReservationPayment` in this same
   * file has always locked the row; this is the sibling catching up.
   */
  const outcome = await db.transaction(async (tx) => {
    const [reservation] = await tx
      .select()
      .from(schema.reservations)
      .where(eq(schema.reservations.id, input.reservationId))
      .for('update')
      .limit(1);
    if (!reservation) throw notFound('Reservation not found.');

    if (input.enforceBalance) {
      const refusal = manualPaymentRefusal(reservation, input.amount);
      if (refusal) throw refusal.kind === 'conflict' ? conflict(refusal.message) : badRequest(refusal.message);
    }

    const settlement = settlementFor(reservation, credit);

    await tx.insert(schema.reservationPayments).values({
      reservationId: input.reservationId,
      provider: input.provider,
      providerRef: input.providerRef ?? null,
      status,
      amount: input.amount,
      currency: reservation.currency,
      method: input.method ?? null,
      isDeposit: input.isDeposit ?? false,
      metadata: {
        ...(input.metadata ?? {}),
        ...(input.surcharge ? { surcharge: input.surcharge } : {}),
      },
    });

    if (status !== 'captured') return { settlement, reservation };

    /*
     * A refused settlement is recorded, never credited.
     *
     * `amountPaid` was written unconditionally, including when `settlementFor`
     * had just refused the move because the reservation is terminal. A payment
     * landing on a `cancelled` or `expired` booking — a late webhook, a retry
     * after the sweeper ran, a manual record against the wrong id — therefore
     * inflated the balance of a row that can never progress, so the reservation
     * reported money owed against a booking nobody would ever honour and the
     * refund figures derived from it were wrong. The `reservation_payments`
     * insert above still happens: the money did move and the trail must show it.
     * What stops is pretending the dead reservation absorbed it — and the
     * booking is flagged, so the money is refunded rather than forgotten.
     */
    const flag = { amount: input.amount, provider: input.provider, actorUserId: input.actorUserId };
    if (settlement.refused) {
      await flagForAttention(tx, reservation, 'booking_closed', flag);
      return { settlement, reservation };
    }

    // Securing the date re-checks it first: the hold may have lapsed, or the
    // date lost its room, while the customer was paying. See
    // `confirmHoldsChecked`. Refused → recorded, flagged, not credited.
    if (settlement.secured) {
      const confirmation = await confirmHoldsChecked(tx, reservation, defaultCapacity);
      if (!confirmation.ok) {
        await flagForAttention(tx, reservation, confirmation.reason, flag);
        return { settlement: { ...settlement, next: reservation.status, secured: false }, reservation };
      }
    }

    await tx
      .update(schema.reservations)
      .set({
        amountPaid: settlement.paid,
        status: settlement.next,
        // A spent link is dead. The hold's expiry goes with it once the date is
        // secured — nothing should sweep away a booking that has been paid for.
        ...(settlement.secured
          ? { paymentTokenHash: null, paymentTokenExpiresAt: null, expiresAt: null }
          : {}),
      })
      .where(eq(schema.reservations.id, input.reservationId));

    if (settlement.secured) {
      await tx.insert(schema.reservationEvents).values({
        reservationId: input.reservationId,
        kind: 'payment.captured',
        fromStatus: reservation.status,
        toStatus: settlement.next,
        actorUserId: input.actorUserId ?? null,
      });
    }

    return { settlement, reservation };
  });

  await logAudit({
    action: 'booking.payment',
    subjectType: 'booking',
    subjectId: String(input.reservationId),
    after: { amount: input.amount, provider: input.provider },
    userId: input.actorUserId,
  });

  // Emailed after the transaction commits, using the statuses it actually wrote,
  // so a rolled-back settlement never tells the customer their booking is
  // confirmed.
  const { settlement, reservation } = outcome;
  if (status === 'captured' && settlement.next !== reservation.status) {
    await sendStatusEmail(input.reservationId, reservation.status, settlement.next);
  }
}

/**
 * Settle a reservation's payment row from a verified provider event.
 *
 * Idempotent, because both gateways retry webhooks by design and a replayed
 * capture must not be credited twice. The row is found by `(provider,
 * providerRef)` — unique since migration 0009 — and locked, along with the
 * reservation, for the whole read-modify-write. The previous code read
 * `amountPaid` outside any lock, so two concurrent captures could each credit
 * against the same starting balance and lose one.
 *
 * Returns whether THIS call captured it, so the caller knows whether the
 * confirmation email is its to send.
 */
export async function captureReservationPaymentByRef(input: {
  provider: string;
  providerRef: string;
  status: 'captured' | 'failed' | 'refunded';
  method?: string;
  metadata?: Record<string, unknown>;
}): Promise<{ captured: boolean; reservationId: number | null; from: ReservationStatus | null; to: ReservationStatus | null }> {
  const db = getDb();
  // Outside the transaction — see `recordBookingPayment`.
  const defaultCapacity = await getDefaultCapacity();

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.reservationPayments)
      .where(
        and(
          eq(schema.reservationPayments.provider, input.provider),
          eq(schema.reservationPayments.providerRef, input.providerRef),
        ),
      )
      .for('update')
      .limit(1);

    // No row means the event refers to a payment this site never started — a
    // stale endpoint, or another environment pointed at the same webhook.
    if (!row) return { captured: false, reservationId: null, from: null, to: null };
    // Already in this state: a retry. Say so and change nothing.
    if (row.status === input.status) {
      return { captured: false, reservationId: row.reservationId, from: null, to: null };
    }

    const merged = { ...(row.metadata ?? {}), ...(input.metadata ?? {}) };
    await tx
      .update(schema.reservationPayments)
      .set({ status: input.status, method: input.method ?? row.method, metadata: merged })
      .where(eq(schema.reservationPayments.id, row.id));

    if (input.status !== 'captured') {
      return { captured: false, reservationId: row.reservationId, from: null, to: null };
    }

    const [reservation] = await tx
      .select()
      .from(schema.reservations)
      .where(eq(schema.reservations.id, row.reservationId))
      .for('update')
      .limit(1);
    if (!reservation) return { captured: false, reservationId: row.reservationId, from: null, to: null };

    const surcharge = typeof merged.surcharge === 'number' ? merged.surcharge : 0;
    const settlement = settlementFor(reservation, Math.max(0, row.amount - surcharge));

    // Same rule as `recordBookingPayment`: a settlement the machine refused —
    // a capture landing on a cancelled or expired reservation, which is exactly
    // what a late gateway retry produces — is left recorded on the payment row
    // and never credited to the booking's balance. The row above is already
    // marked captured, so the money is traceable; the dead reservation just does
    // not claim it.
    // Flagged, so the operator refunds it rather than never hearing of it.
    const flag = { amount: row.amount, provider: input.provider };
    if (settlement.refused) {
      await flagForAttention(tx, reservation, 'booking_closed', flag);
      return { captured: true, reservationId: reservation.id, from: null, to: null };
    }

    // A capture landing after the hold lapsed (before or after the sweep), or
    // on a date that has lost its room, must not confirm — it would overbook.
    if (settlement.secured) {
      const confirmation = await confirmHoldsChecked(tx, reservation, defaultCapacity);
      if (!confirmation.ok) {
        await flagForAttention(tx, reservation, confirmation.reason, flag);
        return { captured: true, reservationId: reservation.id, from: null, to: null };
      }
    }

    await tx
      .update(schema.reservations)
      .set({
        amountPaid: settlement.paid,
        status: settlement.next,
        ...(settlement.secured
          ? { paymentTokenHash: null, paymentTokenExpiresAt: null, expiresAt: null }
          : {}),
      })
      .where(eq(schema.reservations.id, reservation.id));

    if (settlement.secured) {
      await tx.insert(schema.reservationEvents).values({
        reservationId: reservation.id,
        kind: 'payment.captured',
        fromStatus: reservation.status,
        toStatus: settlement.next,
      });
    }

    return {
      captured: true,
      reservationId: reservation.id,
      from: reservation.status,
      to: settlement.next,
    };
  });
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Routes                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

const payQuery = z.object({
  reference: z.string().trim().min(1).max(32),
  t: z.string().trim().min(1).max(64),
});

/** What the customer still owes, before any payment-method surcharge. */
export function amountDueFor(reservation: {
  total: number;
  depositAmount: number;
  amountPaid: number;
}): number {
  return Math.max(0, (reservation.depositAmount || reservation.total) - reservation.amountPaid);
}

/**
 * The provider and the surcharge it attracts.
 *
 * The surcharge is a percentage of what is due, in basis points, and is applied
 * HERE rather than in the quote: in a request-then-pay flow the customer has
 * not chosen a method when they ask for a price, so a surcharge in the quote is
 * a number they never agreed to (BOOKING.md).
 */
async function resolvePaymentTerms(amountDue: number) {
  const provider = getPaymentProvider(await getBookingPaymentProvider());
  const surcharge = surchargeAmount(amountDue, await getSurchargeBps(provider.key));
  return { provider, surcharge, chargeable: amountDue + surcharge };
}

/** `GET /api/cms/booking/pay` — what the customer owes, if the token is good. */
export function bookingPayGetRoute() {
  return createRoute({
    rateLimit: { scope: 'booking-pay', max: 10, windowMs: 60_000 },
    query: payQuery,
    handler: async ({ query }) => {
      const reservation = await redeemPaymentToken(query.reference, query.t);
      if (!reservation) throw notFound('That payment link is not valid.');

      const amountDue = amountDueFor(reservation);
      const { provider, surcharge, chargeable } = await resolvePaymentTerms(amountDue);

      return ok({
        reference: reservation.reference,
        bookingTitle: reservation.bookingTitle,
        slotDate: reservation.slotDate,
        persons: reservation.persons,
        currency: reservation.currency,
        total: reservation.total,
        amountDue,
        surcharge,
        // What the card is actually charged. Shown before the customer commits,
        // so the surcharge is never a surprise on the statement.
        chargeable,
        isDeposit: reservation.depositAmount > 0 && reservation.depositAmount < reservation.total,
        provider: provider.key,
        providerLabel: provider.label,
        online: isOnlineProvider(provider),
      });
    },
  });
}

/** `POST /api/cms/booking/pay` — begin payment through the configured provider. */
export function bookingPayStartRoute(opts: {
  /** The site's default locale (`config.defaultLocale`) — the provider's return link is prefixed against it. */
  defaultLocale: string;
}) {
  return createRoute({
    rateLimit: { scope: 'booking-pay-start', max: 10, windowMs: 60_000 },
    input: payQuery,
    handler: async ({ input }) => {
      const reservation = await redeemPaymentToken(input.reference, input.t);
      if (!reservation) throw notFound('That payment link is not valid.');

      const amountDue = amountDueFor(reservation);
      if (amountDue <= 0) throw conflict('This booking is already paid.');

      // Claim the booking BEFORE talking to the provider — see
      // `claimPaymentStart`. Two tabs, or one double-clicked button, otherwise
      // open two charge sessions against the same reservation.
      if (!(await claimPaymentStart(reservation.id))) {
        throw conflict('A payment for this booking is already being started. Give it a moment, then try again.');
      }

      // The provider comes from settings, never from the request. It used to be
      // taken from a `method` field on the body, which let a caller pick any
      // registered provider regardless of what the site had configured.
      const { provider, surcharge, chargeable } = await resolvePaymentTerms(amountDue);

      let result;
      try {
        result = await provider.start({
          subject: 'reservation',
          subjectId: reservation.id,
          reference: reservation.reference,
          amount: chargeable,
          currency: reservation.currency,
          email: reservation.email,
          returnUrl: paymentReturnUrl(reservation.reference, input.t, reservation.locale, opts.defaultLocale),
        });
      } catch (err) {
        // The provider threw rather than answering — release the claim so the
        // customer can try again now, and let the error surface unchanged.
        await releasePaymentStart(reservation.id);
        throw err;
      }

      if (result.status === 'failed') {
        await releasePaymentStart(reservation.id);
        throw conflict(result.error ?? 'That payment could not be started.');
      }

      await recordBookingPayment({
        reservationId: reservation.id,
        provider: provider.key,
        amount: chargeable,
        surcharge,
        method: result.method,
        providerRef: result.providerRef,
        // Manual takes no money now, so the row stays pending and the
        // reservation is NOT settled — an admin marks it when the transfer
        // lands. A gateway is pending too: its webhook is what captures.
        status: result.status === 'captured' ? 'captured' : 'pending',
      });

      return ok({
        redirectUrl: result.redirectUrl ?? null,
        clientSecret: result.clientSecret ?? null,
        provider: provider.key,
        amountDue,
        surcharge,
        chargeable,
      });
    },
  });
}

const linkBody = z.object({ amount: z.coerce.number().int().min(0).optional() });

/** `POST /api/cms/reservations/[id]/payment-link` — issue and email a link. */
export function paymentLinkRoute(opts: {
  /** The site's default locale (`config.defaultLocale`) — the emailed link is prefixed against it. */
  defaultLocale: string;
}) {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.reservationsWrite),
    input: linkBody,
    rateLimit: { scope: 'booking-paylink', max: 20, windowMs: 60_000 },
    handler: async ({ params, input }) => {
      const id = idParam(params.id);
      const [reservation] = await getDb()
        .select()
        .from(schema.reservations)
        .where(eq(schema.reservations.id, id))
        .limit(1);
      if (!reservation) throw notFound('Reservation not found.');
      // Paid, cancelled, expired or past its deadline: a link would be for
      // nothing, or for a date that may already be back on sale.
      const refusal = paymentLinkRefusal(reservation, new Date());
      if (refusal) throw conflict(refusal);

      const issued = await issuePaymentLink(id, { amount: input.amount, defaultLocale: opts.defaultLocale });
      // Always emailed. Keyed on the status change, a RESEND — the booking was
      // already awaiting payment — found no transition and sent nothing.
      await sendPaymentLinkEmail(id, issued.url);

      // The token itself is deliberately NOT returned — it exists in the email
      // and nowhere else, which is the whole point of hashing it at rest.
      return ok({ url: issued.url, expiresAt: issued.expiresAt, amount: issued.amount });
    },
  });
}

const manualPaymentBody = z.object({
  amount: z.coerce.number().int().min(1),
  method: z.string().trim().max(32).default('manual'),
  providerRef: z.string().trim().max(191).optional(),
  isDeposit: z.boolean().optional(),
});

/** `POST /api/cms/reservations/[id]/payments` — record a transfer that arrived. */
export function recordPaymentRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.reservationsWrite),
    input: manualPaymentBody,
    handler: async ({ params, input, auth }) => {
      const id = idParam(params.id);
      // The balance is checked inside `recordBookingPayment`, on the row it has
      // locked: a dead or settled booking answers 409, a figure above the
      // balance 400 — the same refusals this route always gave, now without a
      // window in which two records both pass.
      await recordBookingPayment({
        reservationId: id,
        provider: 'manual',
        amount: input.amount,
        method: input.method,
        providerRef: input.providerRef,
        isDeposit: input.isDeposit,
        actorUserId: auth?.userId,
        enforceBalance: true,
      });
      return ok({ id });
    },
  });
}

/**
 * "Mark paid" — the balance reached the operator outside the website.
 *
 * Records the outstanding balance as a manual payment, through the same locked
 * path as "Record payment" (`enforceBalance`), so the booking gets a
 * `reservation_payments` row and an `amount_paid` that match its badge and the
 * status follows from the settlement. It used to set the status alone. With
 * nothing owed it is a plain status move.
 */
export async function markReservationPaid(
  id: number,
  opts: { actorUserId?: number; reason?: string; notify?: boolean; defaultLocale?: string } = {},
): Promise<{ id: number; status: ReservationStatus }> {
  const db = getDb();
  const [reservation] = await db.select().from(schema.reservations).where(eq(schema.reservations.id, id)).limit(1);
  if (!reservation) throw notFound('Reservation not found.');

  const plan = markPaidPlan(reservation);
  if (plan.kind === 'status') {
    const { updateReservationStatus } = await import('./reservations');
    return updateReservationStatus(id, 'paid', opts);
  }

  await recordBookingPayment({
    reservationId: id,
    provider: 'manual',
    amount: plan.amount,
    method: 'manual',
    actorUserId: opts.actorUserId,
    enforceBalance: true,
  });
  const [after] = await db
    .select({ status: schema.reservations.status })
    .from(schema.reservations)
    .where(eq(schema.reservations.id, id))
    .limit(1);
  return { id, status: after?.status ?? reservation.status };
}

/**
 * The operator has dealt with a flagged payment some other way (rebooked the
 * customer, say) — take the booking out of "Needs action". A refund clears the
 * flag by itself.
 */
export async function resolveReservationAttention(id: number, actorUserId?: number): Promise<{ id: number }> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const [reservation] = await tx
      .select()
      .from(schema.reservations)
      .where(eq(schema.reservations.id, id))
      .for('update')
      .limit(1);
    if (!reservation) throw notFound('Reservation not found.');
    if (!needsAttention(reservation.metadata)) return;
    await tx
      .update(schema.reservations)
      .set({ metadata: withoutAttention(reservation.metadata) })
      .where(eq(schema.reservations.id, id));
    await tx.insert(schema.reservationEvents).values({
      reservationId: id,
      kind: 'payment.action_resolved',
      fromStatus: reservation.status,
      toStatus: reservation.status,
      actorUserId: actorUserId ?? null,
    });
  });
  return { id };
}

/* ── Refunds ─────────────────────────────────────────────────────────────── */

/**
 * Send a reservation's money back through the provider that took it.
 *
 * Only captured rows are refundable, and only through a provider that offers
 * `refund()` — `manual` does not, because a bank transfer is reversed at the
 * bank and recorded here afterwards.
 *
 * The refund is written as its own row rather than by mutating the capture: the
 * two are separate events, and the payment history should say what happened
 * rather than only where it ended up. `amount_paid` is reduced by what went
 * back, so a partial refund leaves a coherent balance.
 */
export async function refundReservationPayment(input: {
  paymentId: number;
  /**
   * The reservation the caller addressed. The payment must belong to it.
   *
   * The route reads `/api/cms/reservations/:id/refund` and took `paymentId`
   * from the body, then never compared the two — so any payment on the system
   * could be refunded through any reservation's URL. It is not a privilege
   * crossing while `reservationsWrite` is one global permission, but it becomes
   * one the moment reservations are scoped, and it already recorded the refund
   * against whichever reservation actually owned the payment while the operator
   * was looking at a different one.
   */
  reservationId?: number;
  amount?: number;
  reason?: string;
  actorUserId?: number;
}): Promise<{ refunded: number; providerRef: string | null }> {
  const db = getDb();

  /*
   * Claim the refund BEFORE calling the provider, with the row locked — the same
   * two-phase shape as `modules/commerce/payments.ts`, for the same reason: the
   * capture row is left as the record of the capture, so `status === 'captured'`
   * stays true after a refund and cannot serve as the guard against a second
   * one. See `core/payments/refunds.ts`.
   */
  const claim = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.reservationPayments)
      .where(eq(schema.reservationPayments.id, input.paymentId))
      .for('update')
      .limit(1);
    if (!row) throw notFound('Payment not found.');
    // Not-found rather than forbidden: whether payment 41 exists is not something
    // a caller poking at reservation 7 should be able to learn.
    if (input.reservationId !== undefined && row.reservationId !== input.reservationId) {
      throw notFound('Payment not found.');
    }
    if (row.status !== 'captured') throw conflict('Only a captured payment can be refunded.');

    const provider = getPaymentProvider(row.provider);
    if (!provider.refund) {
      throw conflict(`${provider.label} refunds are arranged outside this system.`);
    }

    const alreadyRefunded = refundedSoFar(row.metadata);
    // Refused rather than capped: the operator typed a figure, and refunding a
    // different one without saying so is how money goes missing.
    const remaining = row.amount - alreadyRefunded;
    const refusal = refundRefusal(remaining, input.amount);
    if (refusal) throw remaining <= 0 ? conflict(refusal) : badRequest(refusal);
    const amount = resolveRefundAmount({
      capturedAmount: row.amount,
      alreadyRefunded,
      requested: input.amount,
    });

    await tx
      .update(schema.reservationPayments)
      .set({ metadata: withRefundClaim(row.metadata, alreadyRefunded + amount) })
      .where(eq(schema.reservationPayments.id, row.id));

    // The refund fn travels with the claim, so the call below needs no non-null
    // assertion on a check that happened in here.
    return { row, amount, refund: provider.refund };
  });

  const { row, amount, refund } = claim;

  /**
   * Give the claim back, so a *definitely* failed attempt does not consume the
   * balance. Called only where it is certain no money moved — see the commerce
   * sibling for why a thrown call is not one of those places.
   */
  const releaseClaim = async (): Promise<void> => {
    await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(schema.reservationPayments)
        .where(eq(schema.reservationPayments.id, row.id))
        .for('update')
        .limit(1);
      if (!current) return;
      await tx
        .update(schema.reservationPayments)
        .set({
          metadata: withRefundClaim(
            current.metadata,
            Math.max(0, refundedSoFar(current.metadata) - amount),
          ),
        })
        .where(eq(schema.reservationPayments.id, row.id));
    });
  };

  // Which id the provider's refund names: PayPal's capture, Viva's transaction,
  // otherwise the row's own ref — see `refundTargetRef` (shared with orders).
  const target = refundTargetRef(row);
  if (!target) {
    await releaseClaim();
    throw conflict('That payment has no provider reference to refund against.');
  }

  let result: Awaited<ReturnType<typeof refund>>;
  try {
    result = await refund({
      providerRef: target,
      amount,
      currency: row.currency,
      reason: input.reason,
    });
  } catch (err) {
    // Claim KEPT: a thrown call cannot distinguish "never arrived" from
    // "processed, answer lost", and releasing would let a retry send the money
    // twice. A held claim needs a human; a double refund needs the money back.
    console.error('[booking/payments] refund call failed; claim held for review', {
      paymentId: row.id,
      amount,
      err,
    });
    throw err;
  }

  if (result.status === 'failed') {
    // Unambiguous: the provider answered, and the answer was no.
    await releaseClaim();
    throw conflict(result.error ?? 'The provider refused the refund.');
  }

  await db.transaction(async (tx) => {
    await tx.insert(schema.reservationPayments).values({
      reservationId: row.reservationId,
      provider: row.provider,
      providerRef: result.providerRef ?? null,
      status: 'refunded',
      // Negative, so the rows for a reservation still sum to what it holds.
      amount: -amount,
      currency: row.currency,
      method: row.method,
      metadata: { refundOf: row.id, ...(input.reason ? { reason: input.reason } : {}) },
    });

    const [reservation] = await tx
      .select()
      .from(schema.reservations)
      .where(eq(schema.reservations.id, row.reservationId))
      .for('update')
      .limit(1);

    if (reservation) {
      await tx
        .update(schema.reservations)
        .set({
          amountPaid: Math.max(0, reservation.amountPaid - amount),
          // A refund is the operator acting on a flagged payment; it leaves
          // "Needs action".
          ...(needsAttention(reservation.metadata) ? { metadata: withoutAttention(reservation.metadata) } : {}),
        })
        .where(eq(schema.reservations.id, reservation.id));

      await tx.insert(schema.reservationEvents).values({
        reservationId: reservation.id,
        kind: 'payment.refunded',
        fromStatus: reservation.status,
        toStatus: reservation.status,
        actorUserId: input.actorUserId ?? null,
        detail: { amount, provider: row.provider },
      });
    }
  });

  await logAudit({
    action: 'booking.refund',
    subjectType: 'booking',
    subjectId: String(row.reservationId),
    after: { amount, provider: row.provider },
    userId: input.actorUserId,
  });

  return { refunded: amount, providerRef: result.providerRef ?? null };
}

const refundBody = z.object({
  paymentId: z.coerce.number().int().min(1),
  amount: z.coerce.number().int().min(1).optional(),
  reason: z.string().trim().max(191).optional(),
});

/** `POST /api/cms/reservations/[id]/refund` — send money back to the customer. */
export function refundReservationRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.reservationsWrite),
    input: refundBody,
    rateLimit: { scope: 'booking-refund', max: 20, windowMs: 60_000 },
    handler: async ({ params, input, auth }) => {
      const result = await refundReservationPayment({
        paymentId: input.paymentId,
        // The URL says which reservation this is about; the body says which
        // payment. They have to agree.
        reservationId: idParam(params.id),
        amount: input.amount,
        reason: input.reason,
        actorUserId: auth?.userId,
      });
      return ok(result);
    },
  });
}

/* ── The expiry sweep ────────────────────────────────────────────────────── */

/**
 * `POST /api/cms/reservations/expire` — lapse stale enquiries and abandoned
 * payment holds. One sweep, two jobs, though only the second releases a date.
 *
 * Authenticated by a shared secret so a scheduler can call it, or by an admin
 * session so a human can. Mirrors the abandoned-cart reminder route.
 */
export function bookingExpireRoute() {
  return createRoute({
    rateLimit: { scope: 'booking-expire', max: 5, windowMs: 60_000 },
    guard: async (req) => {
      // A scheduler has no session, so the shared secret stands in for one —
      // under the same rule as `CMS_CRON_SECRET`: shorter than
      // `CRON_SECRET_MIN_LENGTH` and it authorises nothing, so a guessable
      // secret cannot run the sweep (and its emails).
      if (authorizeCronRequest(req.headers.get('x-cron-secret'), process.env.BOOKING_CRON_SECRET)) return null;
      return requireApiPerm(PERMISSIONS.reservationsWrite);
    },
    handler: async () => {
      const { expireStaleReservations } = await import('./allocation');
      return ok(await expireStaleReservations());
    },
  });
}

/** Reservations whose holds are still counted against a date. */
export async function listPaymentsForReservation(reservationId: number) {
  const db = getDb();
  return db
    .select()
    .from(schema.reservationPayments)
    .where(
      and(
        eq(schema.reservationPayments.reservationId, reservationId),
        eq(schema.reservationPayments.status, 'captured'),
      ),
    );
}
