/**
 * Reservations — creating them, listing them, moving them through the machine.
 *
 * The rule this file exists to enforce: **the price and the availability are
 * decided here, never by the client.** A submitted total is ignored; the server
 * re-prices from the stored config and re-checks the date under a lock. What the
 * customer was shown and what is stored therefore cannot disagree, because only
 * one of them was ever authoritative.
 */
import 'server-only';

import { and, count, desc, eq, gte, inArray, isNotNull, like, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  badRequest,
  canRefundOnline,
  conflict,
  createRoute,
  idParam,
  created,
  getPaymentProvider,
  isOnlineProvider,
  logAudit,
  notFound,
  ok,
  paginated,
  refundedSoFar,
} from '../../core';
import { likeTerm } from '../../core/db/like';
import { assertNotLockedByOther, reservationLockKey } from '../../core/locks';
import { localeOrDefault } from '../../core/paths';
import { adapter, getDb, schema } from '../../db';
import type { ReservationStatus } from '../../db/adapters/mysql/schema/booking';
import { PERMISSIONS, requireApiPerm } from '../auth';
import { allocateSlots, confirmHolds, releaseHolds } from './allocation';
import {
  dayStatus,
  readAllocationMode,
  readDayRules,
  readStayRules,
  slotClaimFor,
  slotRequestsFor,
  staySlotRequestsFor,
  stayStatus,
} from './availability';
import type { StayQuote } from './stay';
import { sendReservationEmails, sendStatusEmail } from './emails';
import { canTransition, holdStateFor, initialStatus, operatorPaymentDeadline, paymentDeadlineForMove } from './lifecycle';
import { refundableAmount } from './payment-actions';
import { issuePaymentLink, markReservationPaid, requestPayment, resolveReservationAttention } from './payments';
import type { Quote } from './pricing';
import { priceSelection } from './quote';
import { formatBookingReference, normalizeReference } from './reference';
import { readItemCapacity, readStoredCapacities, resolveBookingPricing } from './read';
import {
  getBookingMode,
  getBookingPaymentProvider,
  getBookingTimezone,
  getDefaultCapacity,
  getDefaultLeadTimeHours,
  getPaymentHoldMinutes,
  getPaymentLinkTtlDays,
  getRequestExpiryHours,
} from './settings-read';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const reservationRequestSchema = z.object({
  /** Honeypot — a non-empty value means a bot. */
  _hp: z.string().optional(),
  slug: z.string().trim().min(1).max(191),
  /** Missing → the site's default locale, resolved in `createReservation`. */
  locale: z.string().trim().max(8).optional(),
  /** The booked day, or a stay's CHECK-IN date. */
  date: z.string().trim().regex(ISO_DATE),
  /** Check-out. Present only for a stay; a transport payload is unchanged. */
  endDate: z.string().trim().regex(ISO_DATE).optional(),
  persons: z.coerce.number().int().min(1).max(999).default(1),
  adults: z.coerce.number().int().min(1).max(99).optional(),
  children: z.coerce.number().int().min(0).max(99).optional(),
  resourceId: z.string().trim().max(64).optional(),
  extraIds: z.array(z.string().trim().max(64)).max(50).default([]),
  answers: z.record(z.string().max(64), z.string().trim().max(191)).default({}),
  customer: z.object({
    name: z.string().trim().min(1).max(191),
    email: z.string().trim().email().max(254),
    phone: z.string().trim().max(64).optional(),
  }),
  notes: z.string().trim().max(4000).optional(),
  acceptTerms: z.boolean().default(false),
});

export type ReservationRequestInput = z.infer<typeof reservationRequestSchema>;

export interface CreateReservationResult {
  reference: string;
  status: ReservationStatus;
  total: number;
  currency: string;
  /** The pay page. Non-null only in instant mode with a real gateway wired. */
  redirectUrl: string | null;
  expiresAt: Date | null;
}

/**
 * Both booking modes enter here.
 *
 * Whether the date is consumed depends entirely on the mode, and that is the
 * only branch: in request mode nothing is allocated, so concurrent enquiries for
 * one Saturday all succeed; in instant mode the date is taken inside the same
 * transaction that writes the row.
 */
