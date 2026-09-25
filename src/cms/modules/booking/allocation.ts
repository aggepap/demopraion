/**
 * Seat allocation — the part that makes double-booking impossible.
 *
 * Mechanism: `SELECT … FOR UPDATE` on a `booking_slots` mutex row, inside a
 * transaction, with the seats taken derived by an aggregate read under that
 * lock. Same primitive `createOrder` already uses for stock.
 *
 * Seats are DERIVED, never counted into a column. A counter plus the rows it
 * summarises are two representations of one fact, and they drift — a shape this
 * codebase has been bitten by before. Aggregating under a lock already held is a
 * single indexed SUM over a handful of rows; if volume ever makes that matter,
 * add a cached counter *and* keep `findOverbookedSlots` to prove it.
 */
import 'server-only';

import { and, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';

import { conflict } from '../../core';
import { adapter, getDb, schema } from '../../db';
import type { Reservation } from '../../db/adapters/mysql/schema/booking';
import {
  holdConfirmationVerdict,
  isHoldExpired,
  isOverCapacity,
  overbookedFrom,
  remainingSeats,
  resolveCapacity,
  slotClaimFor,
  slotDatePairs,
  type DayState,
  type SlotRequest,
} from './availability';
import { sendStatusEmail } from './emails';
import { readStoredCapacities } from './read';

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Seats currently claimed on one slot+date, split by how firm the claim is. */
export interface SlotUsage {
  held: number;
  confirmed: number;
}

/**
 * Held + confirmed seats for a slot on a date.
 *
 * A `held` row whose `expires_at` has passed stops counting immediately, before
 * the cron gets round to expiring its reservation — otherwise an abandoned
 * checkout would keep a date locked for as long as the sweep interval, which is
 * exactly when someone else is trying to book it.
 *
 * `now` is a parameter, and deliberately not `NOW()`.
 *
 * `expires_at` is written by the app: mysql2 defaults to `timezone: 'local'`, so
 * the value goes out formatted in the NODE process's zone. Reading it back the
 * same way cancels that conversion exactly, which is why binding a JS `Date`
 * here is correct however the two machines are configured. `NOW()` is evaluated
 * by the SERVER, in the MySQL session's zone, and skews against the stored value
 * by the offset between the two. In the direction where the session runs ahead,
 * live holds read as expired — and a 20-minute payment hold under a 3-hour skew
 * is born expired, so it never protects the seat it was taken for at all.
 *
 * The same predicate is written this way in `getDayStates` below and in the
 * expiry sweep. One clock, the app's, everywhere.
 */
async function readUsage(tx: Tx, slotKey: string, slotDate: string, now: Date): Promise<SlotUsage> {
  const [row] = await tx
    .select({
      held: sql<number>`COALESCE(SUM(CASE WHEN ${schema.reservationHolds.state} = 'held'
        AND (${schema.reservationHolds.expiresAt} IS NULL OR ${schema.reservationHolds.expiresAt} > ${now})
        THEN ${schema.reservationHolds.seats} ELSE 0 END), 0)`,
      confirmed: sql<number>`COALESCE(SUM(CASE WHEN ${schema.reservationHolds.state} = 'confirmed'
        THEN ${schema.reservationHolds.seats} ELSE 0 END), 0)`,
    })
    .from(schema.reservationHolds)
    .where(
      and(eq(schema.reservationHolds.slotKey, slotKey), eq(schema.reservationHolds.slotDate, slotDate)),
    );

  return { held: Number(row?.held ?? 0), confirmed: Number(row?.confirmed ?? 0) };
}

/**
 * Reserve every (slot, date) pair a reservation needs, or throw.
 *
 * Must be called INSIDE the caller's transaction, so a refusal rolls the
 * reservation back with it — including any pair already taken earlier in the
 * loop.
 *
 * `slotDates` is a single date for transport and one entry per NIGHT for a
 * stay. Every pair is locked in `(slotKey, slotDate)` order, and that is not
 * cosmetic: two stays whose date ranges overlap would deadlock if one locked
 * the 14th before the 15th and the other did the reverse. Sorting here rather
 * than trusting callers means no future caller can reintroduce the hazard by
 * passing its nights in a different sequence.
 */
export async function allocateSlots(
  tx: Tx,
  reservationId: number,
  slotDates: string | string[],
  requests: SlotRequest[],
  holdExpiresAt: Date | null,
  state: 'held' | 'confirmed' = 'held',
): Promise<void> {
  // One reading of the clock for the whole claim: a stay spanning several nights
  // must not judge its first night against a different instant from its last.
  const now = new Date();

  for (const { request, slotDate } of slotDatePairs(requests, slotDates)) {
    // 1. Materialise the mutex row race-safely. Two concurrent inserts cannot
    //    both win: `uniq_booking_slots_key_date` makes the loser a duplicate,
    //    which the no-op update absorbs.
    await tx
      .insert(schema.bookingSlots)
      .values({ slotKey: request.slotKey, slotDate })
      .onDuplicateKeyUpdate({ set: { slotKey: sql`slot_key` } });

    // 2. Lock it. Every competing transaction blocks here, and when it proceeds
    //    it reads the hold the winner just wrote.
    const [slot] = await tx
      .select()
      .from(schema.bookingSlots)
      .where(and(eq(schema.bookingSlots.slotKey, request.slotKey), eq(schema.bookingSlots.slotDate, slotDate)))
      .for('update')
      .limit(1);

    // 3. Count under the lock.
    const usage = await readUsage(tx, request.slotKey, slotDate, now);
    const { capacity, closed } = resolveCapacity(request.defaultCapacity, slot ?? null);

    // Naming the date matters once a booking spans several: "that date is
    // unavailable" leaves a guest with a week-long stay to find which one.
    if (closed) throw conflict(`${slotDate} is not available.`);
    if (remainingSeats({ capacity, ...usage }) < request.seats) {
      throw conflict(`${slotDate} is no longer available.`);
    }

    // 4. Write the hold.
    await tx.insert(schema.reservationHolds).values({
      reservationId,
      slotKey: request.slotKey,
      slotDate,
      seats: request.seats,
      state,
      expiresAt: state === 'held' ? holdExpiresAt : null,
    });

    // 5. Belt and braces on the mutex row. The lock is what actually serialises;
    //    bumping the version means a future code path that forgets `.for('update')`
    //    still cannot silently oversell.
    if (slot) {
      await tx
        .update(schema.bookingSlots)
        .set({ version: slot.version + 1 })
        .where(and(eq(schema.bookingSlots.id, slot.id), eq(schema.bookingSlots.version, slot.version)));
    }
  }
}

/** Promote a reservation's holds to confirmed — the date is now firmly taken. */
export async function confirmHolds(tx: Tx | Db, reservationId: number): Promise<void> {
  await tx
    .update(schema.reservationHolds)
    .set({ state: 'confirmed', expiresAt: null })
    .where(eq(schema.reservationHolds.reservationId, reservationId));
}

export type HoldConfirmation = { ok: true } | { ok: false; reason: 'hold_lapsed' | 'no_capacity' };

/**
 * Promote a reservation's holds to confirmed — but only if the date is still
 * its to take. For a payment that has just cleared.
 *
 * `confirmHolds` promotes unconditionally, which is right for an operator who
 * has decided, and wrong for a capture: the money can land after the hold
 * expired (a slow 3-D Secure, a gateway retry) and before the sweep ran, by
 * which point the seats had stopped counting and may have been sold to someone
 * else. Promoting then overbooked the date. After the sweep the holds are
 * released and the payment was recorded but credited to nothing, silently.
 *
 * So: a lapsed or released hold is refused outright (`hold_lapsed`). A live
 * hold is re-checked under the same `booking_slots` lock `allocateSlots` takes,
 * in the same order, and refused if the date is now over capacity
 * (`no_capacity` — an operator lowered it after the hold was taken). Only then
 * are the holds promoted, inside the caller's transaction. A refusal changes
 * nothing; the caller records the money and flags the booking for a human.
 *
 * A reservation with no holds (an enquiry) or only confirmed ones (a balance
 * payment) has nothing to check and passes.
 */
export async function confirmHoldsChecked(
  tx: Tx,
  reservation: Pick<
    Reservation,
    | 'id'
    | 'allocationMode'
    | 'bookingId'
    | 'bookingGroupId'
    | 'resourceGroupId'
    | 'persons'
    | 'slotDate'
    | 'endDate'
    | 'nights'
  >,
  defaultCapacity: number,
  now = new Date(),
): Promise<HoldConfirmation> {
  const holds = await tx
    .select()
    .from(schema.reservationHolds)
    .where(eq(schema.reservationHolds.reservationId, reservation.id))
    .for('update');

  const verdict = holdConfirmationVerdict(holds, now);
  if (verdict === 'lapsed') return { ok: false, reason: 'hold_lapsed' };
  if (verdict !== 'live') return { ok: true };

  // The per-slot defaults, derived exactly as the claim that took these holds.
  const capacities = await readStoredCapacities(
    tx,
    reservation.bookingId,
    reservation.resourceGroupId || null,
    defaultCapacity,
  );
  const { requests } = slotClaimFor({
    allocationMode: reservation.allocationMode,
    bookingGroupId: reservation.bookingGroupId,
    resourceGroupId: reservation.resourceGroupId,
    persons: reservation.persons,
    capacityPerDay: capacities.item,
    resourceCapacityPerDay: capacities.option,
    slotDate: reservation.slotDate,
    endDate: reservation.endDate,
    nights: reservation.nights,
  });
  const defaults = new Map(requests.map((r) => [r.slotKey, r.defaultCapacity]));

  // The global lock order — see `slotDatePairs`.
  const held = holds
    .filter((h) => h.state === 'held')
    .sort((a, b) => (a.slotKey === b.slotKey ? a.slotDate.localeCompare(b.slotDate) : a.slotKey.localeCompare(b.slotKey)));

  for (const hold of held) {
    await tx
      .insert(schema.bookingSlots)
      .values({ slotKey: hold.slotKey, slotDate: hold.slotDate })
      .onDuplicateKeyUpdate({ set: { slotKey: sql`slot_key` } });
    const [slot] = await tx
      .select()
      .from(schema.bookingSlots)
      .where(and(eq(schema.bookingSlots.slotKey, hold.slotKey), eq(schema.bookingSlots.slotDate, hold.slotDate)))
      .for('update')
      .limit(1);

    const fallback = defaults.get(hold.slotKey);
    // A slot the claim no longer names (the experience was edited) can only be
    // judged by an explicit override.
    if (fallback == null && slot?.capacity == null) continue;
    const { capacity } = resolveCapacity(fallback ?? 1, slot ?? null);
    // This hold is live, so `readUsage` already counts it.
    const usage = await readUsage(tx, hold.slotKey, hold.slotDate, now);
    if (isOverCapacity({ capacity, ...usage })) return { ok: false, reason: 'no_capacity' };
  }

  await tx
    .update(schema.reservationHolds)
    .set({ state: 'confirmed', expiresAt: null })
    .where(and(eq(schema.reservationHolds.reservationId, reservation.id), eq(schema.reservationHolds.state, 'held')));
  return { ok: true };
}

/** Release a reservation's holds — cancelled, expired or declined. */
export async function releaseHolds(tx: Tx | Db, reservationId: number): Promise<void> {
  await tx
    .update(schema.reservationHolds)
    .set({ state: 'released', expiresAt: null })
    .where(eq(schema.reservationHolds.reservationId, reservationId));
}

export interface DayStateRow extends DayState {
  slotKey: string;
  priceOverride: number | null;
  note: string | null;
}

/**
 * Day states for a calendar range, in one pass: the per-date overrides joined
 * with the seats already claimed.
 *
 * Read-only and outside any lock — this feeds the public calendar, where a
 * momentarily stale count is fine because `allocateSlots` re-checks under the
 * lock before anything is taken.
 */
export async function getDayStates(
  slotKey: string,
  dates: string[],
  defaultCapacity: number,
): Promise<Map<string, DayStateRow>> {
  const out = new Map<string, DayStateRow>();
  if (dates.length === 0) return out;

  const db = getDb();
  const [slots, holds] = await Promise.all([
    db
      .select()
      .from(schema.bookingSlots)
      .where(and(eq(schema.bookingSlots.slotKey, slotKey), inArray(schema.bookingSlots.slotDate, dates))),
    db
      .select({
        slotDate: schema.reservationHolds.slotDate,
        state: schema.reservationHolds.state,
        seats: schema.reservationHolds.seats,
        expiresAt: schema.reservationHolds.expiresAt,
      })
      .from(schema.reservationHolds)
      .where(
        and(
          eq(schema.reservationHolds.slotKey, slotKey),
          inArray(schema.reservationHolds.slotDate, dates),
          or(
            eq(schema.reservationHolds.state, 'confirmed'),
            and(
              eq(schema.reservationHolds.state, 'held'),
              or(isNull(schema.reservationHolds.expiresAt), gt(schema.reservationHolds.expiresAt, new Date())),
            ),
          ),
        ),
      ),
  ]);

  const slotByDate = new Map(slots.map((s) => [s.slotDate, s]));
  const now = new Date();

  for (const date of dates) {
    const override = slotByDate.get(date);
    const { capacity, closed } = resolveCapacity(defaultCapacity, override ?? null);
    out.set(date, {
      slotKey,
      date,
      capacity,
      closed,
      held: 0,
      confirmed: 0,
      priceOverride: override?.priceOverride ?? null,
      note: override?.note ?? null,
    });
  }

  for (const hold of holds) {
    const row = out.get(hold.slotDate);
    if (!row) continue;
    if (hold.state === 'confirmed') row.confirmed += hold.seats;
    else if (!isHoldExpired(hold.expiresAt, now)) row.held += hold.seats;
  }

  return out;
}

/**
 * Lapse everything whose time is up: pending enquiries that were never answered,
 * and instant-checkout holds whose payment was abandoned.
 *
 * Only the second releases anything — a pending enquiry never held a date, which
 * is the whole point of request mode.
 */
export async function expireStaleReservations(now = new Date()): Promise<{ expired: number }> {
  const db = getDb();

  const stale = await db
    .select({ id: schema.reservations.id, status: schema.reservations.status })
    .from(schema.reservations)
    .where(
      and(
        inArray(schema.reservations.status, ['pending', 'awaiting_payment']),
        lte(schema.reservations.expiresAt, now),
      ),
    );

  if (stale.length === 0) return { expired: 0 };

  let expired = 0;
  for (const row of stale) {
    const moved = await db.transaction(async (tx) => {
      const result = await tx
        .update(schema.reservations)
        .set({ status: 'expired', expiresAt: null })
        .where(and(eq(schema.reservations.id, row.id), eq(schema.reservations.status, row.status)));
      // Someone moved it between the read and this write — paid it, accepted
      // it, cancelled it. Its holds and history are theirs now, not ours.
      if (adapter.affectedRows(result) === 0) return false;
      await releaseHolds(tx, row.id);
      await tx.insert(schema.reservationEvents).values({
        reservationId: row.id,
        kind: 'status.expired',
        fromStatus: row.status,
        toStatus: 'expired',
      });
      return true;
    });
    if (!moved) continue;
    expired += 1;
    // After the commit, and recorded on the booking's history either way
    // (`email.expired`, sent or failed). The lifecycle has always promised this
    // email — "silence after someone asked for a date is worse than one more
    // email" — but the automatic sweep never sent it.
    try {
      await sendStatusEmail(row.id, row.status, 'expired');
    } catch (err) {
      // A delivery failure is recorded by the send itself; this catches the
      // rest (a failed read while composing) so one booking cannot stop the
      // sweep from expiring the others.
      console.error('[booking/allocation] expiry email failed', { reservationId: row.id, err });
    }
  }

  return { expired };
}

export interface OverbookedSlot {
  slotKey: string;
  slotDate: string;
  capacity: number;
  taken: number;
}

/**
 * Slots whose ledger exceeds their capacity.
 *
 * Should always be empty. It exists because "should always be empty" is a claim
 * worth being able to check rather than assert — an admin health check, and the
 * reconciliation that would justify a cached counter if one is ever added.
 *
 * Judged against the EFFECTIVE capacity: the date's override when it has one,
 * otherwise `defaultCapacityFor(slotKey)`. It used to read the override column
 * alone and drop every row where it was NULL — i.e. nearly every date, since
 * most never get an override — so the check could not see the common case.
 * Held rows count only while unexpired, by the app clock (see `readUsage`): a
 * lapsed hold the sweep has not reached yet is not a seat anyone holds.
 */
export async function findOverbookedSlots(
  from: string,
  to: string,
  defaultCapacityFor: (slotKey: string) => number | null | undefined = () => null,
  now = new Date(),
): Promise<OverbookedSlot[]> {
  const db = getDb();
  const rows = await db
    .select({
      slotKey: schema.reservationHolds.slotKey,
      slotDate: schema.reservationHolds.slotDate,
      taken: sql<number>`COALESCE(SUM(CASE WHEN ${schema.reservationHolds.state} = 'confirmed'
        OR (${schema.reservationHolds.expiresAt} IS NULL OR ${schema.reservationHolds.expiresAt} > ${now})
        THEN ${schema.reservationHolds.seats} ELSE 0 END), 0)`,
      capacity: schema.bookingSlots.capacity,
    })
    .from(schema.reservationHolds)
    .leftJoin(
      schema.bookingSlots,
      and(
        eq(schema.bookingSlots.slotKey, schema.reservationHolds.slotKey),
        eq(schema.bookingSlots.slotDate, schema.reservationHolds.slotDate),
      ),
    )
    .where(
      and(
        inArray(schema.reservationHolds.state, ['held', 'confirmed']),
        sql`${schema.reservationHolds.slotDate} BETWEEN ${from} AND ${to}`,
      ),
    )
    .groupBy(schema.reservationHolds.slotKey, schema.reservationHolds.slotDate, schema.bookingSlots.capacity);

  return overbookedFrom(
    rows.map((r) => ({ ...r, taken: Number(r.taken), capacity: r.capacity == null ? null : Number(r.capacity) })),
    defaultCapacityFor,
  );
}
