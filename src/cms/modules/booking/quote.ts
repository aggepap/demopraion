/**
 * The quote endpoint — the server's price, and the only one that counts.
 *
 * The public booking form calls this on every change and renders whatever comes
 * back; it never computes a price itself. The eventual request submit re-prices
 * through the same `quoteBooking`, so what a customer is shown and what gets
 * stored cannot disagree.
 *
 * There is also an admin-side validator, so an editor sees a broken pricing
 * config while they are editing it rather than as a mysterious "price on
 * request" on the live site.
 */
import 'server-only';

import { and, inArray, isNotNull } from 'drizzle-orm';
import { z } from 'zod';

import { PERMISSIONS, requireApiPerm } from '../auth';
import { createRoute, notFound, ok } from '../../core';
import { localeOrDefault } from '../../core/paths';
import { getDb, schema } from '../../db';
import { getDayStates } from './allocation';
import {
  bookingSlotKey,
  combinedDayStatus,
  eachDate,
  readAllocationMode,
  readDayRules,
  readStayRules,
  remainingSeats,
  resourceSlotKey,
  slotRequestsForKind,
} from './availability';
import {
  getBookingCurrency,
  readItemCapacity,
  resolveBookingPricing,
  toResourcePricing,
  type ResolvedBooking,
} from './read';
import { readPricingConfig, validatePricingConfig, type QuoteResult } from './pricing';
import {
  NO_OVERRIDES,
  overrideDatesFor,
  quoteForSelection,
  type PriceOverrides,
  type SelectionInput,
} from './quote-selection';
import {
  maxOccupancyFor,
  readStayConfig,
  validateStayConfig,
  type StayQuoteResult,
} from './stay';
import type { BookingKind } from './collection';
import { getBookingTimezone, getDefaultCapacity, getDefaultLeadTimeHours } from './settings-read';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** What each booking route binder supplies: the site's default locale (`config.defaultLocale`). */
interface SiteLocaleOptions {
  defaultLocale: string;
}

const quoteBody = z.object({
  slug: z.string().trim().min(1).max(191),
  /** Missing → the site's default locale, resolved by the route. */
  locale: z.string().trim().max(8).optional(),
  /** The booked day, or a stay's CHECK-IN date. */
  date: z.string().trim().regex(ISO_DATE).optional(),
  /** Check-out. A transport payload simply omits it. */
  endDate: z.string().trim().regex(ISO_DATE).optional(),
  persons: z.coerce.number().int().min(1).max(999).optional(),
  adults: z.coerce.number().int().min(1).max(99).optional(),
  children: z.coerce.number().int().min(0).max(99).optional(),
  resourceId: z.string().trim().max(64).optional(),
  extraIds: z.array(z.string().trim().max(64)).max(50).default([]),
});

/** A quote request with its locale already resolved — never empty here. */
export type QuoteBody = Omit<z.infer<typeof quoteBody>, 'locale'> & { locale: string };

export interface PublicQuote {
  quote: QuoteResult | StayQuoteResult;
  currency: string;
  kind: BookingKind;
  /** Nights, for a stay. 0 for transport. */
  nights: number;
  resources: { id: string; title: string }[];
}

/**
 * The availability calendar's price overrides that apply to one selection.
 *
 * Read from `booking_slots` — the experience's own calendar for the base price
 * or nightly rate, and the chosen option's calendar for the option's price. One
 * query, bounded by the selection's own dates.
 */
export async function loadPriceOverrides(resolved: ResolvedBooking, sel: SelectionInput): Promise<PriceOverrides> {
  const dates = overrideDatesFor(resolved.kind, sel);
  if (dates.length === 0) return NO_OVERRIDES;

  const baseKey = bookingSlotKey(resolved.doc.translationGroupId ?? `doc:${resolved.doc.id}`);
  const optionKey = sel.resourceId ? resourceSlotKey(sel.resourceId) : null;
  const rows = await getDb()
    .select({
      slotKey: schema.bookingSlots.slotKey,
      slotDate: schema.bookingSlots.slotDate,
      priceOverride: schema.bookingSlots.priceOverride,
    })
    .from(schema.bookingSlots)
    .where(
      and(
        inArray(schema.bookingSlots.slotKey, optionKey ? [baseKey, optionKey] : [baseKey]),
        inArray(schema.bookingSlots.slotDate, dates),
        isNotNull(schema.bookingSlots.priceOverride),
      ),
    );

  const out: PriceOverrides = { base: {}, option: {} };
  for (const row of rows) {
    if (row.priceOverride == null) continue;
    if (row.slotKey === baseKey) out.base[row.slotDate] = row.priceOverride;
    else if (row.slotKey === optionKey) out.option[row.slotDate] = row.priceOverride;
  }
  return out;
}

