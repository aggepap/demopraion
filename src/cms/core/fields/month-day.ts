/**
 * Yearless `mm-dd` ranges — parsing, wrap-around and overlap.
 *
 * These live in core rather than in the booking module because two callers that
 * must never disagree depend on them: the booking pricing engine, which picks
 * the season a date falls in, and the admin repeater, which tells an editor a
 * season overlaps before they can save it. A second copy of the wrap-around
 * rule would eventually drift from the first, and the symptom would be an
 * admin that accepts a config the pricing engine then refuses to quote.
 */

/** A pair of `mm-dd` bounds. `to` before `from` means the range wraps the new year. */
export interface MonthDayRange {
  from?: unknown;
  to?: unknown;
}

const MD_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * `'11-15'` → 1115, the sortable integer every range comparison runs on.
 * Null when the string is not a real `mm-dd`.
 *
 * February 29th must parse: a range with no year includes the 29th every year,
 * not only in leap years.
 */
export function monthDayToInt(md: unknown): number | null {
  if (typeof md !== 'string' || !MD_RE.test(md)) return null;
  const month = Number(md.slice(0, 2));
  const day = Number(md.slice(3, 5));
  if (month === 2 && day > 29) return null;
  if (day === 31 && [4, 6, 9, 11].includes(month)) return null;
  return month * 100 + day;
}

/**
 * A possibly-wrapping window as one or two non-wrapping `[start, end]` pairs.
 * `{ from: '11-01', to: '02-28' }` → `[[1101, 1231], [101, 228]]`.
 *
 * Every other range operation is built on this, so wrap-around is handled in
 * exactly one place instead of being re-derived (and re-broken) at each site.
 */
export function monthDaySegments(range: MonthDayRange): Array<[number, number]> {
  const s = monthDayToInt(range?.from);
  const e = monthDayToInt(range?.to);
  if (s == null || e == null) return [];
  return s <= e ? [[s, e]] : [[s, 1231], [101, e]];
}

/**
 * Do two windows share at least one calendar day? Wrap-safe.
 *
 * An incomplete or malformed range yields no segments and therefore overlaps
 * nothing: a half-filled row is unfinished, not in conflict, and flagging it
 * while the editor is still choosing the second date would be noise.
 */
export function monthDayRangesOverlap(a: MonthDayRange, b: MonthDayRange): boolean {
  const segsA = monthDaySegments(a);
  const segsB = monthDaySegments(b);
  if (!segsA.length || !segsB.length) return false;
  return segsA.some(([as, ae]) => segsB.some(([bs, be]) => as <= be && bs <= ae));
}

/**
 * For each row that collides with an earlier one: its index → the index of the
 * FIRST earlier row it clashes with.
 *
 * The later row is the one reported because it is the one that just changed;
 * flagging both ends of every pair would light up a whole list from one bad
 * edit. Kept pure and out of the component so the pairing rule is unit-testable
 * without a form.
 */
export function overlappingRangeRows(
  rows: readonly Record<string, unknown>[],
  rule: { from: string; to: string },
): Map<number, number> {
  const clashes = new Map<number, number>();
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      if (clashes.has(j)) continue;
      const a = { from: rows[i]?.[rule.from], to: rows[i]?.[rule.to] };
      const b = { from: rows[j]?.[rule.from], to: rows[j]?.[rule.to] };
      if (monthDayRangesOverlap(a, b)) clashes.set(j, i);
    }
  }
  return clashes;
}
