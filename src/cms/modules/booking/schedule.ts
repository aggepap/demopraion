/**
 * The availability calendar — the operator's view of, and control over, one
 * slot's dates.
 *
 * Each experience already declares its own season, weekdays, capacity and
 * cut-off in its editor. That is the RULE. This file is about the EXCEPTIONS:
 * closing a single date, changing how many bookings it takes, overriding its
 * price. All three live on `booking_slots`, one row per (slot, date), which is
 * the same row `allocateSlots` locks — so an override written here is visible
 * to the very next booking attempt with no cache to invalidate.
 *
 * An override row is deleted rather than blanked when it says nothing, so
 * "inherit the document's rules" has exactly one representation.
 */
import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { PERMISSIONS, requireApiPerm } from '../auth';
import { createRoute, logAudit, ok } from '../../core';
import { localeOrDefault } from '../../core/paths';
import { getDb, schema } from '../../db';
import { findOverbookedSlots, getDayStates } from './allocation';
import { bookingSlotKey, eachDate, readAllocationMode, resourceSlotKey } from './availability';
import { DEFAULT_BOOKING_TYPE } from './collection';
import { readBookingKind, readItemCapacity, readOptions, rec, resolveLoc, type Localized } from './data';
import { getDefaultCapacity } from './settings-read';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** One thing whose dates can be managed: an experience, or one of its options. */
export interface SchedulableSlot {
  slotKey: string;
  label: string;
  /** The experience this belongs to; equal to `label` for an experience row. */
  experience: string;
  kind: 'transport' | 'stay';
  /** What the slot's capacity is when no override says otherwise. */
  defaultCapacity: number;
  isOption: boolean;
}

/**
 * Everything with a calendar, flattened for a picker.
 *
 * An experience with options contributes its options rather than itself when it
 * is a STAY, because that is where a stay's nights are actually held — offering
 * the experience slot would be offering a calendar nothing ever writes to.
 * Transport keeps both: `allocationMode: 'resource'` holds the experience slot
 * as well as the option's.
 */
export async function listSchedulableSlots(locale: string): Promise<SchedulableSlot[]> {
  const db = getDb();
  const defaultCapacity = await getDefaultCapacity();

  const rows = await db
    .select({
      id: schema.documents.id,
      slug: schema.documents.slug,
      data: schema.documents.data,
      translationGroupId: schema.documents.translationGroupId,
    })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.type, DEFAULT_BOOKING_TYPE),
        eq(schema.documents.status, 'published'),
        eq(schema.documents.locale, locale),
      ),
    );

  const out: SchedulableSlot[] = [];
  for (const row of rows) {
    const data = rec(row.data);
    const kind = readBookingKind(data);
    const title = resolveLoc(data.title as Localized, locale) || row.slug;
    const groupId = row.translationGroupId ?? `doc:${row.id}`;
    const capacity = readItemCapacity(data, defaultCapacity);
    const options = readOptions(data, locale);

    const stayWithOptions = kind === 'stay' && options.length > 0;
    if (!stayWithOptions) {
      out.push({
        slotKey: bookingSlotKey(groupId),
        label: title,
        experience: title,
        kind,
        // `exclusive` transport takes the whole day per booking: its slot is one
        // of one (`slotRequestsFor`), whatever the item's seat count says.
        defaultCapacity:
          kind === 'stay'
            ? Math.max(1, capacity)
            : readAllocationMode(data, kind) === 'exclusive'
              ? 1
              : capacity,
        isOption: false,
      });
    }

    for (const option of options) {
      out.push({
        slotKey: resourceSlotKey(option.groupId),
        label: option.title,
        experience: title,
        kind,
        defaultCapacity: option.capacityPerDay,
        isOption: true,
      });
    }
  }

  return out.sort((a, b) => a.experience.localeCompare(b.experience) || a.label.localeCompare(b.label));
}

export interface ScheduleDay {
  date: string;
  capacity: number;
  held: number;
  confirmed: number;
  closed: boolean;
  priceOverride: number | null;
  note: string | null;
  /** True when a `booking_slots` row exists for this date — i.e. the operator
   *  has said something about it, rather than it inheriting the document. */
  overridden: boolean;
}

/** One slot's dates between `from` and `to`, with usage and overrides merged. */
export async function getSchedule(
  slotKey: string,
  from: string,
  to: string,
  defaultCapacity: number,
): Promise<ScheduleDay[]> {
  // 92 days — the same ceiling the public calendar uses, and enough for the
  // three-month view without letting a crafted range scan a decade.
  const dates = eachDate(from, to, 92);
  if (dates.length === 0) return [];

  const db = getDb();
  const [states, overrides] = await Promise.all([
    getDayStates(slotKey, dates, defaultCapacity),
    db
      .select()
      .from(schema.bookingSlots)
      .where(and(eq(schema.bookingSlots.slotKey, slotKey), inArray(schema.bookingSlots.slotDate, dates))),
  ]);
  const overriddenDates = new Set(overrides.map((o) => o.slotDate));

  return dates.map((date) => {
    const state = states.get(date);
    return {
      date,
      capacity: state?.capacity ?? defaultCapacity,
      held: state?.held ?? 0,
      confirmed: state?.confirmed ?? 0,
      closed: state?.closed ?? false,
      priceOverride: state?.priceOverride ?? null,
      note: state?.note ?? null,
      overridden: overriddenDates.has(date),
    };
  });
}

