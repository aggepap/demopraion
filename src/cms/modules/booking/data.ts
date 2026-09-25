/**
 * Reading a booking document's `data` — pure, dependency-free, testable.
 *
 * No DB import, no `server-only`, no `next/*`, for the same reason `pricing.ts`
 * and `availability.ts` have none: the listing page, the quote endpoint and the
 * unit tests all answer with the same functions, so a facet shown in a filter
 * and a facet matched by a query cannot disagree. `read.ts` does the I/O and
 * hands the plain JSON here.
 *
 * `options` are rows on the experience. A row's `autoId` uuid IS the stable id
 * the ledger keys on (`res:<id>`) — unique across every experience, identical in
 * every locale because that repeater is `shared`.
 *
 * The trade, stated once: two experiences listing the same physical yacht hold
 * two rows, two ids and two calendars, so it can be booked twice on one date.
 * That is the deliberate cost of letting an editor publish an experience from a
 * single screen; see `collection.ts`.
 *
 * Vessel types and departure locations do NOT make that trade. They were rows
 * for a while and are documents again, because a filter term has to be renamed
 * once and propagate. So this file only ever sees their ids; the labels come
 * from the term documents `read.ts` loads.
 */
import { BOOKING_KIND_VALUES, type BookingKind } from './collection';
import type { ResourcePricing } from './pricing';

export const DEFAULT_PATH_PREFIX = '/booking';

export type Localized = string | Record<string, string> | undefined;

/** Resolve a (possibly localized) label to a display string for `locale`. */
export function resolveLoc(v: Localized, locale: string): string {
  if (typeof v === 'string') return v.trim();
  if (v && typeof v === 'object') {
    const pick = (l: string) => (typeof v[l] === 'string' && v[l].trim() ? v[l] : undefined);
    const any = Object.values(v).find((x) => typeof x === 'string' && x.trim());
    return (pick(locale) || any || '').trim();
  }
  return '';
}

export function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * The `kind` of an experience.
 *
 * Checked against the declared list rather than tested for one value. The
 * shorter `data.kind === 'stay' ? 'stay' : 'transport'` worked for exactly two
 * kinds and would fail SILENTLY at three: a third kind would land in the
 * `transport` branch, be priced by the wrong engine, and answer 200 with a
 * wrong number. TypeScript cannot catch that — returning a narrower union than
 * `BookingKind` still typechecks — so it is checked here instead.
 *
 * An unrecognised or absent value is `transport`, which is what every
 * experience authored before the field existed is.
 */
export function readBookingKind(data: Record<string, unknown>): BookingKind {
  const raw = data.kind;
  return typeof raw === 'string' && (BOOKING_KIND_VALUES as readonly string[]).includes(raw)
    ? (raw as BookingKind)
    : 'transport';
}

/**
 * How many bookings the experience itself takes on one date.
 *
 * Absent, zero or nonsense means "not stated", and that is exactly what the
 * site-wide default exists for — an experience authored before the field
 * existed must keep behaving as it always did.
 *
 * Every path that claims a date reads its ceiling through here, because a
 * ceiling that is read one way when the booking is made and another way when an
 * operator accepts it is not a ceiling.
 */
