'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Link } from '@/lib/i18n/routing';
import { formatPrice } from '@/lib/money';

import { StayFields, stayRangeError } from './StayFields';
import { TransportFields } from './TransportFields';
import { Reveal, inputClass } from './booking-form-fields';
import {
  isoDay,
  monthOf,
  nightsBetween,
  type BookingFormChoice,
  type BookingFormExtra,
  type BookingFormLabels,
  type BookingFormResource,
  type Selection,
} from './booking-form-types';
import { useAvailability } from './use-availability';

export type {
  BookingFormResource,
  BookingFormExtra,
  BookingFormChoice,
  BookingFormLabels,
} from './booking-form-types';

interface QuoteLine {
  code: string;
  label: string;
  quantity: number;
  /** Minor units. What ONE of whatever the label counts costs. */
  unitAmount: number;
  amount: number;
}

interface QuoteResponse {
  ok: boolean;
  data?: {
    currency: string;
    quote:
      | { ok: true; total: number; lines: QuoteLine[]; persons: number }
      | { ok: false; reason: string };
  };
}

const DEBOUNCE_MS = 250;

/**
 * The booking form.
 *
 * **The client never computes a price.** It gathers a selection, posts it to
 * `/api/cms/booking/quote` and renders whatever comes back. The same server
 * function prices the submit, so what the customer is shown and what is stored
 * cannot disagree — there is only ever one authority.
 *
 * This shell owns the selection, the quote, the customer details and the
 * submit; `TransportFields` and `StayFields` render the inputs that differ. The
 * split is by what is being SOLD, not by what looks similar: a charter is a
 * day, a stay is a range of nights, and the two need different questions.
 */
