/**
 * The Reservations screen's filters, as they live in the URL.
 *
 * The list used to load the 100 newest bookings and filter those in the
 * browser, so the 101st could not be found by any filter. Now the page reads the
 * filters from the query string and the database does the filtering and the
 * paging. Keeping them in the URL (the Submissions screen's pattern) means a
 * reload or a shared link shows the same list.
 *
 * Pure — imported by the server page and by the client table alike.
 */
import type { ReservationStatus } from '../../db/adapters/mysql/schema/booking';
import { RESERVATION_STATUSES } from './lifecycle';

export const RESERVATIONS_PAGE_SIZE = 25;

export interface ReservationFilters {
  status: ReservationStatus | '';
  search: string;
  needsAction: boolean;
  /** The experience's translation-group id — the same across its languages. */
  experience: string;
  /** Booked date range, inclusive, `YYYY-MM-DD`. */
  from: string;
  to: string;
  page: number;
}

export const DEFAULT_RESERVATION_FILTERS: ReservationFilters = {
  status: '',
  search: '',
  needsAction: false,
  experience: '',
  from: '',
  to: '',
  page: 1,
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type ParamSource = URLSearchParams | Record<string, string | string[] | undefined>;

function first(source: ParamSource, key: string): string {
  const raw = source instanceof URLSearchParams ? source.get(key) : source[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' ? value.trim() : '';
}

/** Read the filters from a query string, dropping anything that is not valid. */
export function parseReservationFilters(source: ParamSource): ReservationFilters {
  const status = first(source, 'status');
  const from = first(source, 'from');
  const to = first(source, 'to');
  const page = Number(first(source, 'page'));
  return {
    status: (RESERVATION_STATUSES as readonly string[]).includes(status) ? (status as ReservationStatus) : '',
    search: first(source, 'search').slice(0, 191),
    needsAction: ['1', 'true'].includes(first(source, 'needsAction')),
    experience: first(source, 'experience').slice(0, 191),
    from: ISO_DATE.test(from) ? from : '',
    to: ISO_DATE.test(to) ? to : '',
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

/** The query string for a set of filters — defaults left out, so a clean list has a clean URL. */
export function reservationFiltersQuery(filters: ReservationFilters): string {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.search) params.set('search', filters.search);
  if (filters.needsAction) params.set('needsAction', '1');
  if (filters.experience) params.set('experience', filters.experience);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.page > 1) params.set('page', String(filters.page));
  return params.toString();
}

/** The filters as `listReservations` options. */
export function toListOptions(filters: ReservationFilters) {
  return {
    status: filters.status || undefined,
    search: filters.search || undefined,
    needsAction: filters.needsAction || undefined,
    bookingGroupId: filters.experience || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
    page: filters.page,
    pageSize: RESERVATIONS_PAGE_SIZE,
  };
}
