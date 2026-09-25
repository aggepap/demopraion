/**
 * Stay price engine — pure, dependency-free, and the single authority for
 * anything booked by the night.
 *
 * Same contract as `pricing.ts`, deliberately: no DB import, no `server-only`,
 * no `next/*`, so the quote endpoint, the admin recompute and the unit tests all
 * call the same function and a price shown to a guest cannot disagree with the
 * price stored on their reservation.
 *
 * It returns the SAME `Quote` shape the transport engine returns. That is the
 * load-bearing decision in this file: `reservation_items`, the price-breakdown
 * UI, the confirmation emails, the deposit maths and the refund path all
 * consume `lines` + `total` and none of them need to know which engine produced
 * them. A second, parallel money representation is exactly the drift this
 * codebase has been bitten by before.
 *
 * Prices are authored in MAJOR units (180.00) and computed in MINOR units
 * (integer cents), converted per component — `toMinor(rate) * nights`, never
 * `toMinor(rate * nights)` — so the breakdown lines always sum to the total.
 */
import { daysBetween, stayNights, weekdayOf } from './availability';
import { resolveLoc, type Localized } from './data';
import {
  clampInt,
  dateToMonthDay,
  findSeason,
  monthDayToInt,
  pluralize,
  seasonsOverlap,
  toMinor,
  type ExtrasConfig,
  type PricingIssue,
  type Quote,
  type QuoteLine,
  type ResourcePricing,
  type SeasonRange,
} from './pricing';

/** What a fee multiplies by. Mirrors `FEE_BASIS_VALUES` in the collection. */
export const FEE_BASIS = ['per_stay', 'per_night', 'per_person', 'per_person_per_night'] as const;
export type FeeBasis = (typeof FEE_BASIS)[number];

export interface StayFee {
  id: string;
  label: string;
  amount: number;
  basis: FeeBasis;
}

/** A nightly rate for a recurring yearly window, with an optional minimum stay
 *  that overrides the general one for arrivals inside it. */
export interface SeasonalRate extends SeasonRange {
  id?: string;
  rate: number;
  minNights?: number;
}

/** Everything a stay's price depends on, normalised, in major units. */
export interface StayPricing {
  nightlyRate: number | null;
  currency: string;
  seasonalRates: SeasonalRate[];
  minNights: number;
  /** 0 = no limit. */
  maxNights: number;
  baseOccupancy: number;
  /** 0 = derive from the chosen option's `seats`, or no limit. */
  maxOccupancy: number;
  extraGuestPerNight: number;
  childrenEnabled: boolean;
  childMaxAge: number;
  childPerNight: number;
  fees: StayFee[];
  options: ResourcePricing[];
  extras: ExtrasConfig;
  /** Charge each chosen extra once per night rather than once per booking. */
  extrasPerNight: boolean;
}

export interface StaySelection {
  /** `YYYY-MM-DD` in the site timezone. */
  checkIn?: string | null;
  checkOut?: string | null;
  adults?: number;
  children?: number;
  optionId?: string | null;
  extraIds?: string[];
  /**
   * The availability calendar's "Price override" per night (`YYYY-MM-DD` →
   * minor units). `nightly` comes from the experience's own calendar and
   * replaces its nightly rate; `option` comes from the chosen option's calendar
   * and replaces that option's price for the night.
   */
  nightOverrides?: { nightly?: Record<string, number>; option?: Record<string, number> };
}

export interface StayQuote extends Quote {
  nights: number;
  /** The dates actually occupied — check-in through the night before check-out.
   *  The allocation ledger writes one hold per entry. */
  nightDates: string[];
}

export type StayQuoteFailure =
  | { ok: false; reason: 'price_on_request' }
  | { ok: false; reason: 'invalid_config'; issues: PricingIssue[] }
  | { ok: false; reason: 'missing_dates' }
  | { ok: false; reason: 'invalid_range' }
  | { ok: false; reason: 'min_nights'; minNights: number }
  | { ok: false; reason: 'max_nights'; maxNights: number }
  | { ok: false; reason: 'over_occupancy'; maxOccupancy: number }
  | { ok: false; reason: 'unknown_resource' }
  | { ok: false; reason: 'unknown_extra' }
  | { ok: false; reason: 'extra_required' };

