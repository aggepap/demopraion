/**
 * Booking emails.
 *
 * Delivery is best-effort and **always recorded**. Every send goes through
 * `sendAndRecord`, which writes the outcome to `reservation_events` and mirrors
 * it onto the reservation row, and never rethrows: a mail outage must not fail a
 * booking that is otherwise good.
 *
 * The recording is the point. "Somebody booked and nobody was told" is the
 * failure that looks identical to success from the outside, so it has to be
 * visible on the screen rather than inferred from a server log.
 */
import 'server-only';

import { eq } from 'drizzle-orm';

import {
  emailColor,
  escapeHtml,
  formatDate,
  formatMoney,
  getPaymentProvider,
  isOnlineProvider,
  sendGraphMail,
  type GraphMail,
} from '../../core';
import { getDb, schema } from '../../db';
import type {
  BookingModeValue,
  Reservation,
  ReservationStatus,
} from '../../db/adapters/mysql/schema/booking';
import {
  bookedDatesText,
  emailForNewReservation,
  emailForTransition,
  RESERVATION_STATUS_LABELS,
  type ReservationEmail,
} from './lifecycle';
import { cancellationEmailHtml, readCancellationTerms } from './cancellation';
import { getBookingPaymentProvider, getBookingRecipients, getPaymentInstructions } from './settings-read';

interface RecordArgs {
  reservationId: number;
  kind: string;
  recipient?: string | null;
  mail: GraphMail;
  /** Mirror the outcome onto the reservation row (customer mail only). */
  mirror?: boolean;
}

/**
 * Send, then write down what happened either way.
 *
 * Deliberately never throws. The caller has already committed a reservation; a
 * Graph outage at this point is a delivery problem to surface, not a reason to
 * unwind a booking the customer believes they have made.
 */
async function sendAndRecord({ reservationId, kind, recipient, mail, mirror }: RecordArgs): Promise<void> {
  const db = getDb();
  try {
    await sendGraphMail(mail);
    await db.insert(schema.reservationEvents).values({
      reservationId,
      kind,
      recipient: recipient ?? mail.to ?? null,
      emailStatus: 'sent',
    });
    if (mirror) {
      await db
        .update(schema.reservations)
        .set({ emailStatus: 'sent', emailError: null })
        .where(eq(schema.reservations.id, reservationId));
    }
  } catch (err) {
    const reason = (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, 1000);
    console.error('[booking/emails] send failed', { reservationId, kind, reason });
    await db.insert(schema.reservationEvents).values({
      reservationId,
      kind,
      recipient: recipient ?? mail.to ?? null,
      emailStatus: 'failed',
      emailError: reason,
    });
    if (mirror) {
      await db
        .update(schema.reservations)
        .set({ emailStatus: 'failed', emailError: reason })
        .where(eq(schema.reservations.id, reservationId));
    }
  }
}

const LABELS: Record<string, Record<string, string>> = {
  el: {
    reference: 'Κωδικός κράτησης',
    date: 'Ημερομηνία',
    stay: 'Διαμονή',
    persons: 'Άτομα',
    resource: 'Επιλογή',
    total: 'Σύνολο',
    breakdown: 'Ανάλυση τιμής',
  },
  en: {
    reference: 'Booking reference',
    date: 'Date',
    stay: 'Stay',
    persons: 'Guests',
    resource: 'Selection',
    total: 'Total',
    breakdown: 'Price breakdown',
  },
};

function t(locale: string, key: string): string {
  return LABELS[locale]?.[key] ?? LABELS.en[key] ?? key;
}

async function loadReservation(id: number): Promise<Reservation | null> {
  const db = getDb();
  const [row] = await db.select().from(schema.reservations).where(eq(schema.reservations.id, id)).limit(1);
  return row ?? null;
}

async function loadItems(id: number) {
  const db = getDb();
  return db
    .select()
    .from(schema.reservationItems)
    .where(eq(schema.reservationItems.reservationId, id))
    .orderBy(schema.reservationItems.position);
}

/**
 * The experience's cancellation terms as an email block, or ''.
 *
 * Read from the experience the reservation was made on (its locale's row), so
 * the customer gets the terms in the language they booked in.
 */
async function cancellationBlock(reservation: Reservation): Promise<string> {
  if (!reservation.bookingId) return '';
  const [doc] = await getDb()
    .select({ data: schema.documents.data })
    .from(schema.documents)
    .where(eq(schema.documents.id, reservation.bookingId))
    .limit(1);
  if (!doc?.data || typeof doc.data !== 'object') return '';
  return cancellationEmailHtml(
    readCancellationTerms(doc.data as Record<string, unknown>),
    reservation.locale ?? 'el',
  );
}