export function readItemCapacity(data: Record<string, unknown>, defaultCapacity: number): number {
  const raw = Number(data.capacityPerDay);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : defaultCapacity;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Options                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

/** One `options` row, resolved for display and for the availability ledger. */
export interface ResourceRef {
  /** The row's `autoId` uuid. Stable across locales, unique across the site —
   *  the id the engine matches, and the `res:<id>` capacity key. */
  groupId: string;
  title: string;
  summary?: string;
  /** Separate bookings this option can take on one date. 1 = exclusive. */
  capacityPerDay: number;
  /** The most people it holds, or 0 when unstated. */
  seats: number;
  image?: string;
}

/**
 * The `options` rows of one experience, in author order.
 *
 * Rows with no `id` are dropped. An id-less row cannot be selected (the form
 * posts the id), cannot be priced (the engine matches on it) and cannot hold a
 * date (the ledger keys on it) — offering it would be offering something the
 * customer can never actually book.
 */
export function readOptions(data: Record<string, unknown>, locale: string): ResourceRef[] {
  const out: ResourceRef[] = [];
  for (const row of arr(data.options)) {
    const r = rec(row);
    const id = typeof r.id === 'string' ? r.id.trim() : '';
    if (!id) continue;

    const capacity = Number(r.capacityPerDay);
    const seats = Number(r.seats);
    out.push({
      groupId: id,
      title: resolveLoc(r.name as Localized, locale) || 'Option',
      summary: resolveLoc(r.summary as Localized, locale) || undefined,
      capacityPerDay: Number.isFinite(capacity) && capacity > 0 ? Math.floor(capacity) : 1,
      seats: Number.isFinite(seats) && seats > 0 ? Math.floor(seats) : 0,
      image: typeof r.image === 'string' && r.image ? r.image : undefined,
    });
  }
  return out;
}

/**
 * Turn the `options` rows into the price engine's shape.
 *
 * Two rows sharing an id keep it, which is what makes `validatePricingConfig`
 * report the duplicate rather than letting the first silently shadow the
 * second.
 */
export function toResourcePricing(data: Record<string, unknown>, locale: string): ResourcePricing[] {
  const out: ResourcePricing[] = [];
  for (const row of arr(data.options)) {
    const r = rec(row);
    const id = typeof r.id === 'string' ? r.id.trim() : '';
    if (!id) continue;

    out.push({
      id,
      label: resolveLoc(r.name as Localized, locale) || 'Option',
      cost: Number(r.cost) || 0,
      seats: Number(r.seats) || 0,
      seasonal: arr(r.seasonal).map((s) => {
        const rule = rec(s);
        return {
          id: typeof rule.id === 'string' ? rule.id : undefined,
          from: typeof rule.from === 'string' ? rule.from : '',
          to: typeof rule.to === 'string' ? rule.to : '',
          cost: Number(rule.cost) || 0,
          perPerson: rule.perPerson === true,
          brackets: arr(rule.brackets).map((b) => {
            const bracket = rec(b);
            return {
              min: Number(bracket.min) || 1,
              max: Number(bracket.max) || 1,
              cost: Number(bracket.cost) || 0,
            };
          }),
        };
      }),
    });
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Listing                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

export interface BookingSummary {
  id: number;
  slug: string;
  title: string;
  subtitle?: string;
  href: string;
  image?: string;
  kind: BookingKind;
  /** Major units; null when the item is priced on request. For a stay this is
   *  a nightly rate, which the card must label as such. */
  fromPrice: number | null;
  quickInfo: { icon?: string; label: string; value: string; suffix?: string }[];
  categoryIds: number[];
  /** Ids of the `vessel_type` / `departure_location` documents this experience
   *  is filed under. All three dimensions are relations, so all three resolve
   *  the same way. */
  typeIds: number[];
  departureIds: number[];
}

function relationIds(value: unknown): number[] {
  const raw = Array.isArray(value) ? value : value == null ? [] : [value];
  return raw.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0);
}

/**
 * The lowest price a listing card can honestly advertise — the nightly rate for
 * a stay, the day rate for transport.
 *
 * The base rate and every seasonal override are candidates. Options are too,
 * but only downwards: an option REPLACES the base rate, so an experience whose
 * cheapest room is 140 must not advertise "from 180" because that is the rate
 * of the room nobody asked about. Returns null when nothing is priced, which
 * the card renders as "on request" rather than as free.
 */
export function lowestPrice(data: Record<string, unknown>): number | null {
  const stay = readBookingKind(data) === 'stay';
  const candidates: number[] = [];

  const raw = stay ? data.nightlyRate : data.basePrice;
  const base = Number(raw);
  if (raw !== '' && raw != null && Number.isFinite(base) && base > 0) candidates.push(base);

  const seasons = stay ? arr(data.seasonalRates) : arr(data.seasonalPrices);
  for (const row of seasons) {
    const price = Number(stay ? rec(row).rate : rec(row).price);
    if (Number.isFinite(price) && price > 0) candidates.push(price);
  }

  for (const row of arr(data.options)) {
    const cost = Number(rec(row).cost);
    if (Number.isFinite(cost) && cost > 0) candidates.push(cost);
    for (const season of arr(rec(row).seasonal)) {
      const seasonal = Number(rec(season).cost);
      if (Number.isFinite(seasonal) && seasonal > 0) candidates.push(seasonal);
    }
  }

  return candidates.length ? Math.min(...candidates) : null;
}

/**
 * The price an experience's JSON-LD `Offer` advertises, or null for none.
 *
 * Transport keeps its base price. A stay has no base price at all — its price
 * is per night — so it used to publish no offer whatever it cost; it now
 * advertises its lowest nightly price, the same "from" figure its card shows.
 */
export function structuredOfferPrice(data: Record<string, unknown>, transportBasePrice: number | null): number | null {
  if (readBookingKind(data) === 'stay') return lowestPrice(data);
  return transportBasePrice;
}

export function toSummary(row: { id: number; slug: string; data: unknown }, locale: string): BookingSummary {
  const data = rec(row.data);
  const gallery = arr(data.gallery);
  const firstImage = gallery.length ? rec(gallery[0]).image : undefined;

  return {
    id: row.id,
    slug: row.slug,
    title: resolveLoc(data.title as Localized, locale) || row.slug,
    subtitle: resolveLoc(data.subtitle as Localized, locale) || undefined,
    href: `${DEFAULT_PATH_PREFIX}/${row.slug}`,
    image: typeof firstImage === 'string' ? firstImage : undefined,
    fromPrice: lowestPrice(data),
    quickInfo: arr(data.quickInfo).map((q) => {
      const item = rec(q);
      return {
        icon: typeof item.icon === 'string' ? item.icon : undefined,
        label: resolveLoc(item.label as Localized, locale),
        value: String(item.value ?? ''),
        suffix: resolveLoc(item.suffix as Localized, locale) || undefined,
      };
    }),
    kind: readBookingKind(data),
    categoryIds: relationIds(data.categories),
    // `relationIds` drops anything that is not a positive integer, so a document
    // still carrying the pre-migration `[{id,label,slug}]` rows degrades to no
    // facets rather than throwing. Its next SAVE is what will fail — a `many`
    // relation validates as `number[]` — which is why the migration has to run
    // in the same window as the deploy.
    typeIds: relationIds(data.types),
    departureIds: relationIds(data.departures),
  };
}

export interface TermSummary {
  slug: string;
  title: string;
  count: number;
}

/** A term document, resolved for display. The id is what the experiences point
 *  at; the slug is what the filter URL carries. */
export interface TermDoc {
  id: number;
  slug: string;
  title: string;
}

/**
 * Term documents of one dimension, with how many published items carry each.
 *
 * Counting happens here, over the items already loaded for the listing, rather
 * than as a `GROUP BY` — the published set for one locale is tens of rows and
 * is in memory regardless.
 *
 * Zero-count terms are KEPT. They used to be impossible: the vocabulary was
 * derived from the experiences, so a term nobody used did not exist. Now the
 * vocabulary is curated and a freshly created term legitimately has no users
 * yet. `BookingFilters` is what decides what to show, and it already drops
 * `count === 0` both per term and per whole dimension — so an unused term still
 * never reaches a visitor, and a stay-only site still shows no Vessel type
 * filter.
 */
export function countTermUsage(
  terms: TermDoc[],
  items: BookingSummary[],
  pick: (item: BookingSummary) => number[],
): TermSummary[] {
  const counts = new Map<number, number>();
  for (const item of items) {
    // One experience listing the same term twice counts once: the facet answers
    // "how many experiences", not "how many rows".
    for (const id of new Set(pick(item))) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return terms
    .map((t) => ({ slug: t.slug, title: t.title, count: counts.get(t.id) ?? 0 }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** The slug → id lookup a filter needs to resolve a URL onto term documents. */
export function termIdsBySlug(terms: TermDoc[]): Map<string, number> {
  return new Map(terms.map((t) => [t.slug, t.id]));
}

/** The three filter dimensions, each as slug → term-document id. */
export interface BookingTermIndex {
  categories: Map<string, number>;
  types: Map<string, number>;
  departures: Map<string, number>;
}

export type BookingSort = 'title-asc' | 'title-desc' | 'price-asc' | 'price-desc';

export interface BookingQuery {
  q?: string;
  sort?: BookingSort;
  categories?: string[];
  types?: string[];
  departures?: string[];
}

/**
 * Filter and sort in memory.
 *
 * The published set for one locale is small (tens of items) and already loaded
 * for the facet counts, so a second round of database work would buy nothing —
 * and faceting needs the whole set regardless.
 *
 * Items with no price sort last in both directions: "on request" is not
 * cheapest, and it is not most expensive either.
 */
export function applyBookingQuery(
  items: BookingSummary[],
  query: BookingQuery,
  terms: BookingTermIndex,
): BookingSummary[] {
  let out = items;

  if (query.q) {
    const needle = query.q.trim().toLowerCase();
    out = out.filter(
      (i) => i.title.toLowerCase().includes(needle) || (i.subtitle ?? '').toLowerCase().includes(needle),
    );
  }

  /**
   * All three dimensions are documents, so all three resolve the URL's slug to
   * a term id and match on that.
   *
   * An unknown slug is an EMPTY result, not an ignored filter: silently widening
   * the set would show the visitor things they explicitly excluded.
   */
  const byTerm = (
    slugs: string[] | undefined,
    index: Map<string, number>,
    pick: (i: BookingSummary) => number[],
  ) => {
    if (!slugs || slugs.length === 0) return;
    const ids = slugs.map((s) => index.get(s)).filter((n): n is number => typeof n === 'number');
    out = ids.length === 0 ? [] : out.filter((i) => pick(i).some((id) => ids.includes(id)));
  };

  byTerm(query.categories, terms.categories, (i) => i.categoryIds);
  byTerm(query.types, terms.types, (i) => i.typeIds);
  byTerm(query.departures, terms.departures, (i) => i.departureIds);

  const sorted = [...out];
  switch (query.sort) {
    case 'title-desc':
      sorted.sort((a, b) => b.title.localeCompare(a.title));
      break;
    case 'price-asc':
      sorted.sort((a, b) => (a.fromPrice ?? Infinity) - (b.fromPrice ?? Infinity));
      break;
    case 'price-desc':
      sorted.sort((a, b) => (b.fromPrice ?? -Infinity) - (a.fromPrice ?? -Infinity));
      break;
    default:
      sorted.sort((a, b) => a.title.localeCompare(b.title));
  }
  return sorted;
}
