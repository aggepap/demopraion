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
 * The transport half of the booking form: one date, a party size, and the
 * vessel.
 *
 * Unchanged in shape from the single-kind form it came from, with one addition
 * — the date is now checked against the availability calendar as it is chosen,
 * rather than accepted and refused after the whole form is filled in.
 */
export function TransportFields({
  selection,
  update,
  currency,
  locale,
  hasPersons,
  minPersons,
  maxPersons,
  resources,
  resourceLabel,
  extras,
  extrasMultiplyPerPerson,
  choices,
  availability,
  month,
  onMonthChange,
  revealed,
  labels,
}: {
  selection: Selection;
  update: (patch: Partial<Selection>) => void;
  currency: string;
  locale: string;
  hasPersons: boolean;
  minPersons: number;
  maxPersons: number;
  resources: BookingFormResource[];
  resourceLabel?: string;
  extras: BookingFormExtra[];
  extrasMultiplyPerPerson: boolean;
  choices: BookingFormChoice[];
  availability: Availability | null;
  /** The calendar month on screen, owned by the form — see `BookingForm`. */
  month: string;
  onMonthChange: (month: string) => void;
  /** Whether the date has been chosen — see `Reveal`. */
  revealed: boolean;
  labels: BookingFormLabels;
}) {
  const unavailable = reasonFor(availability, selection.date);

  return (
    <>
      <div className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{labels.date}</span>
        <BookingCalendar
          mode="single"
          selected={selection.date}
          onSelect={(date) => update({ date })}
          availability={availability}
          locale={locale}
          month={month}
          onMonthChange={onMonthChange}
          labels={calendarLabels(labels)}
        />
        {/* A date can still be refused after it was picked — the option changed
            under it, or it was chosen before its month had been checked. */}
        {unavailable ? (
          <FieldNote tone="error">
            {labels.unavailable[unavailable] ?? labels.unavailable.closed}
          </FieldNote>
        ) : null}
      </div>

      {hasPersons ? (
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{labels.persons}</span>
          <input
            type="number"
            min={minPersons}
            max={maxPersons}
            value={selection.persons}
            onChange={(e) => update({ persons: Number(e.target.value) })}
            className={`w-32 ${inputClass()}`}
          />
          <FieldNote>
            {labels.personsRange
              .replace('{min}', String(minPersons))
              .replace('{max}', String(maxPersons))}
          </FieldNote>
        </label>
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
