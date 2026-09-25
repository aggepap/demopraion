'use client';

import { formatPrice } from '@/lib/money';

import type {
  Availability,
  BookingFormChoice,
  BookingFormExtra,
  BookingFormLabels,
  BookingFormResource,
  Selection,
} from './booking-form-types';
import { formatDay, nightsBetween } from './booking-form-types';
import { reasonFor } from './use-availability';
import { BookingCalendar, calendarLabels } from './BookingCalendar';
import {
  ChoiceFields,
  ExtrasFields,
  FieldNote,
  OptionField,
  Reveal,
  inputClass,
} from './booking-form-fields';

/**
 * What is wrong with the chosen range, expressed the way the guest can fix it.
 *
 * Checked in the same order the server checks it, so the two never disagree
 * about which problem to report: the shape of the REQUEST first (is it a range,
 * is it long enough, may you arrive that day), then the CALENDAR. Telling
 * someone a night is taken when their real problem is a three-night minimum
 * sends them hunting for dates that will fail identically.
 *
 * This is advice, not authority — `createReservation` re-checks everything
 * under the row lock. Its job is to save the guest from filling in a whole form
 * for a range that was never going to work.
 */
export function stayRangeError(
  selection: Selection,
  availability: Availability | null,
  labels: BookingFormLabels
): string | null {
  const { date: checkIn, endDate: checkOut } = selection;
  if (!checkIn || !checkOut) return null;

  const nights = nightsBetween(checkIn, checkOut);
  if (nights.length === 0) return labels.unavailable.invalid_range;

  const rules = availability?.rules;
  if (rules) {
    if (rules.minNights && nights.length < rules.minNights) {
      return labels.minNights.replace('{count}', String(rules.minNights));
    }
    if (rules.maxNights && nights.length > rules.maxNights) {
      return labels.maxNights.replace('{count}', String(rules.maxNights));
    }
    if (rules.checkInDays?.length && !rules.checkInDays.includes(weekday(checkIn))) {
      return labels.unavailable.bad_checkin_day;
    }
    if (rules.checkOutDays?.length && !rules.checkOutDays.includes(weekday(checkOut))) {
      return labels.unavailable.bad_checkout_day;
    }
  }

  // The check-out day is deliberately not tested: it is a departure, not an
  // occupancy, and a stay ending the morning someone else arrives is fine.
  for (const night of nights) {
    const reason = reasonFor(availability, night);
    if (reason) {
      const why = labels.unavailable[reason] ?? labels.unavailable.closed;
      // Naming the night matters: on a week-long stay, "one night is taken"
      // leaves the guest to find it by trial and error.
      return `${night} — ${why}`;
    }
  }

  return null;
}

function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/**
 * The stay half of the booking form: a range of nights, who is coming, and
 * which unit.
 */
export function StayFields({
  selection,
  update,
  currency,
  locale,
  resources,
  resourceLabel,
  extras,
  extrasMultiplyPerPerson,
  choices,
  availability,
  month,
  onMonthChange,
  nights,
  revealed,
  labels,
}: {
  selection: Selection;
  update: (patch: Partial<Selection>) => void;
  currency: string;
  locale: string;
  resources: BookingFormResource[];
  resourceLabel?: string;
  extras: BookingFormExtra[];
  extrasMultiplyPerPerson: boolean;
  choices: BookingFormChoice[];
  availability: Availability | null;
  /** The calendar month on screen, owned by the form — see `BookingForm`. */
  month: string;
  onMonthChange: (month: string) => void;
  /** Whether both ends of the stay have been chosen — see `Reveal`. */
  revealed: boolean;
  nights: number;
  labels: BookingFormLabels;
}) {
  const rules = availability?.rules;
  const rangeError = stayRangeError(selection, availability, labels);
  const childrenEnabled = rules?.childrenEnabled ?? false;
  const maxOccupancy = rules?.maxOccupancy ?? 0;
  const guests = selection.adults + (childrenEnabled ? selection.children : 0);
  const overOccupancy = maxOccupancy > 0 && guests > maxOccupancy;

  return (
    <>
      {/* One calendar for both ends of the stay. Two separate date fields could
          not show what matters most here — that a night in the MIDDLE of an
          otherwise free range is taken — and made the reader hold the range in
          their head across two controls. */}
      <div className="flex flex-col gap-1 text-sm">
        <span className="font-medium">
          {labels.checkIn} — {labels.checkOut}
        </span>
        <BookingCalendar
          mode="range"
          selected={{ from: selection.date, to: selection.endDate }}
          onSelect={(range) => update({ date: range.from, endDate: range.to })}
          availability={availability}
          locale={locale}
          month={month}
          onMonthChange={onMonthChange}
          labels={calendarLabels(labels)}
        />
      </div>

      {/* What was picked, in words. "3 night(s)" alone made the reader scroll
          back up to the grid to check WHICH three — and a half-picked range
          showed nothing at all, so a stray click that set only a check-in left
          the form looking untouched. */}
      {selection.date ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm bg-neutral-50 px-3 py-2">
          <span className="text-sm text-neutral-800">
            <span className="font-medium">{formatDay(selection.date, locale)}</span>
            {selection.endDate ? (
              <>
                {' – '}
                <span className="font-medium">{formatDay(selection.endDate, locale)}</span>
                {nights > 0 ? (
                  <span className="text-neutral-500">
                    {' · '}
                    {labels.nights.replace('{count}', String(nights))}
                  </span>
                ) : null}
              </>
            ) : (
              <span className="text-neutral-500">
                {' · '}
                {labels.pickCheckOut}
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={() => update({ date: '', endDate: '' })}
            className="rounded-sm px-2 py-1 text-xs font-medium text-neutral-600 underline underline-offset-2 hover:text-neutral-900"
          >
            {labels.clearDates}
          </button>
        </div>
      ) : null}

      {rangeError ? <FieldNote tone="error">{rangeError}</FieldNote> : null}

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{labels.adults}</span>
          <input
            type="number"
            min={1}
            max={maxOccupancy > 0 ? maxOccupancy : 99}
            value={selection.adults}
            onChange={(e) => update({ adults: Math.max(1, Number(e.target.value)) })}
            className={inputClass(overOccupancy)}
          />
        </label>
        {childrenEnabled ? (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{labels.children}</span>
            <input
              type="number"
              min={0}
              max={maxOccupancy > 0 ? maxOccupancy : 99}
              value={selection.children}
              onChange={(e) => update({ children: Math.max(0, Number(e.target.value)) })}
              className={inputClass(overOccupancy)}
            />
            {rules?.childMaxAge ? (
              <FieldNote>
                {labels.childrenHint.replace('{age}', String(rules.childMaxAge))}
              </FieldNote>
            ) : null}
          </label>
        ) : null}
      </div>

      {overOccupancy ? (
        <FieldNote tone="error">
          {labels.occupancyRange.replace('{max}', String(maxOccupancy))}
        </FieldNote>
      ) : null}

      <Reveal show={revealed}>
        <OptionField
          resources={resources}
          value={selection.resourceId}
          onChange={(resourceId) => update({ resourceId })}
          label={resourceLabel || labels.resource}
        />

        <ExtrasFields
          extras={extras}
          selected={selection.extraIds}
          onChange={(extraIds) => update({ extraIds })}
          currency={currency}
          locale={locale}
          suffix={extrasMultiplyPerPerson ? labels.extrasPerPerson : ''}
          legend={labels.extras}
          formatPrice={formatPrice}
        />

        <ChoiceFields
          choices={choices}
          answers={selection.answers}
          onChange={(answers) => update({ answers })}
        />
      </Reveal>
    </>
  );
}
