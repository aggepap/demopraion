/**
 * One way to price a selection, whichever engine the experience uses.
 *
 * Three places price a booking — the public quote, the request that stores the
 * reservation, and the admin's "the price has changed since" check — and each
 * used to pick the engine itself. The drift check only ever called the transport
 * engine, so every STAY reservation was re-priced as though it were a day trip.
 * Routing all three through this function is what keeps them agreeing, now that
 * the calendar's price overrides take part too.
 *
 * Pure: the caller reads the overrides from the database and hands them in.
 */
import { stayNights } from './availability';
import type { BookingKind } from './collection';
import { quoteBooking, type BookingPricing, type QuoteResult } from './pricing';
import { quoteStay, type StayPricing, type StayQuoteResult } from './stay';

/** A selection as the public form posts it and the reservation snapshot stores it. */
export interface SelectionInput {
  /** The day, or a stay's check-in. */
  date?: string | null;
  /** A stay's check-out. */
  endDate?: string | null;
  persons?: number;
  adults?: number;
  children?: number;
  resourceId?: string | null;
  extraIds?: string[];
}

/** Calendar price overrides by date, in minor units. */
export interface PriceOverrides {
  /** From the experience's own calendar. */
  base: Record<string, number>;
  /** From the chosen option's calendar. */
  option: Record<string, number>;
}

export const NO_OVERRIDES: PriceOverrides = { base: {}, option: {} };

export interface PricingEngines {
  kind: BookingKind;
  pricing: BookingPricing;
  stay: StayPricing;
}

/** The dates whose calendar overrides can affect this selection's price. */
export function overrideDatesFor(kind: BookingKind, sel: SelectionInput): string[] {
  if (!sel.date) return [];
  if (kind === 'stay') return sel.endDate ? stayNights(sel.date, sel.endDate) : [];
  return [sel.date];
}

/** Price a selection with the engine its experience calls for. */
export function quoteForSelection(
  engines: PricingEngines,
  sel: SelectionInput,
  overrides: PriceOverrides = NO_OVERRIDES,
): QuoteResult | StayQuoteResult {
  if (engines.kind === 'stay') {
    return quoteStay(engines.stay, {
      checkIn: sel.date,
      checkOut: sel.endDate,
      adults: sel.adults ?? sel.persons,
      children: sel.children,
      optionId: sel.resourceId,
      extraIds: sel.extraIds ?? [],
      nightOverrides: { nightly: overrides.base, option: overrides.option },
    });
  }
  const date = sel.date ?? undefined;
  return quoteBooking(engines.pricing, {
    date,
    persons: sel.persons,
    resourceId: sel.resourceId,
    extraIds: sel.extraIds ?? [],
    dateOverrides: date ? { base: overrides.base[date] ?? null, option: overrides.option[date] ?? null } : undefined,
  });
}