export async function createReservation(
  input: ReservationRequestInput,
  /** Site facts the core cannot read itself; the request route binder supplies them. */
  site: { defaultLocale: string },
): Promise<CreateReservationResult> {
  // The visitor's page locale, or the site's main language when none came in.
  const locale = localeOrDefault(input.locale, site.defaultLocale);

  /*
   * Terms acceptance is enforced HERE, not by the disabled submit button.
   *
   * `acceptTerms` existed on the schema (`z.boolean().default(false)`) and was
   * never read, so the only thing standing between a request and a booking was a
   * greyed-out button in `BookingForm`. A POST that simply omits the field
   * defaults it to `false` and produced a reservation indistinguishable from one
   * where the customer had ticked the box — which is precisely the record the
   * acceptance exists to create. `orders.ts` has always refused this; booking was
   * the outlier.
   */
  if (!input.acceptTerms) throw badRequest('Please accept the terms to request this booking.');

  const resolved = await resolveBookingPricing(input.slug, locale);
  if (!resolved) throw notFound('That experience is no longer available.');

  const { doc, data, kind } = resolved;
  const isStay = kind === 'stay';

  // ── Price it. A posted total is not read at all, for either kind. ──
  // Through the same function as the public quote, calendar overrides included,
  // so the stored price is the one the customer was shown.
  const priced = await priceSelection(resolved, input);

  if (!priced.ok) throw conflict(priceRefusalMessage(priced, input.slug));
  const quote: Quote = priced;
  // The nights a stay occupies — check-in through the night before check-out.
  // One date for transport, so the ledger loop below is the same either way.
  const holdDates = isStay ? (priced as StayQuote).nightDates : [input.date];
  const nights = isStay ? (priced as StayQuote).nights : 0;

  // ── Every required question must be answered. ──
  const choices = Array.isArray(data.choices) ? data.choices : [];
  for (const raw of choices) {
    const choice = raw as Record<string, unknown>;
    const id = typeof choice.id === 'string' ? choice.id : '';
    if (id && !input.answers[id]) throw conflict('Please answer every question on the form.');
  }

  const [timeZone, defaultCapacity, defaultLead, siteMode, requestExpiryHours, paymentHoldMinutes] =
    await Promise.all([
      getBookingTimezone(),
      getDefaultCapacity(),
      getDefaultLeadTimeHours(),
      getBookingMode(),
      getRequestExpiryHours(),
      getPaymentHoldMinutes(),
    ]);

  // ── Is the date (or the whole range) bookable at all? ──
  // A stay always allocates per unit, whatever `allocationMode` says — see
  // `readAllocationMode`, which the public calendar reads with too.
  const allocationMode = readAllocationMode(data, kind);
  const itemCapacity = readItemCapacity(data, defaultCapacity);
  const now = new Date();

  // Capacity is deliberately reported as free here: this pass judges the
  // CALENDAR rules only, and the authoritative "is there room" check happens
  // under the row lock in `allocateSlots`.
  const openDay = (date: string) => ({ date, capacity: itemCapacity, held: 0, confirmed: 0, closed: false });

  if (isStay) {
    const stayRules = readStayRules(data, { leadTimeHours: defaultLead });
    const check = stayStatus(input.date, input.endDate ?? '', stayRules, openDay, 1, now, timeZone);
    if (!check.ok) throw conflict(unavailableMessage(check.status, check.date));
  } else {
    const rules = readDayRules(data, { leadTimeHours: defaultLead });
    const calendarStatus = dayStatus(openDay(input.date), rules, input.persons, now, timeZone);
    if (calendarStatus !== 'open') throw conflict(unavailableMessage(calendarStatus, input.date));
  }

  // ── Which flow? Resolved now and frozen on the row. ──
  const itemMode = typeof data.bookingMode === 'string' ? data.bookingMode : 'inherit';
  const mode = itemMode === 'request' || itemMode === 'instant' ? itemMode : siteMode;
  // With only the manual provider registered this is false, so instant mode
  // confirms outright and the customer is told how to pay. Registering a real
  // gateway flips it, and the reservation takes the awaiting-payment branch
  // instead — the model does not change, only which branch runs.
  const hasOnlinePayment = isOnlineProvider(getPaymentProvider(await getBookingPaymentProvider()));
  const status = initialStatus(mode, hasOnlinePayment);

  const resource = input.resourceId ? resolved.resources.find((r) => r.groupId === input.resourceId) : undefined;
  const bookingGroupId = doc.translationGroupId ?? `doc:${doc.id}`;

  const requests = isStay
    ? staySlotRequestsFor({
        bookingGroupId,
        resourceGroupId: resource?.groupId ?? '',
        resourceCapacityPerDay: resource?.capacityPerDay ?? 1,
        capacityPerDay: itemCapacity,
      })
    : slotRequestsFor({
        allocationMode,
        bookingGroupId,
        resourceGroupId: resource?.groupId ?? '',
        persons: input.persons,
        capacityPerDay: itemCapacity,
        resourceCapacityPerDay: resource?.capacityPerDay ?? 1,
      });

  const holdState = holdStateFor(status);
  const expiresAt =
    status === 'pending'
      ? new Date(now.getTime() + requestExpiryHours * 3_600_000)
      : status === 'awaiting_payment'
        ? new Date(now.getTime() + paymentHoldMinutes * 60_000)
        : null;

  const db = getDb();
  const reference = formatBookingReference(Number(input.date.slice(0, 4)));

  const reservationId = await db.transaction(async (tx) => {
    const result = await tx.insert(schema.reservations).values({
      reference,
      status,
      mode,
      allocationMode,
      bookingId: doc.id,
      bookingGroupId,
      bookingSlug: doc.slug,
      bookingTitle: String(data.title ?? doc.slug).slice(0, 255),
      // An option is a row on the experience, not a document of its own, so
      // there is no id to reference. The column stays for the reservations
      // taken while options WERE documents; `resource_group_id` is unchanged
      // and still the thing capacity is counted against.
      resourceId: null,
      resourceGroupId: resource?.groupId ?? '',
      resourceLabel: resource?.title ?? null,
      slotDate: input.date,
      endDate: isStay ? (input.endDate ?? null) : null,
      nights,
      slotLabel: firstAnswer(input.answers)?.slice(0, 64) ?? null,
      persons: quote.persons,
      adults: isStay ? (input.adults ?? quote.persons) : quote.persons,
      children: isStay ? (input.children ?? 0) : 0,
      email: input.customer.email.toLowerCase(),
      customerName: input.customer.name,
      phone: input.customer.phone ?? null,
      locale,
      notes: input.notes ?? null,
      currency: quote.currency,
      subtotal: quote.subtotal,
      total: quote.total,
      pricingSnapshot: { config: isStay ? resolved.stay : resolved.pricing, selection: { ...input, customer: undefined } },
      selections: input.answers,
      expiresAt,
    });
    const id = Array.isArray(result) ? result[0].insertId : (result as { insertId: number }).insertId;

    await insertItems(tx, id, quote);

    // An enquiry allocates nothing — that is the whole of request mode. A new
    // reservation can only start `pending`, `awaiting_payment` or `confirmed`,
    // so `released` is unreachable here; the guard makes that explicit rather
    // than assumed.
    if (holdState === 'held' || holdState === 'confirmed') {
      await allocateSlots(tx, id, holdDates, requests, expiresAt, holdState);
    }
    return id;
  });

  await logAudit({ action: 'booking.create', subjectType: 'booking', subjectId: String(reservationId) });

  // Instant with a real gateway: the customer has to be able to pay NOW. Until
  // this existed the row sat in `awaiting_payment` holding the dates, and
  // nothing the customer could do reached a payment page — the hold just ran
  // out. `redirectUrl` was documented and read by the form, but never filled.
  let paymentUrl: string | null = null;
  if (status === 'awaiting_payment') {
    try {
      ({ url: paymentUrl } = await issuePaymentLink(reservationId, {
        defaultLocale: site.defaultLocale,
        // The link must not outlive the hold it pays for.
        expiresAt: expiresAt ?? undefined,
        itemDepositPercent: Number.isFinite(Number(data.depositPercent))
          ? Number(data.depositPercent)
          : null,
      }));
    } catch (err) {
      // The reservation and its holds are already committed. Failing here would
      // tell the customer nothing happened while the date is in fact taken, so
      // this degrades to the operator-issues-a-link path the same way the
      // emails degrade — and the email says "we will send you instructions".
      console.error('[booking/reservations] payment link failed', { reservationId, err });
    }
  }

  // Best effort, and recorded on the row either way.
  await sendReservationEmails(reservationId, { paymentUrl });

  return {
    reference,
    status,
    total: quote.total,
    currency: quote.currency,
    redirectUrl: paymentUrl,
    expiresAt,
  };
}

