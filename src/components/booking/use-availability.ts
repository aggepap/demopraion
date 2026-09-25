'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  availabilityParams,
  isoDay,
  monthEnd,
  monthStart,
  shiftMonth,
  type Availability,
  type AvailabilityDay,
} from './booking-form-types';

/**
 * The availability calendar behind the date fields.
 *
 * This endpoint existed with no consumer at all: the form shipped a bare native
 * date picker, so a customer could choose a date the server would only refuse
 * after they had filled in the whole form. It matters far more for a stay,
 * where a range can span a single blocked night in the middle and nothing on
 * screen would say which one.
 *
 * Re-fetched when the chosen option changes, because a stay is held against the
 * unit: the Sea View Suite's calendar is not the Garden Studio's.
 *
 * Fetched a month at a time and ACCUMULATED, rather than as one fixed window
 * from today. A calendar the visitor can page through will eventually show a
 * month nobody asked the server about, and an unfetched month must not read as
 * a closed one — see `reasonFor`. Each month is requested once; the visible
 * month and the one after it come together, so paging forward is usually
 * already answered and a stay's check-out can cross a month boundary without a
 * gap in what is known.
 */
export function useAvailability(
  slug: string,
  locale: string,
  resourceId: string,
  /** `YYYY-MM` on screen. Omitted means just this month, as before. */
  month?: string,
  enabled = true,
  /** Transport party size — fullness depends on it. Undefined for a stay. */
  persons?: number
): Availability | null {
  const [availability, setAvailability] = useState<Availability | null>(null);
  /** Which months have been requested, and for which calendar. Read and written
   *  only inside the effect — a ref touched during render is a stale-UI bug the
   *  React compiler refuses outright. */
  const cache = useRef<{ scope: string; months: Set<string> }>({ scope: '', months: new Set() });

  /** A different experience, language, option or party size is a different
   *  calendar: a day with three seats left is open to two people, not to six. */
  const scope = `${slug}|${locale}|${resourceId}|${persons ?? ''}`;
  const visible = month ?? isoDay(0).slice(0, 7);

  const merge = useCallback((days: AvailabilityDay[], rules: unknown, from: string, to: string) => {
    setAvailability((prev) => {
      const map = new Map(prev?.days);
      for (const day of days) map.set(day.date, day);
      return {
        days: map,
        rules: (rules ?? prev?.rules ?? null) as Availability['rules'],
        // The covered window only ever grows, and months arrive adjacent, so
        // the union stays contiguous — which is what `reasonFor` reads it as.
        from: prev && prev.from < from ? prev.from : from,
        to: prev && prev.to > to ? prev.to : to,
      };
    });
  }, []);

  useEffect(() => {
    if (!enabled) return;

    if (cache.current.scope !== scope) {
      // Drop the previous unit's dates rather than mixing two calendars in one
      // map: the Sea View Suite being free says nothing about the Garden Studio.
      cache.current = { scope, months: new Set() };
      setAvailability(null);
    }
    if (cache.current.months.has(visible)) return;
    cache.current.months.add(visible);
    cache.current.months.add(shiftMonth(visible, 1));

    const controller = new AbortController();
    // Never ask about days that have already gone: the endpoint would answer
    // `past` for every one of them, which the calendar disables anyway.
    const today = isoDay(0);
    const start = monthStart(visible);
    const from = start < today ? today : start;
    const to = monthEnd(shiftMonth(visible, 1));

    if (from > to) return () => controller.abort();

    const params = availabilityParams({ slug, locale, from, to, resourceId, persons });

    fetch(`/api/cms/booking/availability?${params.toString()}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        const days: AvailabilityDay[] = body?.data?.days ?? [];
        if (!days.length) return;
        merge(days, body?.data?.rules, from, to);
      })
      .catch(() => {
        // A calendar we could not load must not block booking. The server is
        // the authority and re-checks under the lock regardless; degrading to
        // the old "let them try" behaviour is strictly better than refusing
        // every date because one request failed. The month is left marked as
        // fetched: retrying on every render would hammer a server already in
        // trouble, and the visitor can still submit.
      });

    return () => controller.abort();
  }, [slug, locale, resourceId, persons, scope, visible, enabled, merge]);

  return availability;
}

/**
 * Why `date` cannot be booked, or null when it can.
 *
 * A date outside the window we asked about returns null — unknown is not
 * unavailable, and refusing what has not been checked would block bookings
 * further ahead than the calendar reaches.
 */
export function reasonFor(availability: Availability | null, date: string): string | null {
  if (!availability || !date) return null;
  if (date < availability.from || date > availability.to) return null;
  const day = availability.days.get(date);
  if (!day) return null;
  return day.bookable ? null : day.status;
}

/**
 * Has this date been checked at all?
 *
 * The calendar needs the three-way answer `reasonFor` deliberately flattens:
 * bookable, not bookable, and not yet asked. Painting an unfetched day as
 * available would be a promise nobody made.
 */
export function isKnown(availability: Availability | null, date: string): boolean {
  if (!availability || !date) return false;
  return date >= availability.from && date <= availability.to && availability.days.has(date);
}
