/**
 * Availability rules — pure, dependency-free, and the authority on whether a
 * date can be booked at all.
 *
 * No DB import and no `server-only`, so the calendar endpoint, the allocation
 * transaction and the unit tests all answer with the same function. The
 * DB-touching half lives in `allocation.ts`.
 *
 * The legacy system had none of this: no capacity, no lead time, and nothing
 * stopping two customers booking the same yacht on the same day. All of it is
 * new, so it is specified here rather than ported.
 */
import { inSeason, type SeasonRange } from './pricing';

export const ALLOCATION_MODES = ['shared', 'exclusive', 'resource'] as const;
export type AllocationMode = (typeof ALLOCATION_MODES)[number];

export interface DayRules {
  /** Recurring yearly window; null = open all year. */
  window: SeasonRange | null;
  /** Hours before the date after which it can no longer be booked. */
  leadTimeHours: number;
  /** 0 = no limit on how far ahead. */
  maxAdvanceDays: number;
  /** 0=Sunday … 6=Saturday; null or empty = every day. */
  weekdays: number[] | null;
}

export interface DayState {
  /** `YYYY-MM-DD`. */
  date: string;
  capacity: number;
  held: number;
  confirmed: number;
  closed: boolean;
}

export type DayStatus =
  | 'open'
  | 'closed'
  | 'full'
  | 'out_of_season'
  | 'wrong_weekday'
  | 'too_soon'
  | 'too_far'
  | 'past'
  /* Stay-only. A range can fail for reasons no single day can. */
  | 'invalid_range'
  | 'min_nights'
  | 'max_nights'
  | 'bad_checkin_day'
  | 'bad_checkout_day';

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Seats still available, floored at zero — an over-allocated slot is 0, never negative. */
export function remainingSeats(day: Pick<DayState, 'capacity' | 'held' | 'confirmed'>): number {
  return Math.max(0, day.capacity - day.held - day.confirmed);
}

export function canFit(day: Pick<DayState, 'capacity' | 'held' | 'confirmed'>, seats: number): boolean {
  return remainingSeats(day) >= Math.max(1, seats);
}

/**
 * Today's calendar date in a timezone, as `YYYY-MM-DD`.
 *
 * `en-CA` formats exactly that way, which avoids both a date library and the
 * usual hand-rolled UTC arithmetic. Bookings are calendar days in the operator's
 * timezone: a server running in UTC must not file a 23:00 Athens booking under
 * the next day.
 */
export function todayInTimeZone(now: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  }
}

/** Whole days from `from` to `to`, both `YYYY-MM-DD`. Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** 0=Sunday … 6=Saturday for a `YYYY-MM-DD`, read in UTC so it cannot drift. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/**
 * How far `timeZone` is ahead of UTC at `instant`, in milliseconds.
 *
 * Read back from `Intl` rather than from a table, so daylight saving is whatever
 * the runtime's zone data says it is. An unknown zone answers 0 (UTC) — the same
 * fallback `todayInTimeZone` takes — rather than throwing mid-booking.
 */
function zoneOffsetMs(instant: number, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(instant));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    return asUtc - Math.floor(instant / 1000) * 1000;
  } catch {
    return 0;
  }
}

/**
 * The instant midnight begins on `date` in `timeZone`.
 *
 * Two passes: the offset at UTC midnight is a guess, and the offset at the
 * guessed instant corrects it on the one night a year the clocks change between
 * the two.
 */
export function zonedMidnight(date: string, timeZone: string): Date {
  const utcMidnight = Date.parse(`${date}T00:00:00Z`);
  const guess = utcMidnight - zoneOffsetMs(utcMidnight, timeZone);
  return new Date(utcMidnight - zoneOffsetMs(guess, timeZone));
}

