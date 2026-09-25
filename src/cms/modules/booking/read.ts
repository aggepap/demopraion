/**
 * Booking read helpers — the I/O half.
 *
 * Everything that merely interprets a `documents.data` blob lives in `data.ts`,
 * which is pure and unit-tested. What is left here is what genuinely needs a
 * database: fetching the document, the currency setting, the published list,
 * and the term documents behind the three filter dimensions.
 *
 * The pure half is re-exported so callers keep importing booking read helpers
 * from one place.
 */
import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';

import {
  BOOKING_CURRENCY_KEY,
  DEFAULT_CURRENCY,
  ECOMMERCE_CURRENCY_KEY,
  getPublishedDocument,
  getSetting,
} from '../../core';
import { getDb, schema } from '../../db';
import type { DocumentRow } from '../../db/adapters/mysql/schema/documents';
import { DEFAULT_BOOKING_TYPE, type BookingKind } from './collection';
import {
  readBookingKind,
  readItemCapacity,
  readOptions,
  rec,
  resolveLoc,
  toResourcePricing,
  toSummary,
  type BookingSummary,
  type Localized,
  type ResourceRef,
  type TermDoc,
} from './data';
import { readPricingConfig, type BookingPricing } from './pricing';
import { readStayConfig, type StayPricing } from './stay';

export * from './data';

type Db = ReturnType<typeof getDb>;
/** The pool, or a transaction to run inside — same query surface either way. */
type Executor = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * The booking currency, from Settings → Booking.
 *
 * Deliberately its own key rather than reusing `ecommerce.currency`: booking has
 * to work with commerce switched off. It falls back to the commerce currency
 * when unset, so a site that already configured one does not have to say it
 * twice, and then to `DEFAULT_CURRENCY`.
 */
export async function getBookingCurrency(): Promise<string> {
  const own = await getSetting(BOOKING_CURRENCY_KEY);
  if (typeof own === 'string' && own.trim()) return own.trim().toUpperCase();
  const commerce = await getSetting(ECOMMERCE_CURRENCY_KEY);
  if (typeof commerce === 'string' && commerce.trim()) return commerce.trim().toUpperCase();
  return DEFAULT_CURRENCY;
}

/** One published bookable item by slug (full `data`), or null. */
export function getBooking(
  slug: string,
  locale: string,
  opts: { type?: string } = {},
): Promise<DocumentRow | null> {
  return getPublishedDocument(opts.type ?? DEFAULT_BOOKING_TYPE, slug, locale);
}

/** Every published bookable item in a locale, as listing cards. */
export async function listBookings(locale: string, opts: { type?: string } = {}): Promise<BookingSummary[]> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.documents.id, slug: schema.documents.slug, data: schema.documents.data })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.type, opts.type ?? DEFAULT_BOOKING_TYPE),
        eq(schema.documents.status, 'published'),
        eq(schema.documents.locale, locale),
      ),
    );
  return rows.map((r) => toSummary(r, locale));
}

/**
 * The published term documents of one or more taxonomies, keyed by type.
 *
 * All three filter dimensions — service categories, vessel types, departure
 * locations — are documents, and the listing page needs all of them at once, so
 * this takes a LIST of types and fetches them in one round trip rather than one
 * query per dimension.
 *
 * Counting is left to `countTermUsage` (pure, in `data.ts`), which also sorts —
 * so a term with no published items comes back from here regardless, and
 * `BookingFilters` is what decides whether to render it.
 *
 * NOTE: neither this nor `listBookings` is wrapped in `unstable_cache`, and the
 * listing route is `force-dynamic`, so renaming a term surfaces on the next
 * request. If either is ever cached, its tag set must include the term types —
 * otherwise a rename would be invisible until the booking type was revalidated.
 */