/** Price a selection against today's rules, calendar overrides included. */
export async function priceSelection(
  resolved: ResolvedBooking,
  sel: SelectionInput,
): Promise<QuoteResult | StayQuoteResult> {
  return quoteForSelection(resolved, sel, await loadPriceOverrides(resolved, sel));
}

/**
 * Price one selection with whichever engine the experience calls for. Returns
 * null when the slug is not a published item, so the caller can 404 rather than
 * leak which slugs exist.
 */
export async function quoteBySlug(input: QuoteBody): Promise<PublicQuote | null> {
  const resolved = await resolveBookingPricing(input.slug, input.locale);
  if (!resolved) return null;

  const quote = await priceSelection(resolved, input);

  return {
    quote,
    currency: resolved.kind === 'stay' ? resolved.stay.currency : resolved.pricing.currency,
    kind: resolved.kind,
    nights: quote.ok && 'nights' in quote ? Number(quote.nights) : 0,
    resources: resolved.resources.map((r) => ({ id: r.groupId, title: r.title })),
  };
}

/**
 * Strip an operator-facing failure down to what a customer may see.
 *
 * `invalid_config` carries the exact rules that are broken — overlapping season
 * ranges, bracket gaps, the numbers involved. That is the operator's commercial
 * configuration and none of a visitor's business, so the reason survives and the
 * issues do not. They still reach the admin, through `validate-pricing`.
 */
function publicQuote(result: QuoteResult | StayQuoteResult): QuoteResult | StayQuoteResult {
  if (result.ok || result.reason !== 'invalid_config') return result;
  return { ok: false, reason: 'invalid_config', issues: [] };
}

/** Public price preview. Mounted at `POST /api/cms/booking/quote`. */
export function bookingQuoteRoute(opts: SiteLocaleOptions) {
  return createRoute({
    rateLimit: { scope: 'booking-quote', max: 60, windowMs: 60_000 },
    input: quoteBody,
    handler: async ({ input }) => {
      const locale = localeOrDefault(input.locale, opts.defaultLocale);
      const result = await quoteBySlug({ ...input, locale });
      if (!result) throw notFound('That experience is no longer available.');
      if (!result.quote.ok && result.quote.reason === 'invalid_config') {
        // Loud on the server: a live item that cannot be priced is an incident,
        // not a quiet 200 the operator will never hear about.
        console.error('[booking/quote] unpriceable configuration', {
          slug: input.slug,
          locale,
        });
      }
      return ok({ ...result, quote: publicQuote(result.quote) });
    },
  });
}

const availabilityQuery = z.object({
  slug: z.string().trim().min(1).max(191),
  /** Missing → the site's default locale, resolved by the route. */
  locale: z.string().trim().max(8).optional(),
  from: z.string().trim().regex(ISO_DATE),
  to: z.string().trim().regex(ISO_DATE),
  persons: z.coerce.number().int().min(1).max(999).optional(),
  /** Which option's calendar to read. Without it, the experience's own. */
  resourceId: z.string().trim().max(64).optional(),
});

/**
 * `GET /api/cms/booking/availability` — the calendar behind the date picker.
 *
 * Every closed day carries a machine-readable `reason`, so the form can say WHY
 * rather than just greying the date out. A date consumed by an accepted booking
 * reads `full` even to a new enquiry — asking for a date that is genuinely gone
 * helps nobody — while a date carrying only pending enquiries stays open, and
 * reports how many others are waiting on it.
 */