/**
 * The operator's "Payment instructions", when payment is manual — or undefined.
 *
 * Only for manual: with a gateway the customer is sent a link, and bank details
 * next to it would offer a second way to pay that nobody is watching for.
 */
async function manualPaymentInstructions(): Promise<string | undefined> {
  if (isOnlineProvider(getPaymentProvider(await getBookingPaymentProvider()))) return undefined;
  return (await getPaymentInstructions()) || undefined;
}

/** The shared summary block every booking email carries. */
async function summaryHtml(reservation: Reservation): Promise<string> {
  const locale = reservation.locale ?? 'el';
  const items = await loadItems(reservation.id);

  const rows = items
    .map(
      (i) =>
        // `× unit price`, not `× quantity`: the count is already spelled out in
        // the label the engine stored ("Cleaning — 7 nights"), so repeating it
        // here left out the only figure the guest cannot derive.
        `<tr><td style="padding:4px 12px 4px 0">${escapeHtml(i.label)}${
          i.quantity > 1 && i.unitAmount > 0
            ? ` × ${escapeHtml(formatMoney(i.unitAmount, reservation.currency, locale))}`
            : ''
        }</td><td style="padding:4px 0;text-align:right">${escapeHtml(
          formatMoney(i.amount, reservation.currency, locale),
        )}</td></tr>`,
    )
    .join('');

  return `
    <table style="border-collapse:collapse;font-family:system-ui,sans-serif;font-size:14px">
      <tr><td style="padding:4px 12px 4px 0"><strong>${escapeHtml(t(locale, 'reference'))}</strong></td>
          <td style="padding:4px 0"><code>${escapeHtml(reservation.reference)}</code></td></tr>
      <tr><td style="padding:4px 12px 4px 0"><strong>${escapeHtml(t(locale, reservation.nights > 0 ? 'stay' : 'date'))}</strong></td>
          <td style="padding:4px 0">${escapeHtml(
            bookedDatesText(reservation, locale, (d) => formatDate(d, locale)),
          )}</td></tr>
      <tr><td style="padding:4px 12px 4px 0"><strong>${escapeHtml(t(locale, 'persons'))}</strong></td>
          <td style="padding:4px 0">${reservation.persons}</td></tr>
      ${
        reservation.resourceLabel
          ? `<tr><td style="padding:4px 12px 4px 0"><strong>${escapeHtml(t(locale, 'resource'))}</strong></td>
               <td style="padding:4px 0">${escapeHtml(reservation.resourceLabel)}</td></tr>`
          : ''
      }
    </table>
    <h4 style="font-family:system-ui,sans-serif;margin:16px 0 4px">${escapeHtml(t(locale, 'breakdown'))}</h4>
    <table style="border-collapse:collapse;font-family:system-ui,sans-serif;font-size:14px">
      ${rows}
      <tr><td style="padding:8px 12px 0 0;border-top:1px solid ${emailColor('border-soft')}"><strong>${escapeHtml(
        t(locale, 'total'),
      )}</strong></td>
          <td style="padding:8px 0 0;border-top:1px solid ${emailColor('border-soft')};text-align:right"><strong>${escapeHtml(
            formatMoney(reservation.total, reservation.currency, locale),
          )}</strong></td></tr>
    </table>`;
}

/**
 * On a new booking: tell the customer, and tell the operator.
 *
 * Two separate sends, so a failure to reach the operator does not also lose the
 * customer's confirmation — and each is recorded independently.
 */
