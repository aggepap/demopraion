'use client';

import { useMemo } from 'react';
import { DayPicker, type DateRange, type Matcher } from 'react-day-picker';
import { el, enGB } from 'react-day-picker/locale';

import { isoDay, monthOf, type Availability, type BookingFormLabels } from './booking-form-types';
import { isKnown, reasonFor } from './use-availability';

/**
 * The date field, as a calendar.
 *
 * WAS: `<input type="date">`. It renders whatever calendar the browser feels
 * like, cannot be styled at all, and — the part that mattered — can say nothing
 * about which dates are actually for sale. A visitor picked a date that looked
 * fine, filled in the whole form, and was refused on submit. Everything needed
 * to answer that up front was already being fetched: `useAvailability` knows,
 * per day, whether it is bookable and why not.
 *
 * Three states, deliberately distinct:
 *
 *   available   — checked, and free. Circled, so it reads as an invitation.
 *   unavailable — checked, and not free (past, out of season, closed, full).
 *                 Greyed and unclickable.
 *   unchecked   — beyond the months fetched so far. Left plain and selectable:
 *                 the server is the authority and re-checks on submit, so
 *                 refusing what has not been asked about would block bookings
 *                 further ahead than the calendar happens to reach.
 *
 * Inline rather than a popover: it is the primary control on this form, it
 * needs no focus trap, and on a phone a popover over a scrolling form is worse
 * than the thing it replaces.
 */

/** Shared cell geometry — one source for the day, its states and the legend. */
const CELL = 'h-9 w-9 rounded-full text-sm transition-colors';

export interface BookingCalendarLabels {
  /** Legend and screen-reader wording. */
  available: string;
  unavailable: string;
  selected: string;
  previousMonth: string;
  nextMonth: string;
  /** Keyed by `DayStatus`, for the reason a day is closed. */
  unavailableReasons: Record<string, string>;
}

/**
 * The calendar's slice of the form's copy.
 *
 * An adapter rather than passing `BookingFormLabels` straight through, so the
 * component states exactly which strings it needs — and a caller that has its
 * own wording is not obliged to invent the other forty.
 */
export function calendarLabels(labels: BookingFormLabels): BookingCalendarLabels {
  return {
    available: labels.calendarAvailable,
    unavailable: labels.calendarUnavailable,
    selected: labels.calendarSelected,
    previousMonth: labels.calendarPrevMonth,
    nextMonth: labels.calendarNextMonth,
    unavailableReasons: labels.unavailable,
  };
}

interface CommonProps {
  availability: Availability | null;
  locale: string;
  labels: BookingCalendarLabels;
  /**
   * The month on screen, `YYYY-MM`. Controlled by the form, which fetches the
   * availability for whatever month this becomes — a calendar that paged on its
   * own would show months nobody had asked the server about.
   */
  month: string;
  onMonthChange: (month: string) => void;
  /** Earliest selectable day, `YYYY-MM-DD`. Defaults to today. */
  minDate?: string;
  className?: string;
}

type Props = CommonProps &
  (
    | { mode: 'single'; selected: string; onSelect: (date: string) => void }
    | {
        mode: 'range';
        selected: { from: string; to: string };
        onSelect: (range: { from: string; to: string }) => void;
      }
  );

/*
 * `YYYY-MM-DD` ↔ `Date`, in LOCAL time both ways.
 *
 * `DayPicker` builds and compares its days in the browser's own timezone, so a
 * UTC-midnight `Date` is the previous day anywhere west of Greenwich: a visitor
 * in New York clicking the 21st would have selected the 20th. The site's own
 * dates are already local — `isoDay` reads local parts — so local is the one
 * consistent choice. The server re-checks in the site's timezone regardless.
 */
function localDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toDate(iso: string): Date | undefined {
  return iso ? localDate(iso) : undefined;
}

/** The day after `iso`, as a local `Date`. */
function dayAfter(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d + 1);
}

function toIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