function firstAnswer(answers: Record<string, string>): string | undefined {
  const values = Object.values(answers);
  return values.length > 0 ? values[0] : undefined;
}

/**
 * Why a price could not be produced, in words a customer can act on.
 *
 * The split matters: a refusal the customer caused (too short a stay, too many
 * guests) tells them what to change; a refusal the OPERATOR caused (overlapping
 * seasons, a broken config) must not leak the internals, so it is logged and
 * reported as a generic "not bookable online". Telling a guest their booking
 * failed because season 3 overlaps season 1 is not help.
 */
function priceRefusalMessage(failure: { reason: string } & Record<string, unknown>, slug: string): string {
  switch (failure.reason) {
    case 'extra_required':
      return 'Please choose at least one extra.';
    case 'price_on_request':
      return 'This experience is priced on request — please contact us.';
    case 'missing_dates':
      return 'Please choose both a check-in and a check-out date.';
    case 'invalid_range':
      return 'Check-out must be after check-in.';
    case 'min_nights':
      return `The minimum stay is ${String(failure.minNights)} night(s).`;
    case 'max_nights':
      return `The maximum stay is ${String(failure.maxNights)} night(s).`;
    case 'over_occupancy':
      return `This can take at most ${String(failure.maxOccupancy)} guest(s).`;
    default:
      console.error('[booking/request] refused to price', { slug, reason: failure.reason });
      return 'This experience cannot be booked online right now.';
  }
}