export async function sendReservationEmails(
  reservationId: number,
  opts: { paymentUrl?: string | null } = {},
): Promise<void> {
  const reservation = await loadReservation(reservationId);
  if (!reservation) return;

  const locale = reservation.locale ?? 'el';
  const summary = await summaryHtml(reservation);
  const isRequest = reservation.status === 'pending';
  // Which email is a property of the status the row entered at, not of whether
  // it is `pending`. Branching on `pending` alone told an instant customer
  // their booking was confirmed while payment was still outstanding.
  const which = emailForNewReservation(reservation.status);
  const owesManualPayment =
    !opts.paymentUrl && reservation.amountPaid < reservation.total && (which === 'payment_link' || which === 'confirmed');
  const body = customerEmailBody(which, locale, {
    paymentUrl: opts.paymentUrl ?? undefined,
    mode: reservation.mode,
    // An instant booking confirmed without a gateway still has to be paid for,
    // and this email is the only place the customer is told how.
    paymentInstructions: owesManualPayment ? await manualPaymentInstructions() : undefined,
  });

  await sendAndRecord({
    reservationId,
    kind: `email.${which}`,
    recipient: reservation.email,
    mirror: true,
    mail: {
      to: reservation.email,
      subject: `${body.subject} — ${reservation.reference}`,
      html: `<p style="font-family:system-ui,sans-serif">${body.html}</p>${summary}${
        which === 'confirmed' ? await cancellationBlock(reservation) : ''
      }`,
    },
  });

  const recipients = await getBookingRecipients();
  if (recipients.length === 0) {
    // Not an error, but it IS the "nobody was told" case, so it is recorded.
    await getDb().insert(schema.reservationEvents).values({
      reservationId,
      kind: 'email.admin_new_request',
      emailStatus: 'skipped',
      emailError: 'No notification recipients are configured in Settings → Booking.',
    });
    return;
  }

  for (const to of recipients) {
    await sendAndRecord({
      reservationId,
      kind: 'email.admin_new_request',
      recipient: to,
      mail: {
        to,
        subject: `New booking ${reservation.reference} — ${reservation.bookingTitle}`,
        replyTo: reservation.email,
        replyToName: reservation.customerName ?? undefined,
        html:
          `<p style="font-family:system-ui,sans-serif">${escapeHtml(
            `${reservation.customerName ?? reservation.email} ${
              isRequest ? 'requested' : 'booked'
            } ${reservation.bookingTitle}.`,
          )}</p>${summary}` +
          (reservation.notes ? `<p><em>${escapeHtml(reservation.notes)}</em></p>` : ''),
      },
    });
  }
}

/** The email a status change owes the customer, if any. */
export async function sendStatusEmail(
  reservationId: number,
  from: ReservationStatus,
  to: ReservationStatus,
  extra: { paymentUrl?: string } = {},
): Promise<void> {
  const which = emailForTransition(from, to);
  if (!which) return;

  const reservation = await loadReservation(reservationId);
  if (!reservation) return;

  await sendCustomerEmail(reservation, which, {
    paymentUrl: extra.paymentUrl,
    from,
    paymentInstructions:
      which === 'payment_link' && !extra.paymentUrl ? await manualPaymentInstructions() : undefined,
  });
}

/**
 * Email a freshly issued payment link.
 *
 * Its own entry point because a RESEND is not a status change: the booking is
 * already awaiting payment, so `sendStatusEmail(awaiting → awaiting)` finds no
 * transition and sends nothing — which is what the old resend did.
 */
export async function sendPaymentLinkEmail(reservationId: number, paymentUrl: string): Promise<void> {
  const reservation = await loadReservation(reservationId);
  if (!reservation) return;
  await sendCustomerEmail(reservation, 'payment_link', { paymentUrl });
}

async function sendCustomerEmail(
  reservation: Reservation,
  which: ReservationEmail,
  ctx: EmailContext,
): Promise<void> {
  const locale = reservation.locale ?? 'el';
  const summary = await summaryHtml(reservation);
  const body = customerEmailBody(which, locale, { ...ctx, mode: reservation.mode });
  // The terms travel with the emails that confirm the booking — the ones a
  // customer keeps and looks up when plans change.
  const terms = which === 'confirmed' || which === 'receipt' ? await cancellationBlock(reservation) : '';

  await sendAndRecord({
    reservationId: reservation.id,
    kind: `email.${which}`,
    recipient: reservation.email,
    mirror: true,
    mail: {
      to: reservation.email,
      subject: `${body.subject} — ${reservation.reference}`,
      html: `<p style="font-family:system-ui,sans-serif">${body.html}</p>${summary}${terms}`,
    },
  });
}

/** What shapes a customer email beyond which one it is. */
export interface EmailContext {
  paymentUrl?: string;
  /** How the booking was taken. Only the payment ask reads it — see below. */
  mode?: BookingModeValue | null;
  /** The status the booking left — the expiry email says different things for each. */
  from?: ReservationStatus;
  /** Manual-payment instructions from Settings → Booking, for the payment ask. */
  paymentInstructions?: string;
}

