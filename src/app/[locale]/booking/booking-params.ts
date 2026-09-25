/**
 * Typed reader for the booking listing's search params.
 *
 * Filter state lives in the URL rather than in component state, so a filtered
 * view can be linked and survives a refresh. The legacy site re-rendered its
 * whole listing over AJAX and could do neither.
 *
 * Every value is validated here, once, so no page has to defend against a
 * hand-edited query string.
 */
import type { BookingSort } from '@/cms/modules/booking';

export const BOOKING_SORTS = ['title-asc', 'title-desc', 'price-asc', 'price-desc'] as const;

export const BOOKING_PAGE_SIZE = 15;

export interface ParsedBookingParams {
  q: string;
  sort: BookingSort;
  page: number;
  categories: string[];
  types: string[];
  departures: string[];
}

export type RawSearchParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

/**
 * A comma-separated slug list, e.g. `?type=yacht,catamaran`.
 *
 * Capped and de-duplicated: these become filter predicates, and an unbounded
 * list from the query string is an unbounded amount of work per request.
 */
function slugList(value: string | string[] | undefined, max = 20): string[] {
  const raw = Array.isArray(value) ? value.join(',') : (value ?? '');
  const slugs = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0 && s.length <= 191 && /^[a-z0-9-]+$/.test(s));
  return [...new Set(slugs)].slice(0, max);
}

export function parseBookingParams(params: RawSearchParams): ParsedBookingParams {
  const sortRaw = one(params.sort);
  const pageRaw = Number(one(params.page));

  return {
    q: one(params.q).slice(0, 100),
    sort: (BOOKING_SORTS as readonly string[]).includes(sortRaw) ? (sortRaw as BookingSort) : 'title-asc',
    page: Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1,
    categories: slugList(params.category),
    types: slugList(params.type),
    departures: slugList(params.departure),
  };
}

/** True when any filter is active — drives the "Clear" affordance. */
export function hasActiveFilters(parsed: ParsedBookingParams): boolean {
  return (
    parsed.q.length > 0 ||
    parsed.categories.length > 0 ||
    parsed.types.length > 0 ||
    parsed.departures.length > 0
  );
}
