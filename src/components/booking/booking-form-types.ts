/**
 * Shared shapes for the booking form.
 *
 * One experience is sold two ways — a charter for a DAY, or a room for a RANGE
 * OF NIGHTS — and the two need different controls. The shell in
 * `BookingForm.tsx` owns the selection, the price and the submit; the two field
 * sets only render inputs over the same `Selection`.
 */

export interface BookingFormResource {
  id: string;
  title: string;
}

export interface BookingFormExtra {
  id: string;
  name: string;
  price: number;
}

export interface BookingFormChoice {
  id: string;
  title: string;
  options: string[];
}

/** Everything the customer has chosen. Posted verbatim to `/quote` and
 *  `/request`; the server re-prices it either way. */
export interface Selection {
  /** The booked day, or a stay's check-in. */
  date: string;
  /** Check-out. Stay only. */
  endDate: string;
  /** Transport party size. */
  persons: number;
  /** Stay occupancy. */
  adults: number;
  children: number;
  resourceId: string;
  extraIds: string[];
  answers: Record<string, string>;
}

export interface BookingFormLabels {
  title: string;
  date: string;
  datePlaceholder: string;
  persons: string;
  personsRange: string;
  resource: string;
  extras: string;
  extrasPerPerson: string;
  yourDetails: string;
  name: string;
  email: string;
  phone: string;
  notes: string;
  terms: string;
  submitRequest: string;
  submitInstant: string;
  submitting: string;
  noteRequest: string;
  noteInstant: string;
  breakdownTitle: string;
  total: string;
  pricePending: string;
  onRequest: string;
  successTitle: string;
  successBody: string;
  lookupLink: string;
  errorGeneric: string;
  /** Stay-only copy. */
  checkIn: string;
  checkOut: string;
  adults: string;
  children: string;
  childrenHint: string;
  nights: string;
  perNight: string;
  minNights: string;
  maxNights: string;
  occupancyRange: string;
  /** The chosen range, and getting out of it. */
  clearDates: string;
  pickCheckOut: string;
  /** Calendar chrome and legend. */
  calendarAvailable: string;
  calendarUnavailable: string;
  calendarSelected: string;
  calendarPrevMonth: string;
  calendarNextMonth: string;
  /** Keyed by `DayStatus` — why a date cannot be taken. */
  unavailable: Record<string, string>;
}

/** What `GET /api/cms/booking/availability` reports for one date. */
export interface AvailabilityDay {
  date: string;
  status: string;
  bookable: boolean;
  remaining: number;
}

export interface AvailabilityRules {
  minNights: number | null;
  maxNights: number | null;
  checkInDays: number[] | null;
  checkOutDays: number[] | null;
  baseOccupancy: number | null;
  maxOccupancy: number | null;
  childrenEnabled: boolean;
  childMaxAge: number | null;
  leadTimeHours: number;
}

export interface Availability {
  days: Map<string, AvailabilityDay>;
  rules: AvailabilityRules | null;
  /** The window the server was asked about. Dates outside it are unknown, not
   *  unavailable — the form must not refuse what it has not checked. */
  from: string;
  to: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` for a date offset from today, in the browser's own timezone.
 *  Good enough for input bounds; the server re-checks in the site timezone. */
export function isoDay(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * DAY_MS);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/*
 * Month arithmetic for the calendar, on `YYYY-MM` keys.
 *
 * UTC throughout, and string-keyed rather than `Date`-keyed: these values are
 * compared against the `YYYY-MM-DD` the availability endpoint speaks, and a
 * local-time month boundary in a UTC+n browser would put the first of the month
 * in the previous one.
 */

/** `YYYY-MM` shifted by whole months. */
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** First day of a `YYYY-MM`, as `YYYY-MM-DD`. */
export function monthStart(month: string): string {
  return `${month}-01`;
}

/** Last day of a `YYYY-MM`, as `YYYY-MM-DD`. Day 0 of the next month is it. */
export function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** The `YYYY-MM` a `YYYY-MM-DD` falls in. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/**
 * A date as a reader would say it: `12 Αυγ`, `12 Aug`.
 *
 * The year is added only when it is not the current one. A stay booked for next
 * month does not need telling which year it is, and a booking eleven months out
 * very much does — printing it always makes the common case noisier to read for
 * the sake of the rare one.
 *
 * `now` is injectable so this is testable without freezing the clock.
 */
export function formatDay(iso: string, locale: string, now = new Date()): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'el', {
    day: 'numeric',
    month: 'short',
    ...(y === now.getFullYear() ? {} : { year: 'numeric' }),
    // Local parts in, local parts out — the same reason `BookingCalendar`
    // builds its dates locally. A UTC formatter would name the previous day for
    // anyone west of Greenwich.
  }).format(new Date(y, m - 1, d));
}

/** Every night a stay occupies: check-in through the night BEFORE check-out.
 *  Mirrors `stayNights` on the server — the check-out day is a departure. */
export function nightsBetween(checkIn: string, checkOut: string): string[] {
  if (!checkIn || !checkOut) return [];
  const start = Date.parse(`${checkIn}T00:00:00Z`);
  const end = Date.parse(`${checkOut}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const out: string[] = [];
  for (let t = start; t < end && out.length < 366; t += DAY_MS) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/**
 * The query string for `GET /api/cms/booking/availability`.
 *
 * `persons` goes whenever there is one: fullness is judged against the party
 * size, and without it the server assumed a party of one — so a day with two
 * seats left read as open to a party of six, who then filled in the whole form
 * to be refused. A stay sends none (a unit is one booking whatever the party).
 */
export function availabilityParams(input: {
  slug: string;
  locale: string;
  from: string;
  to: string;
  resourceId: string;
  persons?: number;
}): URLSearchParams {
  const params = new URLSearchParams({ slug: input.slug, locale: input.locale, from: input.from, to: input.to });
  if (input.resourceId) params.set('resourceId', input.resourceId);
  if (input.persons != null && Number.isFinite(input.persons) && input.persons > 0) {
    params.set('persons', String(Math.floor(input.persons)));
  }
  return params;
}
