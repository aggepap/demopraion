'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { SchedulableSlot, ScheduleDay } from '../modules/booking/schedule';
import { Badge, Button, Checkbox, Drawer, Field, Icon, InfoTip, Select, TextInput } from './ui';
import { cn } from './ui/cn';

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface OverbookedSlot {
  slotKey: string;
  slotDate: string;
  capacity: number;
  taken: number;
}

interface ScheduleResponse {
  ok: boolean;
  data?: {
    slots: SchedulableSlot[];
    slot: SchedulableSlot | null;
    days: ScheduleDay[];
    overbooked: OverbookedSlot[];
  };
}

/**
 * What "Price override" does for this calendar, in the operator's terms.
 *
 * It depends on whose calendar it is: on a transport experience it is the base
 * price for the day, on one of its options it is that option's price, and on a
 * stay it is the rate for that night. The quote, the stored booking and the
 * drift warning all read it the same way (`quote-selection.ts`).
 */
export function priceOverrideHelp(slot: Pick<SchedulableSlot, 'kind' | 'isOption'>): string {
  const tail = 'In major units (e.g. 250). Leave empty to price it the usual way.';
  if (slot.kind === 'stay') {
    return `Replaces the nightly rate for this night, whatever the season. Extra-guest charges, fees and extras are still added. ${tail}`;
  }
  if (slot.isOption) {
    return `Replaces this option’s price for this date when a customer chooses it. ${tail}`;
  }
  return `Replaces the base price for this date, whatever the season — per person when the experience is priced per person. Price bands (tiered pricing) and options with their own price are not affected. ${tail}`;
}