export type StayQuoteResult = StayQuote | StayQuoteFailure;

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function issue(path: string, code: string, message: string): PricingIssue {
  return { path, code, message };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Configuration validation                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Every invariant the field DSL cannot express. An empty array means the config
 * is coherent; anything else means `quoteStay` refuses rather than guessing.
 *
 * Refusing is the point, and it is the same rule the transport engine follows:
 * two rates covering one night is not a tie to be broken by row order, it is a
 * question the operator has not answered.
 */
export function validateStayConfig(cfg: StayPricing): PricingIssue[] {
  const issues: PricingIssue[] = [];

  cfg.seasonalRates.forEach((s, i) => {
    if (monthDayToInt(s.from) == null || monthDayToInt(s.to) == null) {
      issues.push(issue(`seasonalRates.${i}`, 'season_malformed', `Season ${i + 1} has an invalid date. Use mm-dd.`));
    }
  });
  for (let i = 0; i < cfg.seasonalRates.length; i += 1) {
    for (let j = i + 1; j < cfg.seasonalRates.length; j += 1) {
      if (seasonsOverlap(cfg.seasonalRates[i], cfg.seasonalRates[j])) {
        issues.push(
          issue(
            `seasonalRates.${j}`,
            'season_overlap',
            `Season ${j + 1} overlaps season ${i + 1}. Two rates for one night is ambiguous.`,
          ),
        );
      }
    }
  }

  if (cfg.minNights < 1) {
    issues.push(issue('minNights', 'nights_range', 'The minimum stay must be at least one night.'));
  }
  if (cfg.maxNights > 0 && cfg.maxNights < cfg.minNights) {
    issues.push(issue('maxNights', 'nights_range', 'The maximum stay is below the minimum.'));
  }

  if (cfg.baseOccupancy < 1) {
    issues.push(issue('baseOccupancy', 'occupancy_range', 'At least one guest must be included in the rate.'));
  }
  if (cfg.maxOccupancy > 0 && cfg.maxOccupancy < cfg.baseOccupancy) {
    issues.push(
      issue('maxOccupancy', 'occupancy_range', 'The maximum number of guests is below the number included in the rate.'),
    );
  }
  if (cfg.extraGuestPerNight > 0 && cfg.maxOccupancy > 0 && cfg.maxOccupancy === cfg.baseOccupancy) {
    issues.push(
      issue(
        'extraGuestPerNight',
        'extra_guest_unreachable',
        'An extra-guest charge is set, but the maximum equals the number included — no guest can ever be charged it.',
      ),
    );
  }
  if (cfg.childPerNight > 0 && !cfg.childrenEnabled) {
    issues.push(
      issue('childPerNight', 'child_rate_disabled', 'A child rate is set, but children are turned off. Clear it or turn them on.'),
    );
  }

  cfg.fees.forEach((fee, i) => {
    if (!(FEE_BASIS as readonly string[]).includes(fee.basis)) {
      issues.push(issue(`fees.${i}.basis`, 'fee_basis', `"${fee.label || `Fee ${i + 1}`}" does not say how it is charged.`));
    }
    if (fee.amount < 0) {
      issues.push(issue(`fees.${i}.amount`, 'fee_negative', `"${fee.label || `Fee ${i + 1}`}" is negative.`));
    }
  });

  const seenOptions = new Set<string>();
  cfg.options.forEach((o, oi) => {
    if (o.id && seenOptions.has(o.id)) {
      issues.push(issue(`options.${oi}`, 'resource_duplicate', 'This option is listed twice.'));
    }
    if (o.id) seenOptions.add(o.id);

    const rules = o.seasonal ?? [];
    for (let i = 0; i < rules.length; i += 1) {
      for (let j = i + 1; j < rules.length; j += 1) {
        if (seasonsOverlap(rules[i], rules[j])) {
          issues.push(
            issue(
              `options.${oi}.seasonal.${j}`,
              'resource_season_overlap',
              `"${o.label}" has two seasonal costs covering the same night.`,
            ),
          );
        }
      }
    }

    // Party-size brackets are a transport concept. Left behind on an experience
    // switched to a stay, they are dead configuration nobody can see is dead —
    // the same shape of bug as `persons_disabled_but_configured` next door.
    if (rules.some((r) => r.perPerson && (r.brackets ?? []).length > 0)) {
      issues.push(
        issue(
          `options.${oi}.seasonal`,
          'brackets_on_stay',
          `"${o.label}" still has party-size brackets from transport pricing. A stay prices by night — clear them.`,
        ),
      );
    }
  });

  if (cfg.extras.enabled) {
    const seenExtras = new Set<string>();
    cfg.extras.options.forEach((o, i) => {
      if (o.id && seenExtras.has(o.id)) {
        issues.push(issue(`extras.options.${i}`, 'extra_duplicate', 'This extra is listed twice.'));
      }
      if (o.id) seenExtras.add(o.id);
    });
    if (cfg.extras.mandatory && cfg.extras.options.length === 0) {
      issues.push(
        issue('extras.options', 'extra_required_empty', 'An extra is required, but none are configured to choose from.'),
      );
    }
  }

  return issues;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Reading a document into a config                                            */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Normalise a raw `documents.data` object into a `StayPricing`.
 *
 * Pure on purpose, and `options`/`extras` are passed in already resolved for the
 * same reason `readPricingConfig` takes its resources: the labels are localized
 * and only the read layer knows the locale.
 */
export function readStayConfig(
  data: Record<string, unknown>,
  options: ResourcePricing[],
  extras: ExtrasConfig,
  opts: { currency?: string; locale?: string } = {},
): StayPricing {
  const rawRate = data.nightlyRate;
  const nightlyRate = rawRate === '' || rawRate == null ? null : num(rawRate);

  return {
    nightlyRate,
    currency: opts.currency ?? 'EUR',
    seasonalRates: arr(data.seasonalRates).map((s) => {
      const row = rec(s);
      const min = Math.floor(num(row.minNights));
      return {
        id: str(row.id) || undefined,
        from: str(row.from),
        to: str(row.to),
        rate: num(row.rate),
        minNights: min > 0 ? min : undefined,
      };
    }),
    minNights: Math.max(1, Math.floor(num(data.minNights, 1))),
    maxNights: Math.max(0, Math.floor(num(data.maxNights))),
    baseOccupancy: Math.max(1, Math.floor(num(data.baseOccupancy, 2))),
    maxOccupancy: Math.max(0, Math.floor(num(data.maxOccupancy))),
    extraGuestPerNight: num(data.extraGuestPerNight),
    childrenEnabled: data.childrenEnabled === true,
    childMaxAge: Math.max(0, Math.floor(num(data.childMaxAge, 12))),
    childPerNight: num(data.childPerNight),
    fees: arr(data.fees).map((f, i) => {
      const row = rec(f);
      return {
        id: str(row.id) || `fee-${i}`,
        // A fee's name is `localized: true`, so it is stored as a
        // `{ locale: value }` map. Reading it as a plain string produced '' and
        // the breakdown fell back to the word "Fee" — a guest was charged 1400 €
        // by something that never said what it was.
        label: resolveLoc(row.label as Localized, opts.locale ?? ''),
        amount: num(row.amount),
        basis: (str(row.basis, 'per_stay') as FeeBasis),
      };
    }),
    options,
    extras,
    extrasPerNight: data.extrasPerNight === true,
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* The quote                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

/** One night's calendar override in major units, or null when there is none. */
function overrideFor(map: Record<string, number> | undefined, date: string): number | null {
  const minor = map?.[date];
  return minor != null && Number.isFinite(minor) && minor >= 0 ? minor / 100 : null;
}

/** The nightly rate in force on one date, in major units. */
function rateForNight(
  cfg: StayPricing,
  option: ResourcePricing | undefined,
  date: string,
  overrides: StaySelection['nightOverrides'],
): number {
  const dateInt = dateToMonthDay(date);

  if (option) {
    // The option's own calendar exception for this night beats its rules.
    const optionOverride = overrideFor(overrides?.option, date);
    if (optionOverride != null && optionOverride > 0) return optionOverride;

    // An option REPLACES the experience's rate, exactly as a resource replaces
    // the base price in the transport engine — and its own seasons replace its
    // own flat cost.
    let cost = num(option.cost);
    if (dateInt != null) {
      const ri = findSeason(option.seasonal, dateInt);
      if (ri >= 0) {
        const seasonal = num((option.seasonal ?? [])[ri].cost);
        if (seasonal > 0) cost = seasonal;
      }
    }
    if (cost > 0) return cost;
  }

  // The experience's exception for this night beats its seasons and its rate.
  const nightlyOverride = overrideFor(overrides?.nightly, date);
  if (nightlyOverride != null) return nightlyOverride;

  if (dateInt != null) {
    const si = findSeason(cfg.seasonalRates, dateInt);
    if (si >= 0) return num(cfg.seasonalRates[si].rate);
  }
  return num(cfg.nightlyRate);
}

/**
 * The minimum stay that applies to an arrival, in nights.
 *
 * Taken from the ARRIVAL date's season, not from every night the stay touches.
 * A booking that starts in the low season keeps the low season's minimum even
 * if it runs on into August: that is what a guest is quoted when they ask, and
 * a rule that changed depending on how long they stayed would be unexplainable.
 */
export function minNightsFor(cfg: StayPricing, checkIn: string): number {
  const dateInt = dateToMonthDay(checkIn);
  if (dateInt != null) {
    const si = findSeason(cfg.seasonalRates, dateInt);
    const seasonal = si >= 0 ? cfg.seasonalRates[si].minNights : undefined;
    if (seasonal && seasonal > 0) return Math.max(cfg.minNights, seasonal);
  }
  return cfg.minNights;
}

/** The most guests allowed: the experience's own limit, else the chosen
 *  option's `seats`, else no limit at all. */
export function maxOccupancyFor(cfg: StayPricing, option: ResourcePricing | undefined): number {
  if (cfg.maxOccupancy > 0) return cfg.maxOccupancy;
  const seats = Math.floor(num(option?.seats));
  return seats > 0 ? seats : 0;
}

/**
 * THE algorithm for a stay. Deterministic, no I/O.
 *
 * The part worth stating once: consecutive nights sharing a rate collapse into
 * ONE line. A seven-night August stay is "7 × 260", not seven identical rows,
 * and a stay straddling a season boundary is two lines that visibly explain why
 * the total is what it is. That is the whole reason the guest is shown a
 * breakdown at all.
 */
export function quoteStay(cfg: StayPricing, sel: StaySelection): StayQuoteResult {
  if (!sel.checkIn || !sel.checkOut) return { ok: false, reason: 'missing_dates' };

  const nightDates = stayNights(sel.checkIn, sel.checkOut);
  if (nightDates.length === 0) return { ok: false, reason: 'invalid_range' };
  const nights = nightDates.length;

  const issues = validateStayConfig(cfg);
  if (issues.length) return { ok: false, reason: 'invalid_config', issues };

  const minNights = minNightsFor(cfg, sel.checkIn);
  if (nights < minNights) return { ok: false, reason: 'min_nights', minNights };
  if (cfg.maxNights > 0 && nights > cfg.maxNights) {
    return { ok: false, reason: 'max_nights', maxNights: cfg.maxNights };
  }

  // ── Which unit ──
  let option: ResourcePricing | undefined;
  if (sel.optionId) {
    option = cfg.options.find((o) => o.id === sel.optionId);
    if (!option) return { ok: false, reason: 'unknown_resource' };
  }

  // ── Occupancy ──
  const adults = clampInt(sel.adults ?? cfg.baseOccupancy, 1, 99);
  const children = cfg.childrenEnabled ? clampInt(sel.children ?? 0, 0, 99) : 0;
  const guests = adults + children;
  const maxOccupancy = maxOccupancyFor(cfg, option);
  // Refused rather than clamped: silently dropping a guest from a party of six
  // would quote a price for a booking nobody asked for, and they would only
  // find out on arrival.
  if (maxOccupancy > 0 && guests > maxOccupancy) {
    return { ok: false, reason: 'over_occupancy', maxOccupancy };
  }

  if (cfg.nightlyRate == null && !option) return { ok: false, reason: 'price_on_request' };

  const lines: QuoteLine[] = [];
  let total = 0;

  // ── A. Nightly rate, collapsed into segments ──
  const label = option ? option.label : 'Accommodation';
  const code = option ? `resource:${option.id}` : 'nightly';
  const kind = option ? 'resource' : 'base';

  const firstNightRate = rateForNight(cfg, option, nightDates[0], sel.nightOverrides);
  let segmentStart = 0;
  let segmentRate = firstNightRate;
  const flush = (endExclusive: number) => {
    const count = endExclusive - segmentStart;
    if (count <= 0) return;
    const unit = toMinor(segmentRate);
    const amount = unit * count;
    total += amount;
    lines.push({
      kind,
      code,
      label: `${label} — ${pluralize(count, 'night', 'nights')}`,
      refId: option?.id,
      quantity: count,
      unitAmount: unit,
      amount,
    });
  };

  for (let i = 1; i < nightDates.length; i += 1) {
    const rate = rateForNight(cfg, option, nightDates[i], sel.nightOverrides);
    if (rate !== segmentRate) {
      flush(i);
      segmentStart = i;
      segmentRate = rate;
    }
  }
  flush(nights);

  if (total === 0) return { ok: false, reason: 'price_on_request' };
  // The arrival night's rate — the one figure a guest recognises as "the rate".
  // A stay crossing a season has no single rate, and the breakdown lines are
  // where that is spelled out.
  const unitAmount = toMinor(firstNightRate);

  // ── B. Guests above the included occupancy ──
  // Children are priced by their own rate and never count towards the included
  // adults, which is what the field descriptions promise the editor.
  const extraAdults = Math.max(0, adults - cfg.baseOccupancy);
  if (extraAdults > 0 && cfg.extraGuestPerNight > 0) {
    const unit = toMinor(cfg.extraGuestPerNight);
    const quantity = extraAdults * nights;
    const amount = unit * quantity;
    total += amount;
    lines.push({
      kind: 'person',
      code: 'extra_guests',
      label: `Additional guests (over ${cfg.baseOccupancy}) — ${pluralize(extraAdults, 'guest', 'guests')} × ${pluralize(nights, 'night', 'nights')}`,
      quantity,
      unitAmount: unit,
      amount,
    });
  }

  if (children > 0 && cfg.childPerNight > 0) {
    const unit = toMinor(cfg.childPerNight);
    const quantity = children * nights;
    const amount = unit * quantity;
    total += amount;
    lines.push({
      kind: 'person',
      code: 'children',
      label: `Children (under ${cfg.childMaxAge}) — ${pluralize(children, 'child', 'children')} × ${pluralize(nights, 'night', 'nights')}`,
      quantity,
      unitAmount: unit,
      amount,
    });
  }

  // ── C. Extras ──
  if (cfg.extras.enabled) {
    const chosen = sel.extraIds ?? [];
    if (cfg.extras.mandatory && chosen.length === 0) return { ok: false, reason: 'extra_required' };
    for (const id of chosen) {
      const opt = cfg.extras.options.find((o) => o.id === id);
      if (!opt) return { ok: false, reason: 'unknown_extra' };
      const each = toMinor(opt.price);
      const quantity = (cfg.extras.multiplyPerPerson ? guests : 1) * (cfg.extrasPerNight ? nights : 1);
      const amount = each * quantity;
      total += amount;
      // "(per guest, per night)" said how it was charged but not how many of
      // each, so the line's own amount could not be checked against it. The
      // counts are the multiplier the breakdown renders the unit price against.
      const suffix = [
        cfg.extras.multiplyPerPerson ? pluralize(guests, 'guest', 'guests') : '',
        cfg.extrasPerNight ? pluralize(nights, 'night', 'nights') : '',
      ]
        .filter(Boolean)
        .join(' × ');
      lines.push({
        kind: 'extra',
        code: `extra:${opt.id}`,
        label: suffix ? `${opt.name} — ${suffix}` : opt.name,
        refId: opt.id,
        quantity,
        unitAmount: each,
        amount,
      });
    }
  }

  // ── D. Fees and taxes ──
  for (const fee of cfg.fees) {
    if (fee.amount <= 0) continue;
    const quantity =
      fee.basis === 'per_night'
        ? nights
        : fee.basis === 'per_person'
          ? guests
          : fee.basis === 'per_person_per_night'
            ? guests * nights
            : 1;
    const unit = toMinor(fee.amount);
    const amount = unit * quantity;
    total += amount;
    // What the fee multiplies by, spelled out. "Fee × 7" left a guest guessing
    // whether the 7 was nights, guests or something else — and an unnamed fee
    // charging 1400 € reads as a mistake even when it is not.
    const basisDetail =
      fee.basis === 'per_night'
        ? pluralize(nights, 'night', 'nights')
        : fee.basis === 'per_person'
          ? pluralize(guests, 'guest', 'guests')
          : fee.basis === 'per_person_per_night'
            ? `${pluralize(guests, 'guest', 'guests')} × ${pluralize(nights, 'night', 'nights')}`
            : '';
    const name = fee.label || 'Fee';
    lines.push({
      kind: 'surcharge',
      code: `fee:${fee.id}`,
      label: basisDetail ? `${name} — ${basisDetail}` : name,
      refId: fee.id,
      quantity,
      unitAmount: unit,
      amount,
    });
  }

  return {
    ok: true,
    currency: cfg.currency,
    persons: guests,
    unitAmount,
    lines,
    subtotal: total,
    total,
    nights,
    nightDates,
    applied: {
      seasonalIndex: null,
      resourceRuleIndex: null,
      bracketIndex: null,
      tierPersons: null,
      groupOverride: false,
    },
  };
}

/** Whole nights between two ISO dates. Re-exported so callers doing arithmetic
 *  on a stay do not each reimplement it. */
export { daysBetween, stayNights, weekdayOf };