export function bookingAvailabilityRoute(opts: SiteLocaleOptions) {
  return createRoute({
    rateLimit: { scope: 'booking-availability', max: 60, windowMs: 60_000 },
    query: availabilityQuery,
    handler: async ({ query }) => {
      const resolved = await resolveBookingPricing(query.slug, localeOrDefault(query.locale, opts.defaultLocale));
      if (!resolved) throw notFound('That experience is no longer available.');

      const { doc, data } = resolved;
      const [timeZone, defaultCapacity, defaultLead] = await Promise.all([
        getBookingTimezone(),
        getDefaultCapacity(),
        getDefaultLeadTimeHours(),
      ]);

      // 92 days: three months of calendar is the most any picker shows at once,
      // and it bounds what a crafted range can ask the database for.
      const dates = eachDate(query.from, query.to, 92);
      const isStay = resolved.kind === 'stay';
      const capacity = readItemCapacity(data, defaultCapacity);
      const groupId = doc.translationGroupId ?? `doc:${doc.id}`;

      /*
       * Which ledger to read: exactly the slots a booking of this selection
       * would claim, through the same function `createReservation` allocates
       * with.
       *
       * A stay is held against the chosen unit, so asking about a specific
       * option reads THAT option's calendar — otherwise a hotel's whole
       * availability would collapse onto one shared slot. Transport depends on
       * the allocation mode: `shared` and `exclusive` hold only the experience's
       * slot even when an option is picked, so reading the option's slot there
       * showed a sold-out day as open; `resource` holds both, and the day is
       * open only when both have room.
       */
      const option = query.resourceId
        ? resolved.resources.find((r) => r.groupId === query.resourceId)
        : undefined;
      const requests = slotRequestsForKind({
        kind: resolved.kind,
        allocationMode: readAllocationMode(data, resolved.kind),
        bookingGroupId: groupId,
        resourceGroupId: option?.groupId ?? '',
        resourceCapacityPerDay: option?.capacityPerDay ?? 1,
        capacityPerDay: capacity,
        // A stay occupies one unit per night whatever the party size; transport
        // consumes a seat per person (one of one, in `exclusive` mode).
        persons: isStay ? 1 : (query.persons ?? 1),
      });
      const ledgers = await Promise.all(
        requests.map(async (request) => ({
          request,
          states: await getDayStates(request.slotKey, dates, request.defaultCapacity),
        })),
      );

      const rules = isStay
        ? readStayRules(data, { leadTimeHours: defaultLead })
        : readDayRules(data, { leadTimeHours: defaultLead });
      const now = new Date();

      const days = dates.map((date) => {
        const parts = ledgers.map(({ request, states }) => ({
          state: states.get(date) ?? {
            date,
            capacity: request.defaultCapacity,
            held: 0,
            confirmed: 0,
            closed: false,
          },
          seats: request.seats,
        }));
        const status = combinedDayStatus(parts, rules, now, timeZone);
        return {
          date,
          status,
          bookable: status === 'open',
          // The tightest of the slots the booking needs.
          remaining: Math.min(...parts.map((p) => remainingSeats(p.state))),
        };
      });

      const stayRules = isStay ? (rules as ReturnType<typeof readStayRules>) : null;

      return ok({
        days,
        kind: resolved.kind,
        rules: {
          minPersons: resolved.pricing.minPersons,
          maxPersons: resolved.pricing.maxPersons,
          hasPersons: resolved.pricing.hasPersons,
          leadTimeHours: rules.leadTimeHours,
          weekdays: rules.weekdays,
          // Everything the date picker needs to stop a guest choosing a range
          // the server will only refuse afterwards.
          minNights: stayRules?.minNights ?? null,
          maxNights: stayRules?.maxNights ?? null,
          checkInDays: stayRules?.checkInDays ?? null,
          checkOutDays: stayRules?.checkOutDays ?? null,
          baseOccupancy: isStay ? resolved.stay.baseOccupancy : null,
          maxOccupancy: isStay ? maxOccupancyFor(resolved.stay, option ? { id: option.groupId, label: option.title, cost: 0, seats: option.seats } : undefined) : null,
          childrenEnabled: isStay ? resolved.stay.childrenEnabled : false,
          childMaxAge: isStay ? resolved.stay.childMaxAge : null,
        },
      });
    },
  });
}

const validateBody = z.object({
  /** The document `data` as the editor currently has it — unsaved is the point. */
  data: z.record(z.string(), z.unknown()),
  /** Missing → the site's default locale, resolved by the route. */
  locale: z.string().trim().max(8).optional(),
});

/**
 * Admin-side config check. Mounted at `POST /api/cms/bookings/validate-pricing`.
 *
 * Advisory only — `quoteBooking` refuses a broken config regardless, so this
 * cannot be the sole guard. Its job is to tell an editor *while they are still
 * in the form* that two seasons overlap, instead of letting them find out from a
 * customer who was quoted the wrong price.
 */
export function bookingValidatePricingRoute(opts: SiteLocaleOptions) {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.contentWrite),
    input: validateBody,
    handler: async ({ input }) => {
      const data = input.data as Record<string, unknown>;
      const locale = localeOrDefault(input.locale, opts.defaultLocale);
      const currency = await getBookingCurrency();
      const options = toResourcePricing(data, locale);
      const config = readPricingConfig(data, options, { currency, locale });
      // Check the engine the experience actually uses. Running the transport
      // checks over a stay would report "per-person pricing is off but tiers
      // are configured" about fields the editor cannot even see.
      const issues =
        data.kind === 'stay'
          ? validateStayConfig(readStayConfig(data, options, config.extras, { currency, locale }))
          : validatePricingConfig(config);
      return ok({ issues });
    },
  });
}