/** Plain text → escaped HTML, one `<br>` per line break. */
function multiline(text: string): string {
  return escapeHtml(text.replace(/\r\n?/g, '\n')).replace(/\n/g, '<br>');
}

/** The subject and opening paragraph of one customer email. Pure. */
export function customerEmailBody(
  which: ReservationEmail,
  locale: string,
  ctx: EmailContext = {},
): { subject: string; html: string } {
  const { paymentUrl, mode, from } = ctx;
  const instructions = ctx.paymentInstructions?.trim();
  const el = locale === 'el';
  switch (which) {
    case 'request_received':
      return {
        subject: el ? 'Λάβαμε το αίτημά σας' : 'We have your request',
        html: escapeHtml(
          el
            ? 'Θα επιβεβαιώσουμε τη διαθεσιμότητα και θα επικοινωνήσουμε σύντομα μαζί σας.'
            : 'We will check availability and come back to you shortly.',
        ),
      };
    case 'payment_link':
      return {
        // "Approved" is the answer to a request. An instant booking never asked
        // for one, so telling that customer they were approved describes a step
        // that did not happen — they simply owe the payment.
        subject:
          mode === 'instant'
            ? el
              ? 'Ολοκληρώστε την πληρωμή σας'
              : 'Complete your payment'
            : el
              ? 'Η κράτησή σας εγκρίθηκε — ολοκληρώστε την πληρωμή'
              : 'Your booking is approved — complete payment',
        html: paymentUrl
          ? `${escapeHtml(el ? 'Ολοκληρώστε την πληρωμή εδώ:' : 'Complete your payment here:')} <a href="${escapeHtml(
              paymentUrl,
            )}">${escapeHtml(paymentUrl)}</a>`
          : instructions
            ? `${escapeHtml(el ? 'Πώς να πληρώσετε:' : 'How to pay:')}<br>${multiline(instructions)}`
            : // No link and no instructions: say what is true. "We will send you
              // payment instructions" was a promise nothing kept.
              escapeHtml(
                el
                  ? 'Για να ολοκληρώσετε την πληρωμή, επικοινωνήστε μαζί μας απαντώντας σε αυτό το email και αναφέροντας τον κωδικό της κράτησής σας.'
                  : 'To arrange payment, please contact us by replying to this email, quoting your booking reference.',
              ),
      };
    case 'confirmed':
      return {
        subject: el ? 'Η κράτησή σας επιβεβαιώθηκε' : 'Your booking is confirmed',
        html:
          escapeHtml(el ? 'Η ημερομηνία σας είναι κρατημένη.' : 'Your date is reserved.') +
          (instructions ? `<br><br>${escapeHtml(el ? 'Πώς να πληρώσετε:' : 'How to pay:')}<br>${multiline(instructions)}` : ''),
      };
    case 'receipt':
      return {
        subject: el ? 'Απόδειξη πληρωμής' : 'Payment received',
        html: escapeHtml(el ? 'Ευχαριστούμε — λάβαμε την πληρωμή σας.' : 'Thank you — we have received your payment.'),
      };
    case 'cancelled':
      return {
        subject: el ? 'Η κράτησή σας ακυρώθηκε' : 'Your booking was cancelled',
        html: escapeHtml(el ? 'Η κράτησή σας ακυρώθηκε.' : 'Your booking has been cancelled.'),
      };
    case 'expired':
      // A booking that was accepted but never paid did not lapse for want of a
      // reply — it ran out of time to pay, and the customer should hear that.
      if (from === 'awaiting_payment') {
        return {
          subject: el ? 'Η κράτησή σας έληξε' : 'Your booking expired',
          html: escapeHtml(
            el
              ? 'Η προθεσμία πληρωμής πέρασε, οπότε η ημερομηνία αποδεσμεύτηκε. Επικοινωνήστε μαζί μας αν θέλετε ακόμη να κάνετε κράτηση.'
              : 'The payment deadline passed, so the date has been released. Do get in touch if you would still like to book.',
          ),
        };
      }
      return {
        subject: el ? 'Το αίτημά σας έληξε' : 'Your request expired',
        html: escapeHtml(
          el
            ? 'Δεν προλάβαμε να επιβεβαιώσουμε το αίτημά σας. Επικοινωνήστε μαζί μας αν σας ενδιαφέρει ακόμη.'
            : 'We did not manage to confirm your request in time. Do get in touch if you are still interested.',
        ),
      };
    default:
      return { subject: RESERVATION_STATUS_LABELS.pending, html: '' };
  }
}