export async function listBookingTermDocs(types: string[], locale: string): Promise<Map<string, TermDoc[]>> {
  const out = new Map<string, TermDoc[]>();
  for (const type of types) out.set(type, []);
  if (types.length === 0) return out;

  const db = getDb();
  const rows = await db
    .select({
      id: schema.documents.id,
      type: schema.documents.type,
      slug: schema.documents.slug,
      data: schema.documents.data,
    })
    .from(schema.documents)
    .where(and(inArray(schema.documents.type, types), eq(schema.documents.status, 'published')));

  // A term is a single canonical document with a localized title, but the guard
  // stays: were a site ever to author one row per locale, the first would win
  // rather than the slug appearing twice in the filter.
  const seen = new Map<string, Set<string>>();
  for (const row of rows) {
    const list = out.get(row.type);
    if (!list) continue;
    const slugs = seen.get(row.type) ?? seen.set(row.type, new Set()).get(row.type)!;
    if (slugs.has(row.slug)) continue;
    slugs.add(row.slug);
    list.push({
      id: row.id,
      slug: row.slug,
      title: resolveLoc(rec(row.data).title as Localized, locale) || row.slug,
    });
  }
  return out;
}

/**
 * The two capacities a stored reservation must be re-checked against: the
 * experience's own, and the chosen option's.
 *
 * Needed on the operator-accept path, which works from a stored reservation
 * rather than from a resolved document. A `pending` enquiry holds nothing, so
 * the accept is where the date is first claimed — and the only chance to refuse
 * it. One document read serves both figures.
 *
 * `exec` is the caller's transaction, not the pool: this runs with a claim in
 * flight, and a read on a second connection inside an open transaction is both a
 * different snapshot and a pool-deadlock waiting for load to find it.
 *
 * The option falls back to 1: the safe direction, since an unknown capacity that
 * guessed high would oversell. The experience falls back to the site-wide
 * default, which is what an unstated `capacityPerDay` means everywhere else —
 * including on the create path this has to agree with.
 */
export async function readStoredCapacities(
  exec: Executor,
  bookingId: number | null,
  optionId: string | null,
  defaultCapacity: number,
): Promise<{ item: number; option: number }> {
  const unknown = { item: defaultCapacity, option: 1 };
  if (!bookingId) return unknown;

  const [row] = await exec
    .select({ data: schema.documents.data })
    .from(schema.documents)
    .where(eq(schema.documents.id, bookingId))
    .limit(1);
  if (!row) return unknown;

  const data = rec(row.data);
  const option = optionId ? readOptions(data, 'el').find((o) => o.groupId === optionId) : undefined;
  return { item: readItemCapacity(data, defaultCapacity), option: option?.capacityPerDay ?? 1 };
}

export interface ResolvedBooking {
  doc: DocumentRow;
  data: Record<string, unknown>;
  kind: BookingKind;
  /** The transport config. Meaningful when `kind === 'transport'`. */
  pricing: BookingPricing;
  /** The stay config. Meaningful when `kind === 'stay'`. */
  stay: StayPricing;
  /** What the public form offers and the quote accepts, keyed by row id. */
  resources: ResourceRef[];
}

/**
 * Everything the quote endpoint needs for one bookable item: the document, both
 * pricing configs, and the option list for the form. Null when the slug does
 * not resolve to a published item.
 *
 * Both configs are built regardless of `kind` — they are pure reads over a JSON
 * blob already in memory, and having them unconditionally means the one place
 * that decides which engine runs is the caller's `kind` check rather than a
 * possibly-null field every caller has to re-test.
 */
export async function resolveBookingPricing(
  slug: string,
  locale: string,
  opts: { type?: string; currency?: string } = {},
): Promise<ResolvedBooking | null> {
  const doc = await getBooking(slug, locale, { type: opts.type });
  if (!doc) return null;

  const data = rec(doc.data);
  const currency = opts.currency ?? (await getBookingCurrency());
  const options = toResourcePricing(data, locale);
  const pricing = readPricingConfig(data, options, { currency, locale });

  return {
    doc,
    data,
    kind: readBookingKind(data),
    pricing,
    stay: readStayConfig(data, options, pricing.extras, { currency, locale }),
    resources: readOptions(data, locale),
  };
}