/** `YYYY-MM` for a month offset from the current one. */
function monthKey(offset = 0): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthBounds(key: string): { from: string; to: string } {
  const [y, m] = key.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const last = new Date(Date.UTC(y, m, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

function monthLabel(key: string): string {
  const { from } = monthBounds(key);
  return new Date(`${from}T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function shiftMonth(key: string, by: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Monday-first index (0 = Monday) for a `YYYY-MM-DD`. */
function mondayIndex(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/**
 * The availability calendar.
 *
 * Each experience declares its own season, weekdays, capacity and cut-off in
 * its editor — that is the rule, and this screen never touches it. What it
 * edits is the EXCEPTION for one date: closed, a different capacity, a
 * different price, a note. Those are `booking_slots` rows, the same rows the
 * allocation lock reads, so a change here is live for the next booking attempt.
 *
 * A stay is managed per unit, because that is where a stay's nights are held.
 * Picking "Villa Nerea → Sea View Suite" shows that suite's calendar and
 * nothing else's.
 */
export function AvailabilityCalendar({ canWrite }: { canWrite: boolean }) {
  const [slots, setSlots] = useState<SchedulableSlot[]>([]);
  const [slotKey, setSlotKey] = useState<string>('');
  const [month, setMonth] = useState(() => monthKey());
  const [days, setDays] = useState<ScheduleDay[]>([]);
  const [overbooked, setOverbooked] = useState<OverbookedSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ScheduleDay | null>(null);
  /** Bumped to force a refetch after a save. */
  const [reloadToken, setReloadToken] = useState(0);

  const slot = useMemo(() => slots.find((s) => s.slotKey === slotKey) ?? null, [slots, slotKey]);

  /*
   * The effect only STARTS the request and clears `loading` when it lands;
   * `loading` is switched on by whatever the operator did to cause the reload
   * (below). Setting it inside the effect would be a synchronous setState in an
   * effect body — a cascading render, and something React now flags outright.
   *
   * The AbortController matters here too: clicking through four months quickly
   * would otherwise let a slow first response overwrite a fast fourth one, and
   * the grid would end up showing a month the header does not name.
   */
  useEffect(() => {
    const controller = new AbortController();
    const { from, to } = monthBounds(month);
    const params = new URLSearchParams({ from, to });
    if (slotKey) params.set('slotKey', slotKey);

    fetch(`/api/cms/booking/schedule?${params.toString()}`, { signal: controller.signal })
      .then(async (res) => {
        const body: ScheduleResponse = await res.json();
        if (controller.signal.aborted) return;
        if (!res.ok || !body.ok || !body.data) {
          setError('Could not load the calendar.');
          return;
        }
        setError(null);
        setSlots(body.data.slots);
        setDays(body.data.days);
        setOverbooked(body.data.overbooked);
        // First load: adopt whichever slot the server defaulted to, so the grid
        // is never showing dates that belong to nothing.
        if (!slotKey && body.data.slot) setSlotKey(body.data.slot.slotKey);
      })
      .catch((err: Error) => {
        if (err?.name !== 'AbortError') setError('Could not load the calendar.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [month, slotKey, reloadToken]);

  /** Change what is shown, and say so. Called from event handlers, where
   *  setting state is exactly what is supposed to happen. */
  const goToMonth = useCallback((next: string) => {
    setLoading(true);
    setMonth(next);
  }, []);
  const selectSlot = useCallback((next: string) => {
    setLoading(true);
    setSlotKey(next);
  }, []);
  const reload = useCallback(() => {
    setLoading(true);
    setReloadToken((n) => n + 1);
  }, []);

  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const overbookedDates = useMemo(() => new Set(overbooked.map((o) => o.slotDate)), [overbooked]);

  // Leading blanks so the 1st lands under its weekday.
  const leading = days.length > 0 ? mondayIndex(days[0].date) : 0;

  if (!loading && slots.length === 0) {
    return (
      <div className="rounded-sm border border-neutral-200 bg-white p-6 text-sm text-neutral-600">
        <p className="font-medium text-neutral-900">Nothing to schedule yet</p>
        <p className="mt-1">
          Publish an experience and it appears here. A stay with options is managed per option; everything
          else is managed as a whole.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Experience" className="min-w-64">
          <Select value={slotKey} onChange={(e) => selectSlot(e.target.value)}>
            {slots.map((s) => (
              <option key={s.slotKey} value={s.slotKey}>
                {s.isOption ? `${s.experience} → ${s.label}` : s.label}
              </option>
            ))}
          </Select>
        </Field>

        <div className="flex items-center gap-2">
          {/* `Icon` falls back to a generic glyph for a name it does not have,
              and there is no left chevron in the set — so the right one is
              turned around rather than silently rendering the wrong picture. */}
          <Button variant="secondary" size="sm" aria-label="Previous month" onClick={() => goToMonth(shiftMonth(month, -1))}>
            <Icon name="chevron-right" size={14} className="rotate-180" />
          </Button>
          <span className="min-w-40 text-center text-sm font-medium">{monthLabel(month)}</span>
          <Button variant="secondary" size="sm" aria-label="Next month" onClick={() => goToMonth(shiftMonth(month, 1))}>
            <Icon name="chevron-right" size={14} />
          </Button>
          {month !== monthKey() ? (
            <Button variant="ghost" size="sm" onClick={() => goToMonth(monthKey())}>
              Today
            </Button>
          ) : null}
        </div>

        {slot ? (
          <p className="ml-auto text-xs text-neutral-500">
            Default capacity {slot.defaultCapacity} per {slot.kind === 'stay' ? 'night' : 'day'}
          </p>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="rounded-sm border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {/* "Should always be empty" is a claim worth being able to check. */}
      {overbooked.length > 0 ? (
        <div className="rounded-sm border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">
            {overbooked.length} date{overbooked.length === 1 ? '' : 's'} hold more bookings than the capacity
            allows
          </p>
          <p className="mt-1">
            {overbooked.map((o) => `${o.slotDate} (${o.taken}/${o.capacity})`).join(', ')}. This happens when a
            capacity is lowered after bookings were taken.
          </p>
        </div>
      ) : null}

      <div className={cn('rounded-sm border border-neutral-200 bg-white p-3', loading && 'opacity-50')} aria-busy={loading}>
        <div className="grid grid-cols-7 gap-1">
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} className="px-1 pb-1 text-center text-xs font-medium text-neutral-500">
              {label}
            </div>
          ))}
          {Array.from({ length: leading }, (_, i) => (
            <div key={`pad-${i}`} />
          ))}
          {days.map((day) => (
            <DayCell
              key={day.date}
              day={day}
              overbooked={overbookedDates.has(day.date)}
              canWrite={canWrite}
              onClick={() => setEditing(day)}
            />
          ))}
        </div>

        <CalendarLegend />
      </div>

      {editing && slot ? (
        <DayEditor
          day={byDate.get(editing.date) ?? editing}
          slot={slot}
          canWrite={canWrite}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}

function DayCell({
  day,
  overbooked,
  canWrite,
  onClick,
}: {
  day: ScheduleDay;
  overbooked: boolean;
  canWrite: boolean;
  onClick: () => void;
}) {
  const taken = day.held + day.confirmed;
  const full = taken >= day.capacity;
  const today = new Date().toISOString().slice(0, 10);
  const past = day.date < today;

  return (
    <button
      type="button"
      onClick={onClick}
      // Read-only roles reach this screen through `scheduleRead` alone, so the
      // cell stays clickable to INSPECT and the editor hides its controls.
      className={cn(
        'flex min-h-20 flex-col items-start gap-0.5 rounded-sm border p-1.5 text-left text-xs transition-colors',
        'hover:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-400',
        past && 'opacity-50',
        overbooked
          ? 'border-amber-400 bg-amber-50'
          : day.closed
            ? 'border-red-200 bg-red-50'
            : full
              ? 'border-neutral-300 bg-neutral-100'
              : 'border-neutral-200 bg-white',
      )}
      aria-label={`${day.date}${day.closed ? ', closed' : ''}${canWrite ? ' — edit' : ''}`}
    >
      <span className="flex w-full items-center justify-between">
        <span className="font-medium text-neutral-900">{Number(day.date.slice(8, 10))}</span>
        {day.overridden ? <span className="h-1.5 w-1.5 rounded-full bg-neutral-500" title="Has an exception" /> : null}
      </span>

      {day.closed ? (
        <span className="font-medium text-red-700">Closed</span>
      ) : (
        <span className={cn('text-neutral-600', full && 'font-medium text-neutral-900')}>
          {taken}/{day.capacity}
        </span>
      )}

      {day.priceOverride != null ? (
        <span className="text-neutral-500">€{(day.priceOverride / 100).toFixed(0)}</span>
      ) : null}
      {day.note ? <span className="truncate text-neutral-400" title={day.note}>{day.note}</span> : null}
    </button>
  );
}

/** What "held" and "confirmed" mean on this screen — shared by the legend and the day drawer. */
const HELD_HELP =
  'Held: a booking waiting for its payment. The place is kept for it until the payment deadline, then released automatically if unpaid.';
const CONFIRMED_HELP =
  'Confirmed: a booking that is confirmed or paid. Its place is kept until it is cancelled. Requests still awaiting your reply take no place.';

/**
 * Every mark a day cell can carry, each with what it means. Exported for
 * `test/cms/commerce-info-tips.test.tsx`.
 *
 * The swatches were once the whole legend, and the two marks that are text —
 * the "3/8" figure and the "€250" — were not in it at all, so the most-read
 * number on the screen was the one nobody had explained.
 */
export function CalendarLegend() {
  const swatches: Array<[string, string, string]> = [
    ['border-neutral-200 bg-white', 'Available', 'Open for booking, with places left.'],
    ['border-neutral-300 bg-neutral-100', 'Full', 'Every place is taken. The date is not offered to customers.'],
    [
      'border-red-200 bg-red-50',
      'Closed',
      'You closed this date. Customers cannot book it; bookings already on it are kept.',
    ],
    [
      'border-amber-400 bg-amber-50',
      'Overbooked',
      'More places are taken than the capacity allows — usually because the capacity was lowered after bookings were made.',
    ],
  ];
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-neutral-100 pt-3 text-xs text-neutral-600">
      {swatches.map(([cls, label, help]) => (
        <span key={label} className="flex items-center gap-1.5">
          <span className={cn('h-3 w-3 rounded-sm border', cls)} />
          {label}
          <InfoTip label={`What “${label}” means`}>{help}</InfoTip>
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-neutral-500" /> Has an exception
        <InfoTip label="What the dot means">
          This date has its own setting — closed, a different capacity, a price override or a note. Open it to see or
          reset it.
        </InfoTip>
      </span>
      <span className="flex items-center gap-1.5">
        <span className="font-medium text-neutral-800">3/8</span> Places taken / capacity
        <InfoTip label="What the numbers mean">
          Places taken (held and confirmed) out of the date’s capacity. {HELD_HELP} {CONFIRMED_HELP}
        </InfoTip>
      </span>
      <span className="flex items-center gap-1.5">
        <span className="font-medium text-neutral-800">€250</span> Price override
        <InfoTip label="What the amount means">
          A price override set for this date. It replaces the usual price or nightly rate for bookings on it.
        </InfoTip>
      </span>
    </div>
  );
}

function DayEditor({
  day,
  slot,
  canWrite,
  onClose,
  onSaved,
}: {
  day: ScheduleDay;
  slot: SchedulableSlot;
  canWrite: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [closed, setClosed] = useState(day.closed);
  const [capacity, setCapacity] = useState(day.capacity === slot.defaultCapacity && !day.overridden ? '' : String(day.capacity));
  const [price, setPrice] = useState(day.priceOverride == null ? '' : (day.priceOverride / 100).toFixed(2));
  const [note, setNote] = useState(day.note ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const taken = day.held + day.confirmed;

  async function save(clear = false) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/cms/booking/schedule', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slotKey: slot.slotKey,
          slotDate: day.date,
          closed: clear ? false : closed,
          capacity: clear || capacity === '' ? null : Number(capacity),
          price: clear || price === '' ? null : Number(price),
          note: clear || !note.trim() ? null : note.trim(),
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setError(body?.message ?? 'Could not save.');
        return;
      }
      onSaved();
    } catch {
      setError('Could not save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer onClose={onClose} title={day.date}>
      <div className="flex flex-col gap-4 text-sm">
        <p className="text-neutral-600">
          {slot.isOption ? `${slot.experience} → ${slot.label}` : slot.label}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Badge>{taken} of {day.capacity} taken</Badge>
          {day.confirmed > 0 ? <Badge tone="green">{day.confirmed} confirmed</Badge> : null}
          {day.held > 0 ? <Badge tone="amber">{day.held} held</Badge> : null}
          <InfoTip label="What held and confirmed mean">
            {HELD_HELP} {CONFIRMED_HELP}
          </InfoTip>
        </div>

        {/* A read-only role reaches this screen through `scheduleRead` alone.
            It may INSPECT a date — that is the point of the permission — but
            offering controls the API will refuse is worse than offering none. */}
        {!canWrite ? (
          <p className="rounded-sm border border-neutral-200 bg-neutral-50 p-2 text-xs text-neutral-600">
            You have read-only access to the schedule.
          </p>
        ) : null}

        <Checkbox
          label={`Close this ${slot.kind === 'stay' ? 'night' : 'date'}`}
          info={`Stops new bookings for this ${slot.kind === 'stay' ? 'night' : 'date'}. Bookings already on it are kept and nobody is emailed — cancel them one by one if needed.`}
          checked={closed}
          disabled={!canWrite}
          onChange={(e) => setClosed(e.target.checked)}
        />

        <Field
          label="Capacity"
          description={`Leave empty to use the default of ${slot.defaultCapacity}.`}
        >
          <TextInput
            type="number"
            min={0}
            value={capacity}
            disabled={!canWrite}
            onChange={(e) => setCapacity(e.target.value)}
            placeholder={String(slot.defaultCapacity)}
          />
        </Field>

        <Field label="Price override" description={priceOverrideHelp(slot)}>
          <TextInput
            type="number"
            min={0}
            step="0.01"
            value={price}
            disabled={!canWrite}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="—"
          />
        </Field>

        <Field label="Note" description="Internal only — why this date is different.">
          <TextInput value={note} disabled={!canWrite} onChange={(e) => setNote(e.target.value)} maxLength={191} />
        </Field>

        {/* Lowering capacity below what is already booked is allowed on purpose
            — a boat breaks, a room floods — and the consequence is shown rather
            than the action refused. */}
        {!closed && capacity !== '' && Number(capacity) < taken ? (
          <p className="rounded-sm border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
            {taken} booking(s) already hold this date. Saving a lower capacity will leave it overbooked, and
            it will be flagged on the calendar.
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="rounded-sm border border-red-200 bg-red-50 p-2 text-red-800">
            {error}
          </p>
        ) : null}

        <div className="flex gap-2">
          {canWrite ? (
            <>
              <Button onClick={() => save()} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
              {day.overridden ? (
                <Button variant="secondary" onClick={() => save(true)} disabled={saving}>
                  Reset to default
                </Button>
              ) : null}
            </>
          ) : null}
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {canWrite ? 'Cancel' : 'Close'}
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