export function BookingForm({
  slug,
  locale,
  currency,
  mode,
  kind = 'transport',
  minPersons,
  maxPersons,
  hasPersons,
  resources,
  resourceLabel,
  extras,
  extrasMultiplyPerPerson,
  choices,
  labels,
}: {
  slug: string;
  locale: string;
  currency: string;
  mode: 'request' | 'instant';
  kind?: 'transport' | 'stay';
  minPersons: number;
  maxPersons: number;
  hasPersons: boolean;
  resources: BookingFormResource[];
  resourceLabel?: string;
  extras: BookingFormExtra[];
  extrasMultiplyPerPerson: boolean;
  choices: BookingFormChoice[];
  labels: BookingFormLabels;
}) {
  const isStay = kind === 'stay';

  const [selection, setSelection] = useState<Selection>(() => ({
    date: '',
    endDate: '',
    persons: minPersons,
    adults: 2,
    children: 0,
    resourceId: resources[0]?.id ?? '',
    extraIds: [],
    answers: Object.fromEntries(choices.map((c) => [c.id, c.options[0] ?? ''])),
  }));
  const update = useCallback(
    (patch: Partial<Selection>) => setSelection((s) => ({ ...s, ...patch })),
    []
  );

  const [customer, setCustomer] = useState({ name: '', email: '', phone: '' });
  const [notes, setNotes] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);

  const [quote, setQuote] = useState<{ total: number; lines: QuoteLine[] } | null>(null);
  const [quoteNote, setQuoteNote] = useState<string | null>(null);
  const [pricing, setPricing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);

  /*
   * The month on screen in the calendar, lifted here because the availability
   * it drives is fetched here — the quote needs the same data, and two
   * components asking the endpoint the same question is one too many.
   */
  const [month, setMonth] = useState(() => monthOf(isoDay(0)));
  const availability = useAvailability(slug, locale, selection.resourceId, month, true, isStay ? undefined : selection.persons);
  const nights = useMemo(
    () => (isStay ? nightsBetween(selection.date, selection.endDate).length : 0),
    [isStay, selection.date, selection.endDate]
  );
  const rangeError = isStay ? stayRangeError(selection, availability, labels) : null;

  const abortRef = useRef<AbortController | null>(null);

  // The wire payload, and the one place the two kinds differ in what they send.
  const payload = useMemo(
    () => ({
      slug,
      locale,
      date: selection.date || undefined,
      endDate: isStay ? selection.endDate || undefined : undefined,
      persons: isStay ? undefined : selection.persons,
      adults: isStay ? selection.adults : undefined,
      children: isStay ? selection.children : undefined,
      resourceId: selection.resourceId || undefined,
      extraIds: selection.extraIds,
    }),
    [slug, locale, isStay, selection]
  );

  const refreshQuote = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPricing(true);
    try {
      const res = await fetch('/api/cms/booking/quote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const body: QuoteResponse = await res.json();
      const q = body.data?.quote;
      if (q?.ok) {
        setQuote({ total: q.total, lines: q.lines });
        setQuoteNote(null);
      } else {
        // Keep the last good figure on screen. A total that blanks on every
        // keystroke reads as "the price just changed".
        setQuoteNote(labels.onRequest);
      }
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') setQuoteNote(labels.onRequest);
    } finally {
      if (!controller.signal.aborted) setPricing(false);
    }
  }, [payload, labels.onRequest]);

  useEffect(() => {
    const timer = setTimeout(refreshQuote, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [refreshQuote]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/cms/booking/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          date: selection.date,
          answers: selection.answers,
          customer,
          notes: notes || undefined,
          acceptTerms,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setError(body?.message ?? labels.errorGeneric);
        return;
      }
      if (body.data?.redirectUrl) {
        window.location.href = body.data.redirectUrl;
        return;
      }
      setReference(body.data?.reference ?? null);
    } catch {
      setError(labels.errorGeneric);
    } finally {
      setSubmitting(false);
    }
  }

  // Success is an inline panel, not a redirect: a refresh cannot resubmit, and
  // no reference ends up in a URL someone might share.
  if (reference) {
    return (
      <section className="rounded-sm border border-green-200 bg-green-50 p-6">
        <h2 className="font-display text-lg font-semibold text-green-900">{labels.successTitle}</h2>
        <p className="mt-2 text-sm text-green-900">
          {labels.successBody.replace('{reference}', reference)}
        </p>
        <p className="mt-3">
          <Link href="/booking/lookup" className="text-sm font-medium text-green-900 underline">
            {labels.lookupLink}
          </Link>
        </p>
      </section>
    );
  }

  const totalText = quote ? formatPrice(quote.total / 100, currency, locale) : null;
  // A stay needs both ends of the range; transport needs one date. Either way
  // a known-bad selection does not get to reach the server.
  const incomplete = isStay ? !selection.date || !selection.endDate : !selection.date;
  const blocked = submitting || incomplete || Boolean(rangeError);
  /*
   * The form opens on the calendar and the party size alone; everything else
   * arrives once there is a date to hang it on. The same test as `incomplete`
   * on purpose — the fields being withheld are exactly the ones that cannot be
   * answered, priced or submitted until the date exists.
   *
   * The party size is not part of the test: it is pre-filled with the minimum,
   * so requiring a change would leave the form stuck for everyone happy with it.
   */
  const revealed = !incomplete;

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-5 rounded-sm border border-neutral-200 bg-white p-6"
    >
      <div>
        <h2 className="font-display text-lg font-semibold">{labels.title}</h2>
        {/* The mode has to be visible BEFORE committing: getting a payment page
            when you expected to ask a question is a bad surprise, and so is the
            reverse. */}
        <p className="mt-1 text-sm text-neutral-600">
          {mode === 'instant' ? labels.noteInstant : labels.noteRequest}
        </p>
      </div>

      {isStay ? (
        <StayFields
          selection={selection}
          update={update}
          currency={currency}
          locale={locale}
          resources={resources}
          resourceLabel={resourceLabel}
          extras={extras}
          extrasMultiplyPerPerson={extrasMultiplyPerPerson}
          choices={choices}
          availability={availability}
          month={month}
          onMonthChange={setMonth}
          nights={nights}
          revealed={revealed}
          labels={labels}
        />
      ) : (
        <TransportFields
          selection={selection}
          update={update}
          currency={currency}
          locale={locale}
          hasPersons={hasPersons}
          minPersons={minPersons}
          maxPersons={maxPersons}
          resources={resources}
          resourceLabel={resourceLabel}
          extras={extras}
          extrasMultiplyPerPerson={extrasMultiplyPerPerson}
          choices={choices}
          availability={availability}
          month={month}
          onMonthChange={setMonth}
          revealed={revealed}
          labels={labels}
        />
      )}

      <Reveal show={revealed}>
        {/* The breakdown dims while re-pricing rather than emptying. */}
        <section
          className={`rounded-sm bg-neutral-50 p-4 text-sm transition-opacity ${pricing ? 'opacity-50' : ''}`}
          aria-busy={pricing}
        >
          <h3 className="mb-2 font-medium">{labels.breakdownTitle}</h3>
          {quote ? (
            <>
              <ul className="flex flex-col gap-1">
                {/* The key carries the index: a stay crossing a season emits two
                    nightly lines under the same `code`, and they are different rows. */}
                {quote.lines.map((line, i) => (
                  <li key={`${line.code}-${i}`} className="flex justify-between gap-4">
                    <span>
                      {line.label}
                      {/* The UNIT price, not the count. The count is already in the
                          label ("— 7 nights"), so "× 7" repeated it and left the one
                          number the guest wants to check — what a night costs —
                          nowhere on the row. */}
                      {line.quantity > 1 && line.unitAmount > 0 ? (
                        <span className="text-neutral-600">
                          {' × '}
                          {formatPrice(line.unitAmount / 100, currency, locale)}
                        </span>
                      ) : null}
                    </span>
                    <span className="whitespace-nowrap">{formatPrice(line.amount / 100, currency, locale)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 flex justify-between border-t border-neutral-200 pt-2 font-semibold">
                <span>{labels.total}</span>
                <span>{totalText}</span>
              </p>
            </>
          ) : (
            <p className="text-neutral-600">
              {pricing ? labels.pricePending : (quoteNote ?? labels.pricePending)}
            </p>
          )}
        </section>

        <fieldset className="flex flex-col gap-3 text-sm">
          <legend className="font-medium">{labels.yourDetails}</legend>
          <input
            required
            value={customer.name}
            onChange={(e) => setCustomer((c) => ({ ...c, name: e.target.value }))}
            placeholder={labels.name}
            aria-label={labels.name}
            className={inputClass()}
          />
          <input
            required
            type="email"
            value={customer.email}
            onChange={(e) => setCustomer((c) => ({ ...c, email: e.target.value }))}
            placeholder={labels.email}
            aria-label={labels.email}
            className={inputClass()}
          />
          <input
            value={customer.phone}
            onChange={(e) => setCustomer((c) => ({ ...c, phone: e.target.value }))}
            placeholder={labels.phone}
            aria-label={labels.phone}
            className={inputClass()}
          />
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={labels.notes}
            aria-label={labels.notes}
            rows={3}
            className={inputClass()}
          />
        </fieldset>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            required
            checked={acceptTerms}
            onChange={(e) => setAcceptTerms(e.target.checked)}
            className="h-4 w-4"
          />
          <span>{labels.terms}</span>
        </label>

        {error ? (
          <p
            role="alert"
            className="rounded-sm border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          >
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={blocked}
          className="bg-warm-gold text-midnight-navy hover:bg-warm-gold-dark rounded-sm px-4 py-2.5 font-medium transition-colors disabled:opacity-50"
        >
          {submitting
            ? labels.submitting
            : mode === 'instant' && totalText
              ? labels.submitInstant.replace('{price}', totalText)
              : labels.submitRequest}
        </button>
      </Reveal>
    </form>
  );
}