function unavailableMessage(status: string, date?: string): string {
  // A stay spans several dates, so the one that failed is named. Saying "that
  // date is unavailable" about a week-long booking leaves the guest guessing.
  const which = date ? date : 'That date';
  switch (status) {
    case 'past':
      return `${which} has already passed.`;
    case 'out_of_season':
      return `${which} is outside the season for this experience.`;
    case 'wrong_weekday':
      return 'This experience does not run on that day of the week.';
    case 'too_soon':
      return `${which} is too close — please choose a later one.`;
    case 'too_far':
      return `${which} is too far ahead to book yet.`;
    case 'closed':
      return `${which} is not available.`;
    case 'invalid_range':
      return 'Check-out must be after check-in.';
    case 'min_nights':
      return 'That stay is shorter than the minimum for these dates.';
    case 'max_nights':
      return 'That stay is longer than the maximum for these dates.';
    case 'bad_checkin_day':
      return 'Check-in is not available on that day of the week.';
    case 'bad_checkout_day':
      return 'Check-out is not available on that day of the week.';
    default:
      return `${which} is no longer available.`;
  }
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

async function insertItems(tx: Tx, reservationId: number, quote: Quote): Promise<void> {
  if (quote.lines.length === 0) return;
  await tx.insert(schema.reservationItems).values(
    quote.lines.map((line, position) => ({
      reservationId,
      kind: line.kind,
      code: line.code.slice(0, 64),
      label: line.label.slice(0, 255),
      refId: line.refId?.slice(0, 64) ?? null,
      quantity: line.quantity,
      unitAmount: line.unitAmount,
      amount: line.amount,
      position,
    })),
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Reading                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

export interface ListReservationsOptions {
  search?: string;
  status?: ReservationStatus;
  from?: string;
  to?: string;
  bookingGroupId?: string;
  /** The operator's queue: enquiries awaiting a reply, and payments that could
   *  not be applied (flagged by `flagForAttention` in `payments.ts`). */
  needsAction?: boolean;
  page?: number;
  pageSize?: number;
}

export async function listReservations(opts: ListReservationsOptions = {}) {
  const db = getDb();
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));

  const filters = [];
  if (opts.status) filters.push(eq(schema.reservations.status, opts.status));
  if (opts.from) filters.push(gte(schema.reservations.slotDate, opts.from));
  if (opts.to) filters.push(lte(schema.reservations.slotDate, opts.to));
  if (opts.bookingGroupId) filters.push(eq(schema.reservations.bookingGroupId, opts.bookingGroupId));
  if (opts.needsAction) {
    filters.push(
      or(
        eq(schema.reservations.status, 'pending'),
        isNotNull(adapter.jsonScalar(schema.reservations.metadata, 'attention.reason')),
      ),
    );
  }
  if (opts.search) {
    const term = likeTerm(opts.search.trim());
    filters.push(
      or(
        like(schema.reservations.reference, term),
        like(schema.reservations.email, term),
        like(schema.reservations.customerName, term),
        like(schema.reservations.bookingTitle, term),
      ),
    );
  }
  const where = filters.length ? and(...filters) : undefined;

  const [items, [total]] = await Promise.all([
    db
      .select()
      .from(schema.reservations)
      .where(where)
      .orderBy(desc(schema.reservations.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ value: count() }).from(schema.reservations).where(where),
  ]);

  return { items, page, pageSize, total: Number(total?.value ?? 0) };
}

/**
 * Every experience that has bookings, for the list's Experience filter.
 *
 * From the reservations themselves rather than the published experiences, so an
 * experience since unpublished or deleted can still be filtered on — its
 * bookings did not go away. One entry per translation group; the title is the
 * one the most recent booking was taken under.
 */
export async function listReservationExperiences(): Promise<{ id: string; title: string }[]> {
  const rows = await getDb()
    .select({
      id: schema.reservations.bookingGroupId,
      title: schema.reservations.bookingTitle,
      latest: sql<string>`MAX(${schema.reservations.createdAt})`,
    })
    .from(schema.reservations)
    .groupBy(schema.reservations.bookingGroupId, schema.reservations.bookingTitle)
    .orderBy(desc(sql`MAX(${schema.reservations.createdAt})`));

  const seen = new Map<string, string>();
  for (const row of rows) if (!seen.has(row.id)) seen.set(row.id, row.title);
  return [...seen.entries()]
    .map(([id, title]) => ({ id, title }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

export async function getReservation(id: number) {
  const db = getDb();
  const [reservation] = await db.select().from(schema.reservations).where(eq(schema.reservations.id, id)).limit(1);
  if (!reservation) return null;

  const [items, payments, events, holds] = await Promise.all([
    db
      .select()
      .from(schema.reservationItems)
      .where(eq(schema.reservationItems.reservationId, id))
      .orderBy(schema.reservationItems.position),
    db.select().from(schema.reservationPayments).where(eq(schema.reservationPayments.reservationId, id)),
    db
      .select()
      .from(schema.reservationEvents)
      .where(eq(schema.reservationEvents.reservationId, id))
      .orderBy(desc(schema.reservationEvents.createdAt)),
    db.select().from(schema.reservationHolds).where(eq(schema.reservationHolds.reservationId, id)),
  ]);

  return { reservation, items, payments, events, holds, drift: await priceDrift(reservation) };
}

export interface PriceDrift {
  /** What the customer was quoted, in minor units. */
  quoted: number;
  /** What today's rules give for the same selection. */
  current: number;
  changed: boolean;
}

/**
 * Has the price of this booking changed since the customer was quoted?
 *
 * An order cannot drift like this, because a product's price does not depend on
 * a date the customer picked. A booking's does: edit a season, and every
 * unconfirmed reservation touching it is now quoted a figure the rules no longer
 * produce. The operator needs to see that before they confirm, so this compares
 * the frozen items against a fresh computation of the same selection.
 *
 * Returns null when it cannot be established — a deleted item, an unpriceable
 * config — because "we don't know" must not render as "nothing changed".
 */
async function priceDrift(reservation: {
  bookingSlug: string | null;
  locale: string | null;
  total: number;
  pricingSnapshot: Record<string, unknown> | null;
}): Promise<PriceDrift | null> {
  const selection = (reservation.pricingSnapshot?.selection ?? null) as Record<string, unknown> | null;
  if (!reservation.bookingSlug || !selection) return null;

  try {
    const resolved = await resolveBookingPricing(reservation.bookingSlug, reservation.locale ?? 'el');
    if (!resolved) return null;
    // Whichever engine the experience uses. This called the transport engine
    // unconditionally, so a stay was re-priced as a day trip and the warning
    // compared two unrelated numbers.
    const fresh = await priceSelection(resolved, {
      date: typeof selection.date === 'string' ? selection.date : undefined,
      endDate: typeof selection.endDate === 'string' ? selection.endDate : undefined,
      persons: Number(selection.persons) || 1,
      adults: Number(selection.adults) || undefined,
      children: Number(selection.children) || undefined,
      resourceId: typeof selection.resourceId === 'string' ? selection.resourceId : undefined,
      extraIds: Array.isArray(selection.extraIds) ? (selection.extraIds as string[]) : [],
    });
    if (!fresh.ok) return null;
    return {
      quoted: reservation.total,
      current: fresh.total,
      changed: fresh.total !== reservation.total,
    };
  } catch {
    return null;
  }
}

/**
 * Other live enquiries competing for the same date.
 *
 * In request mode this is the normal case, not an edge case: the admin needs to
 * see the other three people who asked for that Saturday before accepting one of
 * them, rather than discovering the conflict as a 409.
 */
export async function competingReservations(id: number) {
  const db = getDb();
  const [row] = await db.select().from(schema.reservations).where(eq(schema.reservations.id, id)).limit(1);
  if (!row) return [];

  return db
    .select({
      id: schema.reservations.id,
      reference: schema.reservations.reference,
      customerName: schema.reservations.customerName,
      persons: schema.reservations.persons,
      status: schema.reservations.status,
      createdAt: schema.reservations.createdAt,
    })
    .from(schema.reservations)
    .where(
      and(
        eq(schema.reservations.bookingGroupId, row.bookingGroupId),
        eq(schema.reservations.slotDate, row.slotDate),
        inArray(schema.reservations.status, ['pending', 'awaiting_payment', 'confirmed']),
        sql`${schema.reservations.id} <> ${id}`,
      ),
    )
    .orderBy(schema.reservations.createdAt);
}

/** Guest lookup: reference + matching email. Read-only, and no token is exposed. */
export async function lookupReservation(reference: string, email: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.reservations)
    .where(
      and(
        eq(schema.reservations.reference, normalizeReference(reference)),
        eq(schema.reservations.email, email.trim().toLowerCase()),
      ),
    )
    .limit(1);
  if (!row) return null;

  const items = await db
    .select({
      label: schema.reservationItems.label,
      quantity: schema.reservationItems.quantity,
      unitAmount: schema.reservationItems.unitAmount,
      amount: schema.reservationItems.amount,
    })
    .from(schema.reservationItems)
    .where(eq(schema.reservationItems.reservationId, row.id))
    .orderBy(schema.reservationItems.position);

  return {
    reference: row.reference,
    status: row.status,
    bookingTitle: row.bookingTitle,
    bookingSlug: row.bookingSlug,
    slotDate: row.slotDate,
    // A stay is a range; its check-in alone reads like a one-night booking.
    endDate: row.endDate,
    nights: row.nights,
    persons: row.persons,
    resourceLabel: row.resourceLabel,
    currency: row.currency,
    total: row.total,
    amountPaid: row.amountPaid,
    items,
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Transitions                                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

export interface StatusChangeResult {
  id: number;
  status: ReservationStatus;
}

/**
 * Move a reservation, enforcing the machine and the ledger together.
 *
 * `pending → awaiting_payment` is the transition that can fail: it is where the
 * date is actually claimed, so accepting the second of two competing enquiries
 * for an exclusive date returns a 409 instead of quietly overbooking.
 */
export async function updateReservationStatus(
  id: number,
  to: ReservationStatus,
  opts: {
    actorUserId?: number;
    reason?: string;
    notify?: boolean;
    /** The site's default locale — needed to build a payment link when this move asks for payment. */
    defaultLocale?: string;
  } = {},
): Promise<StatusChangeResult> {
  const db = getDb();
  const [current] = await db.select().from(schema.reservations).where(eq(schema.reservations.id, id)).limit(1);
  if (!current) throw notFound('Reservation not found.');
  if (!canTransition(current.status, to)) {
    throw conflict(`A ${current.status} booking cannot become ${to}.`);
  }

  const [defaultCapacity, linkTtlDays] = await Promise.all([getDefaultCapacity(), getPaymentLinkTtlDays()]);

  const fromState = holdStateFor(current.status);
  const toState = holdStateFor(to);
  const now = new Date();
  // An operator's move into `awaiting_payment` gives the customer as long to pay
  // as the payment link lasts — never the instant-checkout hold in minutes.
  // None when the date is already confirmed — see `paymentDeadlineForMove`.
  const paymentDeadline = paymentDeadlineForMove(current.status, to, operatorPaymentDeadline(now, linkTtlDays));

  await db.transaction(async (tx) => {
    if (toState === 'released') {
      await releaseHolds(tx, id);
    } else if (toState === 'confirmed' && fromState) {
      await confirmHolds(tx, id);
    } else if (toState && !fromState) {
      // The date was never claimed — claim it now, under the lock. This is the
      // only place an operator's accept can be refused.
      // The ceiling is the EXPERIENCE's, read back from its document — the site
      // default is only what an experience that states none inherits. Reaching
      // for the default here accepted a capacity-1 date as many times as the
      // site-wide figure allowed.
      const capacities = await readStoredCapacities(
        tx,
        current.bookingId,
        current.resourceGroupId || null,
        defaultCapacity,
      );

      const { requests, slotDates } = slotClaimFor({
        allocationMode: current.allocationMode,
        bookingGroupId: current.bookingGroupId,
        resourceGroupId: current.resourceGroupId,
        persons: current.persons,
        capacityPerDay: capacities.item,
        resourceCapacityPerDay: capacities.option,
        slotDate: current.slotDate,
        endDate: current.endDate,
        nights: current.nights,
      });
      await allocateSlots(tx, id, slotDates, requests, paymentDeadline, toState);
    }

    const moved = await tx
      .update(schema.reservations)
      .set({
        status: to,
        version: current.version + 1,
        expiresAt: paymentDeadline,
      })
      .where(and(eq(schema.reservations.id, id), eq(schema.reservations.version, current.version)));

    /*
     * The version guard only guards anything if somebody reads its result.
     *
     * `current` is read OUTSIDE this transaction, so between that read and this
     * write another request can move the same reservation; `eq(version,
     * current.version)` is what catches it, and the row count is the only way it
     * reports. Discarded, the whole function carried on as though the write had
     * landed: it inserted a `status.<to>` event, wrote an audit entry saying the
     * booking had moved, emailed the customer that their booking was confirmed,
     * and returned success — all describing a status the database never took.
     *
     * Worse than a wrong answer, the hold work above (`allocateSlots` /
     * `releaseHolds` / `confirmHolds`) is in this same transaction and WOULD have
     * committed, so a refused transition still moved capacity: slots allocated
     * for a booking that stayed cancelled, or released from one that stayed
     * confirmed. Throwing rolls all of it back together, which is the only
     * outcome where the ledger and the status agree.
     *
     * `affectedRows` counts rows MATCHED, not changed, so a transition that
     * happens to set the same values still counts as a hit.
     */
    if (adapter.affectedRows(moved) === 0) {
      throw conflict('This booking was changed by someone else — reload and try again.');
    }

    await tx.insert(schema.reservationEvents).values({
      reservationId: id,
      kind: `status.${to}`,
      fromStatus: current.status,
      toStatus: to,
      actorUserId: opts.actorUserId ?? null,
      detail: opts.reason ? { reason: opts.reason } : null,
    });
  });

  await logAudit({
    action: 'booking.status',
    subjectType: 'booking',
    subjectId: String(id),
    before: { status: current.status },
    after: { status: to },
    userId: opts.actorUserId,
  });

  if (opts.notify !== false) {
    // Asking for payment is more than an email: with a gateway it issues the
    // link the email carries. "Accept & send payment link" used to change the
    // status only, and the customer was told instructions would follow.
    if (to === 'awaiting_payment') await requestPayment(id, current.status, { defaultLocale: opts.defaultLocale });
    else await sendStatusEmail(id, current.status, to);
  }

  return { id, status: to };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Route factories                                                             */
/* ────────────────────────────────────────────────────────────────────────── */

/** `POST /api/cms/booking/request` — public. Both modes enter here. */
export function bookingRequestRoute(opts: {
  /** The site's default locale (`config.defaultLocale`), for requests that arrive without one. */
  defaultLocale: string;
}) {
  return createRoute({
    rateLimit: { scope: 'booking-request', max: 5, windowMs: 60_000 },
    input: reservationRequestSchema,
    handler: async ({ input }) => {
      // Honeypot: pretend success so the bot cannot tell it was caught.
      if (input._hp) return created({ reference: 'BKG-0000-00000000', status: 'pending', redirectUrl: null });
      return created(await createReservation(input, { defaultLocale: opts.defaultLocale }));
    },
  });
}

const lookupBody = z.object({
  reference: z.string().trim().min(1).max(32),
  email: z.string().trim().email().max(254),
});

/** `POST /api/cms/booking/lookup` — public, read-only. */
export function bookingLookupRoute() {
  return createRoute({
    rateLimit: { scope: 'booking-lookup', max: 20, windowMs: 60_000 },
    input: lookupBody,
    handler: async ({ input }) => {
      const found = await lookupReservation(input.reference, input.email);
      if (!found) throw notFound('No booking matches that reference and email.');
      return ok(found);
    },
  });
}

/**
 * `true`/`1` or `false`/`0`, nothing else. `z.coerce.boolean()` is `Boolean(v)`,
 * so the string `'false'` came out `true` and `?needsAction=false` filtered to
 * the queue it was asking to leave.
 */
const queryBoolean = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

export const reservationsListQuery = z.object({
  search: z.string().trim().max(191).optional(),
  status: z.enum(schema.reservationStatusValues).optional(),
  from: z.string().trim().regex(ISO_DATE).optional(),
  to: z.string().trim().regex(ISO_DATE).optional(),
  needsAction: queryBoolean.optional(),
  /** An experience's translation-group id, as the list's Experience filter sends it. */
  experience: z.string().trim().min(1).max(191).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export function reservationsListRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.reservationsRead),
    query: reservationsListQuery,
    handler: async ({ query }) => {
      const { experience, ...rest } = query;
      const result = await listReservations({ ...rest, bookingGroupId: experience });
      return paginated(result.items, {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
      });
    },
  });
}

export function reservationGetRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.reservationsRead),
    handler: async ({ params }) => {
      const id = idParam(params.id);
      const found = await getReservation(id);
      if (!found) throw notFound('Reservation not found.');
      const [competing, providerKey, linkTtlDays] = await Promise.all([
        competingReservations(id),
        getBookingPaymentProvider(),
        getPaymentLinkTtlDays(),
      ]);
      const provider = getPaymentProvider(providerKey);
      return ok({
        ...found,
        // Each payment carries how much of it can still go back online, so the
        // drawer offers "Refund" only where the refund route would accept one.
        payments: found.payments.map((p) => ({
          ...p,
          refundable: refundableAmount(p, canRefundOnline(getPaymentProvider(p.provider))),
          refundedAmount: refundedSoFar(p.metadata),
        })),
        competing,
        payment: { online: isOnlineProvider(provider), label: provider.label, linkTtlDays },
      });
    },
  });
}

