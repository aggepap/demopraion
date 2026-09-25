'use client';

import type { ReactNode } from 'react';

import type {
  BookingFormChoice,
  BookingFormExtra,
  BookingFormResource,
} from './booking-form-types';

/** The one input style, so a transport field and a stay field cannot drift. */
export function inputClass(invalid = false): string {
  return `rounded-sm border px-3 py-2 ${invalid ? 'border-red-400 bg-red-50' : 'border-neutral-300'}`;
}

/**
 * The second half of the form, shown once there is a date to hang it on.
 *
 * A booking form that opens with every field at once — option, extras,
 * questions, price, name, email, phone, terms — reads as a form to be endured
 * rather than a date to be chosen. Asking for the date first is also the honest
 * order: nothing below it can be answered until the calendar has been, and the
 * price cannot even be quoted.
 *
 * NOT rendered while hidden, rather than hidden with CSS: fields that are not
 * applicable yet must not be reachable by Tab, submitted, or read out by a
 * screen reader as though they were part of the current step.
 */
export function Reveal({
  show,
  children,
  className = 'flex flex-col gap-5',
}: {
  show: boolean;
  children: ReactNode;
  className?: string;
}) {
  if (!show) return null;
  return <div className={`booking-reveal ${className}`}>{children}</div>;
}

export function FieldNote({
  children,
  tone = 'muted',
}: {
  children: ReactNode;
  tone?: 'muted' | 'error';
}) {
  return (
    <span
      className={`text-xs ${tone === 'error' ? 'font-medium text-red-700' : 'text-neutral-500'}`}
      role={tone === 'error' ? 'alert' : undefined}
    >
      {children}
    </span>
  );
}

/**
 * The unit picker — a yacht, a villa, a board package.
 *
 * Renders nothing when the experience lists no options, which is how a single
 * villa is booked: there is nothing to choose, so the guest is asked nothing.
 */
export function OptionField({
  resources,
  value,
  onChange,
  label,
}: {
  resources: BookingFormResource[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  if (resources.length === 0) return null;
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass()}>
        {resources.map((r) => (
          <option key={r.id} value={r.id}>
            {r.title}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ExtrasFields({
  extras,
  selected,
  onChange,
  currency,
  locale,
  suffix,
  legend,
  formatPrice,
}: {
  extras: BookingFormExtra[];
  selected: string[];
  onChange: (ids: string[]) => void;
  currency: string;
  locale: string;
  suffix: string;
  legend: string;
  formatPrice: (amount: number, currency: string, locale: string) => string;
}) {
  if (extras.length === 0) return null;
  return (
    <fieldset className="flex flex-col gap-2 text-sm">
      <legend className="font-medium">{legend}</legend>
      {extras.map((extra) => (
        <label key={extra.id} className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={selected.includes(extra.id)}
            onChange={(e) =>
              onChange(
                e.target.checked ? [...selected, extra.id] : selected.filter((i) => i !== extra.id)
              )
            }
            className="h-4 w-4"
          />
          <span>
            {extra.name} — {formatPrice(extra.price, currency, locale)}
            {suffix ? ` ${suffix}` : ''}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function ChoiceFields({
  choices,
  answers,
  onChange,
}: {
  choices: BookingFormChoice[];
  answers: Record<string, string>;
  onChange: (answers: Record<string, string>) => void;
}) {
  return (
    <>
      {choices.map((choice) => (
        <label key={choice.id} className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{choice.title}</span>
          <select
            required
            value={answers[choice.id] ?? ''}
            onChange={(e) => onChange({ ...answers, [choice.id]: e.target.value })}
            className={inputClass()}
          >
            {choice.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
      ))}
    </>
  );
}