export interface SlotOverrideInput {
  slotKey: string;
  slotDate: string;
  /** Null = inherit the document's capacity. */
  capacity?: number | null;
  closed?: boolean;
  /** Minor units. Null = no override. */
  priceOverride?: number | null;
  note?: string | null;
}

/**
 * Write (or clear) one date's exception.
 *
 * Deliberately does NOT check whether the new capacity is below what is already
 * held. An operator lowering a date's capacity after taking bookings is doing
 * something intentional — a boat broke, a room flooded — and refusing them
 * would leave no way to say it. The consequence is visible instead:
 * `findOverbookedSlots` reports the date, and the calendar flags it.
 */
export async function setSlotOverride(input: SlotOverrideInput): Promise<{ cleared: boolean }> {
  const db = getDb();
  const capacity = input.capacity ?? null;
  const closed = input.closed === true;
  const priceOverride = input.priceOverride ?? null;
  const note = input.note?.trim() ? input.note.trim().slice(0, 191) : null;

  // An override that says nothing is not an override. Deleting rather than
  // storing a row of nulls keeps "inherits the document" to one representation,
  // so the calendar's "overridden" flag means what it says.
  if (capacity == null && !closed && priceOverride == null && !note) {
    await db
      .delete(schema.bookingSlots)
      .where(
        and(eq(schema.bookingSlots.slotKey, input.slotKey), eq(schema.bookingSlots.slotDate, input.slotDate)),
      );
    await logAudit({
      action: 'booking.schedule.clear',
      subjectType: 'booking_slot',
      subjectId: `${input.slotKey}@${input.slotDate}`,
    });
    return { cleared: true };
  }

  await db
    .insert(schema.bookingSlots)
    .values({ slotKey: input.slotKey, slotDate: input.slotDate, capacity, closed, priceOverride, note })
    .onDuplicateKeyUpdate({ set: { capacity, closed, priceOverride, note } });

  await logAudit({
    action: 'booking.schedule.set',
    subjectType: 'booking_slot',
    subjectId: `${input.slotKey}@${input.slotDate}`,
    after: { capacity, closed, priceOverride, note },
  });
  return { cleared: false };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Route factories                                                             */
/* ────────────────────────────────────────────────────────────────────────── */

const scheduleQuery = z.object({
  slotKey: z.string().trim().min(1).max(80).optional(),
  from: z.string().trim().regex(ISO_DATE),
  to: z.string().trim().regex(ISO_DATE),
  defaultCapacity: z.coerce.number().int().min(1).max(9999).optional(),
  /** Missing → the site's default locale. */
  locale: z.string().trim().max(8).optional(),
});

/** `GET /api/cms/booking/schedule` — the slot list, and one slot's dates. */
export function scheduleReadRoute(opts: {
  /** The site's default locale (`config.defaultLocale`), for requests that name none. */
  defaultLocale: string;
}) {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.scheduleRead),
    query: scheduleQuery,
    handler: async ({ query }) => {
      const slots = await listSchedulableSlots(localeOrDefault(query.locale, opts.defaultLocale));
      const slot = query.slotKey ? slots.find((s) => s.slotKey === query.slotKey) : slots[0];
      const days = slot
        ? await getSchedule(slot.slotKey, query.from, query.to, query.defaultCapacity ?? slot.defaultCapacity)
        : [];
      // "Should always be empty" is a claim worth being able to check. Scoped
      // to the window on screen so the banner is about what the operator is
      // looking at.
      // Judged against each slot's own default where a date has no override —
      // the same figure the calendar shows.
      const defaults = new Map(slots.map((s) => [s.slotKey, s.defaultCapacity]));
      const overbooked = await findOverbookedSlots(query.from, query.to, (key) => defaults.get(key));
      return ok({
        slots,
        slot: slot ?? null,
        days,
        overbooked: overbooked.filter((o) => !slot || o.slotKey === slot.slotKey),
      });
    },
  });
}

const overrideBody = z.object({
  slotKey: z.string().trim().min(1).max(80),
  slotDate: z.string().trim().regex(ISO_DATE),
  capacity: z.number().int().min(0).max(9999).nullable().optional(),
  closed: z.boolean().optional(),
  /** Major units on the wire, minor units in the column — the same convention
   *  the rest of booking uses for anything an editor types. */
  price: z.number().min(0).max(1_000_000).nullable().optional(),
  note: z.string().trim().max(191).nullable().optional(),
});

/** `PUT /api/cms/booking/schedule` — write or clear one date's exception. */
export function scheduleWriteRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.scheduleWrite),
    input: overrideBody,
    handler: async ({ input }) => {
      const result = await setSlotOverride({
        slotKey: input.slotKey,
        slotDate: input.slotDate,
        capacity: input.capacity ?? null,
        closed: input.closed,
        priceOverride: input.price == null ? null : Math.round(input.price * 100),
        note: input.note ?? null,
      });
      return ok(result);
    },
  });
}