export function BookingCalendar(props: Props) {
  const { availability, locale, labels, month, onMonthChange, minDate, className } = props;
  const min = minDate || isoDay(0);

  const { available, unavailable } = useMemo(() => {
    const yes: Date[] = [];
    const no: Date[] = [];
    for (const [date, day] of availability?.days ?? []) {
      if (date < min) continue;
      (day.bookable ? yes : no).push(localDate(date));
    }
    return { available: yes, unavailable: no };
  }, [availability, min]);

  /*
   * Half-picked range: a check-in is set and the next click chooses the
   * check-out. That day is a DEPARTURE, not an occupancy — the guest leaves
   * that morning — so it needs no vacancy, and `stayRangeError` on the server
   * deliberately does not test it. Greying out a full day here would refuse the
   * commonest stay there is: one ending the morning the next guest arrives.
   */
  const rangeStart = props.mode === 'range' ? props.selected.from : '';
  const pickingCheckOut = props.mode === 'range' && Boolean(rangeStart) && !props.selected.to;

  /*
   * Otherwise: disabled = before the first selectable day, or checked and not
   * free. Explicitly NOT "everything that is not available" — a day we have not
   * asked the server about is unknown, and unknown is not closed.
   */
  const disabled = useMemo<Matcher[]>(() => {
    if (pickingCheckOut) return [{ before: dayAfter(rangeStart) }];
    return [{ before: localDate(min) }, ...unavailable];
  }, [min, unavailable, pickingCheckOut, rangeStart]);

  const dayLabel = (date: Date) => {
    const iso = toIso(date);
    const reason = reasonFor(availability, iso);
    if (reason) return labels.unavailableReasons[reason] ?? labels.unavailable;
    return isKnown(availability, iso) ? labels.available : '';
  };

  const shared = {
    locale: locale === 'en' ? enGB : el,
    // Greek and British weeks both start on Monday; the library's default
    // follows the locale, but stating it keeps the two languages identical.
    weekStartsOn: 1 as const,
    month: localDate(`${month}-01`),
    onMonthChange: (next: Date) => onMonthChange(monthOf(toIso(next))),
    startMonth: localDate(`${min.slice(0, 7)}-01`),
    disabled,
    modifiers: { available, unchecked: (date: Date) => !isKnown(availability, toIso(date)) },
    showOutsideDays: false,
    labels: {
      labelPrevious: () => labels.previousMonth,
      labelNext: () => labels.nextMonth,
      labelDayButton: (date: Date) => {
        const note = dayLabel(date);
        return note ? `${date.getDate()} — ${note}` : String(date.getDate());
      },
    },
    classNames: {
      root: 'w-full',
      months: 'flex flex-col',
      month: 'w-full',
      month_caption: 'flex h-9 items-center justify-center',
      caption_label: 'text-sm font-medium capitalize',
      nav: 'flex items-center justify-between absolute inset-x-0 top-0 h-9 px-1',
      button_previous:
        'flex h-8 w-8 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 disabled:opacity-30',
      button_next:
        'flex h-8 w-8 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 disabled:opacity-30',
      chevron: 'h-4 w-4 fill-current',
      month_grid: 'w-full border-collapse',
      weekdays: 'flex',
      weekday: 'w-9 flex-1 pb-1 text-center text-xs font-normal text-neutral-500',
      week: 'flex',
      day: 'flex-1 p-0.5 text-center',
      day_button: `${CELL} mx-auto flex items-center justify-center bg-neutral-100 text-neutral-600 hover:bg-neutral-200`,
      // Grey and inert. `disabled` wins over `available` because a day can be
      // both — a bookable date before `minDate` on a stay's check-out calendar.
      disabled:
        '[&_button]:bg-neutral-50 [&_button]:text-neutral-300 [&_button]:hover:bg-neutral-50',
      outside: 'invisible',
      today: '[&_button]:font-semibold',
    },
    modifiersClassNames: {
      available:
        '[&_button]:bg-transparent [&_button]:text-green-800 [&_button]:ring-1 [&_button]:ring-green-600 [&_button]:hover:bg-green-50',
      unchecked:
        '[&_button]:bg-transparent [&_button]:text-neutral-600 [&_button]:hover:bg-neutral-100',
      selected:
        '[&_button]:!bg-neutral-900 [&_button]:!text-white [&_button]:!ring-2 [&_button]:!ring-neutral-900',
      range_middle: '[&_button]:!bg-green-100 [&_button]:!text-green-900 [&_button]:!ring-0',
    },
  };

  return (
    <div
      className={`relative rounded-sm border border-neutral-200 bg-white p-3 ${className ?? ''}`}
    >
      {props.mode === 'single' ? (
        <DayPicker
          {...shared}
          mode="single"
          selected={toDate(props.selected)}
          // A second click on the chosen day clears it in `DayPicker`; the form
          // requires a date, so the current one is kept instead of blanking.
          onSelect={(date) => props.onSelect(date ? toIso(date) : props.selected)}
        />
      ) : (
        <DayPicker
          {...shared}
          mode="range"
          selected={
            toDate(props.selected.from)
              ? ({ from: toDate(props.selected.from), to: toDate(props.selected.to) } as DateRange)
              : undefined
          }
          /*
           * No `excludeDisabled`: nothing is disabled while the check-out is
           * being chosen, so it could not act anyway, and a range that does
           * span a blocked night is caught by `stayRangeError` — which says
           * WHICH night, where silently collapsing the range says nothing.
           */
          onSelect={(range) =>
            props.onSelect({
              from: range?.from ? toIso(range.from) : '',
              to: range?.to ? toIso(range.to) : '',
            })
          }
        />
      )}

      <Legend labels={labels} />
    </div>
  );
}

function Legend({ labels }: { labels: BookingCalendarLabels }) {
  return (
    <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-neutral-100 pt-2 text-xs text-neutral-600">
      <li className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-full ring-1 ring-green-600" aria-hidden />
        {labels.available}
      </li>
      <li className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-full bg-neutral-100" aria-hidden />
        {labels.unavailable}
      </li>
      <li className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-full bg-neutral-900" aria-hidden />
        {labels.selected}
      </li>
    </ul>
  );
}