/**
 * The instant after which `date` can no longer be booked.
 *
 * Anchored to the START of the booked day — midnight in the operator's timezone,
 * the same zone `todayInTimeZone` files the date in: a cut-off is "how long
 * before it happens", and without an anchor a 24-hour lead time would mean
 * something different depending on when the query ran. It was UTC midnight,
 * which in Athens is 02:00 or 03:00 local, so every cut-off closed that much
 * later than the operator set it.
 */
export function cutoffFor(date: string, leadTimeHours: number, timeZone = 'UTC'): Date {
  return new Date(zonedMidnight(date, timeZone).getTime() - Math.max(0, leadTimeHours) * 60 * 60 * 1000);
}

/**
 * Why a date can or cannot be booked. One function, so the public calendar, the
 * booking form's disabled-day reason and the server's refusal cannot disagree.
 *
 * Order matters: the checks run cheapest and most fundamental first, and the
 * FIRST failing one is what the customer is told. "Sold out" on a date that is
 * also out of season would be actively misleading.
 */
export function dayStatus(
  day: DayState,
  rules: DayRules,
  seats: number,
  now: Date,
  timeZone: string,
): DayStatus {
  const today = todayInTimeZone(now, timeZone);
  if (day.date < today) return 'past';

  if (rules.window && !inSeason(monthDayInt(day.date), rules.window)) return 'out_of_season';

  if (rules.weekdays && rules.weekdays.length > 0 && !rules.weekdays.includes(weekdayOf(day.date))) {
    return 'wrong_weekday';
  }

  if (rules.maxAdvanceDays > 0 && daysBetween(today, day.date) > rules.maxAdvanceDays) return 'too_far';

  // Checked after the calendar rules but before capacity: a date you cannot
  // reach in time is not "sold out".
  if (rules.leadTimeHours > 0 && now.getTime() > cutoffFor(day.date, rules.leadTimeHours, timeZone).getTime()) {
    return 'too_soon';
  }

  if (day.closed) return 'closed';
  if (!canFit(day, seats)) return 'full';
  return 'open';
}

/**
 * `dayStatus` over every slot one booking would hold — the first refusal wins.
 *
 * A booking in `resource` mode needs room on the experience AND on the option,
 * so a day is only open when every slot it would claim is. Fed by
 * `slotRequestsForKind`, the same answer `allocateSlots` will act on.
 */
export function combinedDayStatus(
  parts: Array<{ state: DayState; seats: number }>,
  rules: DayRules,
  now: Date,
  timeZone: string,
): DayStatus {
  for (const { state, seats } of parts) {
    const status = dayStatus(state, rules, seats, now, timeZone);
    if (status !== 'open') return status;
  }
  return 'open';
}

function monthDayInt(date: string): number {
  return Number(date.slice(5, 7)) * 100 + Number(date.slice(8, 10));
}

/**
 * Every date from `from` to `to` inclusive, capped so a crafted query cannot ask
 * for ten thousand days.
 */
export function eachDate(from: string, to: string, cap = 366): string[] {
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) return [];
  const out: string[] = [];
  let cursor = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  while (cursor <= end && out.length < cap) {
    out.push(new Date(cursor).toISOString().slice(0, 10));
    cursor += DAY_MS;
  }
  return out;
}

/**
 * The nights a stay occupies: check-in through the night BEFORE check-out.
 *
 * A 14 → 17 August booking occupies the 14th, 15th and 16th. The 17th is a
 * departure, not an occupancy, and holding it would block the next guest from
 * arriving on the day the room is actually free — the single most common way to
 * get a hotel calendar wrong.
 *
 * Empty when the range is not two real dates in order, so callers can treat
 * "no nights" as "not a bookable range".
 */
export function stayNights(checkIn: string, checkOut: string, cap = 366): string[] {
  if (!ISO_DATE.test(checkIn) || !ISO_DATE.test(checkOut)) return [];
  if (daysBetween(checkIn, checkOut) < 1) return [];
  return eachDate(checkIn, checkOut, cap + 1).slice(0, -1);
}

export function bookingSlotKey(groupId: string): string {
  return `exp:${groupId}`;
}