const statusBody = z
  .object({
    status: z.enum(schema.reservationStatusValues).optional(),
    reason: z.string().trim().max(500).optional(),
    notify: z.boolean().optional(),
    /** Take a flagged payment out of "Needs action" without refunding it. */
    resolveAttention: z.literal(true).optional(),
  })
  .refine((b) => (b.status ? 1 : 0) + (b.resolveAttention ? 1 : 0) === 1, {
    message: 'Send either a status or resolveAttention.',
  });

export function reservationUpdateRoute(opts: {
  /** The site's default locale (`config.defaultLocale`) — accepting emails a payment link prefixed against it. */
  defaultLocale: string;
}) {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.reservationsWrite),
    input: statusBody,
    handler: async ({ params, input, auth }) => {
      const id = idParam(params.id);
      await assertNotLockedByOther('reservation', reservationLockKey(id), auth?.userId ?? null);
      if (input.resolveAttention) return ok(await resolveReservationAttention(id, auth?.userId));
      const move = {
        actorUserId: auth?.userId,
        reason: input.reason,
        notify: input.notify,
        defaultLocale: opts.defaultLocale,
      };
      // "Mark paid" records the balance as a payment, so the money and the
      // status agree — see `markReservationPaid`.
      const to = input.status;
      if (!to) throw badRequest('Send a status.');
      if (to === 'paid') return ok(await markReservationPaid(id, move));
      return ok(await updateReservationStatus(id, to, move));
    },
  });
}
