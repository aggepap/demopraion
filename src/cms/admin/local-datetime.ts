/**
 * "Publish at" in the editor's own time zone.
 *
 * A `datetime-local` input has no zone: `2026-10-01T09:30` means 09:30 on the
 * clock of whoever typed it. The form used to send that string as it was, and
 * the server read it in the SERVER's zone; the edit page then filled the box
 * with `toISOString().slice(0, 16)` — the UTC time. A Greek editor typed 09:30,
 * saw 06:30 on reload, and a second save moved the publish time again.
 *
 * Now the form holds the UTC instant, converts it to local time only to fill
 * the box, and converts what is typed back to UTC in the browser, where the
 * editor's zone is known. The wire carries nothing but UTC.
 *
 * Plain functions with no browser-only APIs, so the server page can use
 * `toWireDateTime` and tests can pin a zone with `TZ`.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** A full UTC instant (`…Z`) for the form, or null. */
export function toWireDateTime(date: Date | null): string | null {
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/** A stored instant as `YYYY-MM-DDTHH:mm` on this machine's clock; `''` if none. */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** What was typed in a `datetime-local` box, as a UTC instant; `''` if unreadable. */
export function localInputToIso(local: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
  if (!m) return '';
  const [, y, mo, d, h, mi] = m.map(Number);
  // The component constructor reads its arguments as LOCAL time — the point.
  const date = new Date(y, mo - 1, d, h, mi);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

/** The zone the box is read in, for the field's description (e.g. "Europe/Athens"). */
export function localTimeZoneName(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

/**
 * The generic `date` field with `withTime`, in the editor's time zone.
 *
 * It is the same `datetime-local` box as "Publish at", and it had the bug that
 * one was fixed for: the typed value went to the server as a zone-less string,
 * so "09:30" meant whatever the server's clock made of it, and read back as
 * something else. It now takes the same conversion both ways — the stored value
 * is a UTC instant, the box shows local time.
 *
 * A bare calendar date (`withTime` off) has no zone to get wrong and is passed
 * through untouched. A value saved before this fix (`2026-10-01T09:30`, no
 * zone) still displays as typed: `Date` reads a zone-less date-time as local.
 */
export function dateFieldToInput(value: unknown, withTime: boolean | undefined): string {
  if (typeof value !== 'string') return '';
  return withTime ? isoToLocalInput(value) : value;
}

/** What the box emitted, as the value to store; `undefined` clears the field. */
export function dateFieldFromInput(raw: string, withTime: boolean | undefined): string | undefined {
  if (!raw) return undefined;
  return withTime ? localInputToIso(raw) || undefined : raw;
}