export function resourceSlotKey(groupId: string): string {
  return `res:${groupId}`;
}

export interface SlotRequest {
  slotKey: string;
  seats: number;
  defaultCapacity: number;
}

export interface SlotRequestInput {
  allocationMode: AllocationMode;
  bookingGroupId: string;
  /** `''` or absent when no resource was chosen. */
  resourceGroupId?: string | null;
  persons: number;
  /** Places per day for the item itself. */
  capacityPerDay: number;
  /** Separate bookings the chosen resource can take per day (usually 1). */
  resourceCapacityPerDay?: number;
}

/**
 * Which slots a reservation consumes, and how much of each.
 *
 * This one function is where the three allocation modes differ; everything
 * downstream is mode-agnostic. Get it right and every mode is right.
 *
 * The result is sorted by `slotKey`, and that is not cosmetic: two concurrent
 * reservations touching the same item and the same resource would deadlock if
 * one locked item→resource and the other resource→item. A fixed global lock
 * order makes that impossible.
 */
export function slotRequestsFor(input: SlotRequestInput): SlotRequest[] {
  const persons = Math.max(1, Math.floor(input.persons));
  const itemCapacity = Math.max(1, Math.floor(input.capacityPerDay));
  const resourceGroupId = input.resourceGroupId || '';
  const requests: SlotRequest[] = [];

  switch (input.allocationMode) {
    case 'exclusive':
      // One reservation takes the whole day, whatever the party size.
      requests.push({ slotKey: bookingSlotKey(input.bookingGroupId), seats: 1, defaultCapacity: 1 });
      break;

    case 'resource':
      // The item may still have a daily ceiling, but the thing that actually
      // runs out is the resource — and it runs out across every item offering
      // it, which is why it gets its own slot rather than a per-item counter.
      requests.push({
        slotKey: bookingSlotKey(input.bookingGroupId),
        seats: persons,
        defaultCapacity: itemCapacity,
      });
      if (resourceGroupId) {
        requests.push({
          slotKey: resourceSlotKey(resourceGroupId),
          seats: 1,
          defaultCapacity: Math.max(1, Math.floor(input.resourceCapacityPerDay ?? 1)),
        });
      }
      break;

    case 'shared':
    default:
      requests.push({
        slotKey: bookingSlotKey(input.bookingGroupId),
        seats: persons,
        defaultCapacity: itemCapacity,
      });
      break;
  }

  return requests.sort((a, b) => (a.slotKey < b.slotKey ? -1 : a.slotKey > b.slotKey ? 1 : 0));
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Stays — a range of nights rather than one day                               */
/* ────────────────────────────────────────────────────────────────────────── */

export interface StayRules extends DayRules {
  /** At least this many nights. Always ≥ 1. */
  minNights: number;
  /** 0 = no limit. */
  maxNights: number;
  /** 0=Sunday … 6=Saturday; null or empty = arrive any day. */
  checkInDays: number[] | null;
  checkOutDays: number[] | null;
}

export type StayCheck =
  | { ok: true; nights: string[] }
  | { ok: false; status: DayStatus; date?: string };

/**
 * Whether a whole range can be booked, and if not, why and on which night.
 *
 * The order is deliberate and matches `dayStatus`: the checks that describe the
 * REQUEST (is it a range at all, is it long enough, may you arrive that day)
 * run before the checks that describe the CALENDAR (is that night in season,
 * is it sold out). Telling someone a night is sold out when their real problem
 * is a three-night minimum sends them looking for other dates that will fail
 * exactly the same way.
 *
 * `seasonalMinNights` is resolved by the caller from the ARRIVAL date's season:
 * a stay that begins in the low season keeps the low season's minimum even if
 * it runs on into August. That is what guests are quoted, and second-guessing
 * it per night would make the rule unexplainable.
 */
export function stayStatus(
  checkIn: string,
  checkOut: string,
  rules: StayRules,
  dayStateFor: (date: string) => DayState,
  seats: number,
  now: Date,
  timeZone: string,
): StayCheck {
  const nights = stayNights(checkIn, checkOut);
  if (nights.length === 0) return { ok: false, status: 'invalid_range' };

  const minNights = Math.max(1, Math.floor(rules.minNights || 1));
  if (nights.length < minNights) return { ok: false, status: 'min_nights' };
  if (rules.maxNights > 0 && nights.length > rules.maxNights) return { ok: false, status: 'max_nights' };

  if (rules.checkInDays?.length && !rules.checkInDays.includes(weekdayOf(checkIn))) {
    return { ok: false, status: 'bad_checkin_day', date: checkIn };
  }
  if (rules.checkOutDays?.length && !rules.checkOutDays.includes(weekdayOf(checkOut))) {
    return { ok: false, status: 'bad_checkout_day', date: checkOut };
  }

  // A stay's arrival rules replace the per-day weekday rule, so it is cleared
  // here rather than applied to every night — a Sat-to-Sat villa is not "only
  // available on Saturdays".
  const perNight: DayRules = { ...rules, weekdays: null };
  for (const date of nights) {
    const status = dayStatus(dayStateFor(date), perNight, seats, now, timeZone);
    if (status !== 'open') return { ok: false, status, date };
  }

  return { ok: true, nights };
}

export interface StaySlotRequestInput {
  bookingGroupId: string;
  /** The chosen option's row id, or `''`/absent when the experience itself is
   *  the unit being booked. */
  resourceGroupId?: string | null;
  /** Bookings the chosen option takes per night. Usually 1. */
  resourceCapacityPerDay?: number;
  /** Bookings the property itself takes per night when it has no options. */
  capacityPerDay: number;
}

/**
 * Which slot a stay consumes per night.
 *
 * Exactly one, either way — which is the whole difference from transport. A
 * stay is not "seats out of a day's capacity"; it is one unit, occupied. When
 * the experience lists options the unit is the chosen option; when it lists
 * none, the experience IS the unit (a single villa needs no picker), and its
 * `capacityPerDay` says how many bookings the property takes a night.
 *
 * Note it does NOT also hold the experience slot when an option is chosen: two
 * different rooms of the same hotel must both be bookable on one night, and a
 * shared experience-level counter would stop the second at whatever the
 * property's own capacity happened to be.
 */
export function staySlotRequestsFor(input: StaySlotRequestInput): SlotRequest[] {
  const resourceGroupId = input.resourceGroupId || '';
  if (resourceGroupId) {
    return [
      {
        slotKey: resourceSlotKey(resourceGroupId),
        seats: 1,
        defaultCapacity: Math.max(1, Math.floor(input.resourceCapacityPerDay ?? 1)),
      },
    ];
  }
  return [
    {
      slotKey: bookingSlotKey(input.bookingGroupId),
      seats: 1,
      defaultCapacity: Math.max(1, Math.floor(input.capacityPerDay || 1)),
    },
  ];
}

/** What one stored reservation must claim: which slots, on which dates. */
export interface SlotClaim {
  requests: SlotRequest[];
  slotDates: string[];
}

export interface StoredClaimInput extends SlotRequestInput {
  /** Check-in for a stay; the one date for transport. */
  slotDate: string;
  /** Check-out for a stay; null for transport. */
  endDate?: string | null;
  /** Nights occupied. 0 for transport — how a stored row says which kind it is. */
  nights: number;
}

/**
 * The claim a STORED reservation makes on the ledger.
 *
 * `createReservation` computes this from the resolved document, where the kind,
 * the nights and the capacity are all to hand. The operator-accept path has none
 * of that — a `pending` enquiry holds nothing, so accepting it is where the date
 * is first claimed, working from the row alone. Both must arrive at the same
 * answer, and the only way to guarantee that is for both to ask one function.
 *
 * A stay claims one seat of its unit on EVERY night, not the party size on the
 * check-in date: getting that wrong leaves the rest of the stay bookable by
 * somebody else.
 */
export function slotClaimFor(row: StoredClaimInput): SlotClaim {
  if (row.nights > 0) {
    const nights = stayNights(row.slotDate, row.endDate ?? '');
    // A range that will not parse still claims its check-in night. Claiming
    // nothing at all would report an accept that took no date whatsoever.
    return { requests: staySlotRequestsFor(row), slotDates: nights.length ? nights : [row.slotDate] };
  }
  return { requests: slotRequestsFor(row), slotDates: [row.slotDate] };
}

/** Read a stay's calendar rules out of its `data`. */
export function readStayRules(
  data: Record<string, unknown>,
  defaults: { leadTimeHours: number },
): StayRules {
  const weekdayList = (value: unknown): number[] | null => {
    const out = Array.isArray(value)
      ? value.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      : [];
    return out.length ? out : null;
  };

  const min = Number(data.minNights);
  const max = Number(data.maxNights);

  return {
    // The per-day weekday rule does not apply to a stay; arrival and departure
    // days do, and they are their own fields.
    ...readDayRules(data, defaults),
    weekdays: null,
    minNights: Number.isFinite(min) && min > 0 ? Math.floor(min) : 1,
    maxNights: Number.isFinite(max) && max > 0 ? Math.floor(max) : 0,
    checkInDays: weekdayList(data.checkInDays),
    checkOutDays: weekdayList(data.checkOutDays),
  };
}

/**
 * Every (slot, date) pair a reservation must lock, in the ONE global order that
 * makes concurrent bookings deadlock-free.
 *
 * Sorted by slot key, then by date. Two overlapping stays that locked the 14th
 * before the 15th and the 15th before the 14th respectively would wait on each
 * other for ever; a total order over the pairs makes that impossible no matter
 * which nights they share.
 *
 * Pure and exported so the ordering can be asserted without a database — the
 * property it guarantees is invisible in normal operation and only shows up
 * under concurrency, which is exactly the kind of thing a test has to pin down.
 */
export function slotDatePairs(
  requests: SlotRequest[],
  slotDates: string | string[],
): Array<{ request: SlotRequest; slotDate: string }> {
  const dates = [...new Set(Array.isArray(slotDates) ? slotDates : [slotDates])];
  return requests
    .flatMap((request) => dates.map((slotDate) => ({ request, slotDate })))
    .sort((a, b) =>
      a.request.slotKey === b.request.slotKey
        ? a.slotDate.localeCompare(b.slotDate)
        : a.request.slotKey.localeCompare(b.request.slotKey),
    );
}

/** A per-date override merged over the document's default. */
export function resolveCapacity(
  defaultCapacity: number,
  override?: { capacity: number | null; closed: boolean } | null,
): { capacity: number; closed: boolean } {
  const fallback = Math.max(1, Math.floor(defaultCapacity));
  if (!override) return { capacity: fallback, closed: false };
  const overridden = override.capacity;
  return {
    capacity: overridden == null ? fallback : Math.max(0, Math.floor(overridden)),
    closed: override.closed === true,
  };
}

export function isHoldExpired(expiresAt: Date | null | undefined, now: Date): boolean {
  return expiresAt != null && expiresAt.getTime() <= now.getTime();
}

/** Read a booking document's `data` into the calendar rules. */
export function readDayRules(
  data: Record<string, unknown>,
  defaults: { leadTimeHours: number },
): DayRules {
  const from = typeof data.availableFrom === 'string' ? data.availableFrom : '';
  const to = typeof data.availableTo === 'string' ? data.availableTo : '';
  const lead = Number(data.leadTimeHours);
  const advance = Number(data.maxAdvanceDays);
  const weekdays = Array.isArray(data.weekdays)
    ? data.weekdays.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    : null;

  return {
    window: from && to ? { from, to } : null,
    leadTimeHours: Number.isFinite(lead) && lead >= 0 ? lead : defaults.leadTimeHours,
    maxAdvanceDays: Number.isFinite(advance) && advance > 0 ? Math.floor(advance) : 0,
    weekdays: weekdays && weekdays.length > 0 ? weekdays : null,
  };
}

/**
 * Which allocation mode an experience's `data` asks for.
 *
 * A stay always allocates per unit, whatever `allocationMode` says — the field
 * is hidden for a stay, so any value it holds is leftover transport config and
 * must not be read. One reader, so the booking path and the public calendar
 * cannot disagree about which slots a date consumes.
 */
export function readAllocationMode(data: Record<string, unknown>, kind: 'transport' | 'stay'): AllocationMode {
  if (kind === 'stay') return 'resource';
  const raw = data.allocationMode;
  return typeof raw === 'string' && (ALLOCATION_MODES as readonly string[]).includes(raw)
    ? (raw as AllocationMode)
    : 'shared';
}

/**
 * The slots a booking of either kind would claim — `staySlotRequestsFor` for a
 * stay, `slotRequestsFor` for transport.
 *
 * The public calendar reads exactly these. It used to read the chosen option's
 * `res:` slot whenever one was picked, but in `shared` and `exclusive` mode only
 * the experience's `exp:` slot is ever held, so a sold-out day read as open.
 */
export function slotRequestsForKind(input: SlotRequestInput & { kind: 'transport' | 'stay' }): SlotRequest[] {
  return input.kind === 'stay' ? staySlotRequestsFor(input) : slotRequestsFor(input);
}

/**
 * Whether a reservation's holds may be promoted to confirmed right now.
 *
 * - `live`: every hold is held and unexpired — its seats are still counted, so
 *   the date is still this reservation's to confirm.
 * - `lapsed`: a hold has expired (the sweep has not run yet) or been released
 *   (it has). Other bookings may already have the seats; confirming now could
 *   overbook, so a payment landing here is recorded and flagged, not credited.
 * - `confirmed`: nothing left to do — a balance payment on a confirmed booking.
 * - `none`: the reservation holds nothing (an enquiry). Left to the caller.
 */
export function holdConfirmationVerdict(
  holds: ReadonlyArray<{ state: string; expiresAt: Date | null }>,
  now: Date,
): 'none' | 'confirmed' | 'lapsed' | 'live' {
  if (holds.length === 0) return 'none';
  if (holds.some((h) => h.state === 'released')) return 'lapsed';
  if (holds.some((h) => h.state === 'held' && isHoldExpired(h.expiresAt, now))) return 'lapsed';
  if (holds.every((h) => h.state === 'confirmed')) return 'confirmed';
  return 'live';
}

/** More claimed on a slot than it allows — the thing that must never be confirmed into. */
export function isOverCapacity(day: Pick<DayState, 'capacity' | 'held' | 'confirmed'>): boolean {
  return day.held + day.confirmed > day.capacity;
}

/**
 * The overbooked (slot, date) pairs among aggregated ledger rows.
 *
 * A row with no capacity override is judged against the slot's DEFAULT — the
 * case that matters most, since most dates never get an override. Where that
 * default is unknown (the experience is unpublished or gone) the row can only
 * be judged by an override, and is skipped without one.
 */
export function overbookedFrom(
  rows: ReadonlyArray<{ slotKey: string; slotDate: string; taken: number; capacity: number | null }>,
  defaultCapacityFor: (slotKey: string) => number | null | undefined,
): Array<{ slotKey: string; slotDate: string; capacity: number; taken: number }> {
  const out: Array<{ slotKey: string; slotDate: string; capacity: number; taken: number }> = [];
  for (const row of rows) {
    const fallback = defaultCapacityFor(row.slotKey);
    const capacity = row.capacity != null ? Number(row.capacity) : fallback != null ? Number(fallback) : null;
    if (capacity == null) continue;
    const taken = Number(row.taken);
    if (taken > capacity) out.push({ slotKey: row.slotKey, slotDate: row.slotDate, capacity, taken });
  }
  return out;
}
