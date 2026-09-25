/**
 * Booking price engine — pure, dependency-free, and the single authority.
 *
 * No DB import, no `server-only`, no `next/*`: the quote endpoint, the admin
 * drawer's recompute and the unit tests all call the same functions, so a price
 * shown to a customer and a price stored on a reservation cannot disagree.
 *
 * Prices are authored in MAJOR units (450.00) and computed in MINOR units
 * (integer cents), converted per component — `toMinor(unit) * persons`, never
 * `toMinor(unit * persons)` — so the breakdown lines always sum to the total.
 *
 * Ported from a WooCommerce/Gravity Forms implementation, with its bugs fixed
 * rather than reproduced. Each fix is marked `WAS:` at the point it applies.
 */
import {
  monthDayRangesOverlap,
  monthDaySegments,
  monthDayToInt as parseMonthDay,
} from '../../core/fields/month-day';
import { resolveLoc, type Localized } from './data';


/** A date inside a recurring yearly season, as `mm-dd`. A season has no year. */
export type MonthDay = string;

export interface SeasonRange {
  from: MonthDay;
  to: MonthDay;
}

export interface SeasonalPrice extends SeasonRange {
  id?: string;
  price: number;
}

/** A person-count bracket whose cost is the TOTAL for a party that size. */
export interface PersonBracket {
  min: number;
  max: number;
  cost: number;
}

export interface ResourceSeasonalRule extends SeasonRange {
  id?: string;
  cost: number;
  perPerson?: boolean;
  brackets?: PersonBracket[];
}

/**
 * One `options` row. `id` is the row's own uuid — stable across locales, unique
 * across the site, and the key the availability ledger uses (`res:<id>`).
 */
export interface ResourcePricing {
  id: string;
  label: string;
  cost: number;
  /** The most guests it holds; 0 when unstated. Used by the stay engine as the
   *  occupancy ceiling when the experience sets none. */
  seats?: number;
  seasonal?: ResourceSeasonalRule[];
}

export interface ExtraOption {
  id: string;
  name: string;
  price: number;
}

export interface ExtrasConfig {
  enabled: boolean;
  title?: string;
  multiplyPerPerson: boolean;
  mandatory: boolean;
  options: ExtraOption[];
}

/**
 * One party-size band: "5 to 10 guests cost 1000, whoever they are".
 *
 * WAS: one row per exact head count (`{ persons, total }`), which meant a boat
 * taking 1–999 people needed 999 rows — and `validatePricingConfig` refused the
 * whole config until it had them, so the customer saw "price on request" with
 * nothing in the admin explaining why. A band is what an operator actually
 * quotes, and it is the shape Options' group brackets already use.
 */
export interface TieredRule {
  min: number;
  max: number;
  total: number;
}

export const PRICING_MODE_VALUES = ['multiply', 'group_threshold', 'tiered'] as const;
export type PricingMode = (typeof PRICING_MODE_VALUES)[number];

/** Everything a price depends on, normalised, in major units. */
export interface BookingPricing {
  basePrice: number | null;
  currency: string;
  hasPersons: boolean;
  minPersons: number;
  maxPersons: number;
  mode: PricingMode;
  includedPersons: number;
  extraPerPerson: number;
  tiers: TieredRule[];
  seasonalPrices: SeasonalPrice[];
  resources: ResourcePricing[];
  extras: ExtrasConfig;
}

export interface QuoteSelection {
  /** `YYYY-MM-DD` in the site timezone. */
  date?: string | null;
  persons?: number;
  resourceId?: string | null;
  extraIds?: string[];
  /**
   * The availability calendar's "Price override" for THIS date, in minor units.
   * `base` is the exception on the experience's own calendar and replaces the
   * base price (and any season); `option` is the exception on the chosen
   * option's calendar and replaces that option's price. Null or absent = none.
   */
  dateOverrides?: { base?: number | null; option?: number | null };
}

export type QuoteLineKind = 'base' | 'person' | 'resource' | 'extra' | 'surcharge' | 'discount';

export interface QuoteLine {
  kind: QuoteLineKind;
  /** Stable machine key, so a receipt can be re-labelled in any language. */
  code: string;
  label: string;
  refId?: string;
  quantity: number;
  /** Minor units. */
  unitAmount: number;
  /** Minor units. */
  amount: number;
}

/** Which rules fired — for the admin drawer, and for debugging a surprise. */
export interface QuoteApplied {
  seasonalIndex: number | null;
  resourceRuleIndex: number | null;
  bracketIndex: number | null;
  tierPersons: number | null;
  groupOverride: boolean;
}

export interface Quote {
  ok: true;
  currency: string;
  persons: number;
  /** Effective per-unit price after seasons and resources, in minor units. */
  unitAmount: number;
  lines: QuoteLine[];
  subtotal: number;
  total: number;
  applied: QuoteApplied;
}

export type QuoteFailure =
  | { ok: false; reason: 'price_on_request' }
  | { ok: false; reason: 'invalid_config'; issues: PricingIssue[] }
  | { ok: false; reason: 'unknown_resource' }
  | { ok: false; reason: 'unknown_extra' }
  | { ok: false; reason: 'extra_required' };

export type QuoteResult = Quote | QuoteFailure;

export interface PricingIssue {
  path: string;
  code: string;
  message: string;
}

/**
 * `3` + `night` → `3 nights`. Used to build breakdown labels.
 *
 * Every quantity a line multiplies by is spelled out in its own label, because
 * a breakdown row is the only place a guest can check the arithmetic: "Fee × 7"
 * says neither what the fee is nor what the 7 counts, while "Cleaning — 7
 * nights" next to the nightly amount adds up in front of them.
 */
export function pluralize(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Major units → integer minor units. */
export function toMinor(major: number): number {
  const n = Number(major);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * `'11-15'` → 1115, the sortable integer every season comparison runs on.
 * Null when the string is not a real `mm-dd`.
 *
 * Re-exported from core, which owns the `mm-dd` vocabulary now that the admin
 * checks season overlap live and has to agree with this engine exactly.
 */
export const monthDayToInt = parseMonthDay;

/** `'2026-11-15'` → 1115. Null when the string is not a real ISO date. */
export function dateToMonthDay(iso: unknown): number | null {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  return monthDayToInt(iso.slice(5));
}

/**
 * A possibly-wrapping window as one or two non-wrapping `[start, end]` pairs.
 * `{ from: '11-01', to: '02-28' }` → `[[1101, 1231], [101, 228]]`.
 *
 * Every other season operation is built on this, so wrap-around is handled in
 * exactly one place instead of being re-derived (and re-broken) at each site.
 */
export const seasonSegments = (range: SeasonRange): Array<[number, number]> =>
  monthDaySegments(range);

/** Does a `mm-dd` integer fall inside a (possibly wrapping) window? */
export function inSeason(dateInt: number, range: SeasonRange): boolean {
  return seasonSegments(range).some(([s, e]) => dateInt >= s && dateInt <= e);
}

/**
 * Index of the FIRST matching rule, or -1.
 *
 * WAS: the legacy loop reassigned without breaking, so with overlapping rules
 * the LAST one silently won — the price depended on row order in the admin.
 * First-match plus `validatePricingConfig` refusing overlaps is unambiguous.
 */
export function findSeason<T extends SeasonRange>(rules: readonly T[] | undefined, dateInt: number): number {
  if (!Array.isArray(rules)) return -1;
  return rules.findIndex((r) => inSeason(dateInt, r));
}

/** Do two windows share at least one calendar day? Wrap-safe. */
export const seasonsOverlap = (a: SeasonRange, b: SeasonRange): boolean =>
  monthDayRangesOverlap(a, b);

/** First party-size band containing `persons`, or -1. Serves both a resource's
 *  group brackets and the top-level tiers — same shape, same first-match rule,
 *  and `validatePricingConfig` refuses overlaps in both, so it is unambiguous. */
export function findBracket(
  brackets: readonly { min: number; max: number }[] | undefined,
  persons: number,
): number {
  if (!Array.isArray(brackets)) return -1;
  return brackets.findIndex((b) => persons >= num(b.min, 1) && persons <= num(b.max, 1));
}

/** Clamp any integer into a range, flooring first. Shared with the stay engine,
 *  where guest counts need the same "a crafted number cannot be huge" guard. */
export function clampInt(value: unknown, min: number, max: number): number {
  const n = Math.floor(num(value, min));
  return Math.min(max, Math.max(min, n));
}

/** Clamp a requested party size into the item's range — clamped, not rejected. */
export function clampPersons(
  cfg: Pick<BookingPricing, 'hasPersons' | 'minPersons' | 'maxPersons'>,
  requested: number,
): number {
  if (!cfg.hasPersons) return 1;
  const min = Math.max(1, Math.floor(num(cfg.minPersons, 1)));
  const max = Math.max(min, Math.floor(num(cfg.maxPersons, 999)));
  const n = Math.floor(num(requested, min));
  return Math.min(max, Math.max(min, n));
}

/** A percentage surcharge in basis points, applied to a minor-unit total. */
export function surchargeAmount(totalMinor: number, bps: number): number {
  return Math.round((totalMinor * Math.max(0, num(bps))) / 10_000);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Configuration validation                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

function issue(path: string, code: string, message: string): PricingIssue {
  return { path, code, message };
}

/**
 * The four ways a set of party-size bands can be wrong: a backwards range, a
 * band reaching outside the sizes the experience accepts, two bands claiming one
 * party size, and a size in the allowed range no band covers.
 *
 * One helper because the top-level tiers and a resource's group brackets are the
 * same idea at two levels, and they drifted once already — tiers demanded a row
 * per exact head count while brackets took ranges, so the same mistake produced
 * two different errors depending on where it was made.
 *
 * `codes` and `noun` keep each caller's existing messages, which the admin shows
 * verbatim next to the offending field.
 */
function personRangeIssues(
  rows: readonly { min: number; max: number }[],
  bounds: { min: number; max: number; enforceCoverage: boolean },
  path: (row: number | null) => string,
  codes: { range: string; bounds: string; overlap: string; gap: string },
  noun: string,
): PricingIssue[] {
  const found: PricingIssue[] = [];

  rows.forEach((r, i) => {
    const lo = num(r.min, 1);
    const hi = num(r.max, 1);
    if (lo > hi) {
      found.push(issue(path(i), codes.range, `This ${noun}'s last party size is below its first.`));
      return;
    }
    // Only a band that can NEVER apply — no overlap at all with the sizes the
    // experience accepts — is a mistake. One that merely runs past an edge
    // (1–20 where the range is 5–15) prices every allowed size correctly and is
    // just generous; rejecting those refused configurations that worked, and
    // turned a working experience into "price on request".
    if (bounds.enforceCoverage && (hi < bounds.min || lo > bounds.max)) {
      found.push(
        issue(
          path(i),
          codes.bounds,
          `This ${noun} covers only party sizes this experience never takes — it accepts ${bounds.min}–${bounds.max}.`,
        ),
      );
    }
  });

  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const a = rows[i];
      const b = rows[j];
      if (num(a.min, 1) <= num(b.max, 1) && num(b.min, 1) <= num(a.max, 1)) {
        found.push(
          issue(path(j), codes.overlap, `This ${noun} covers party sizes another one already covers.`),
        );
      }
    }
  }

  if (bounds.enforceCoverage && rows.length > 0 && bounds.min <= bounds.max) {
    const uncovered: number[] = [];
    for (let p = bounds.min; p <= bounds.max; p += 1) {
      if (findBracket(rows, p) < 0) uncovered.push(p);
    }
    if (uncovered.length) {
      // Naming the sizes, not just the count: "there is a gap" leaves the editor
      // hunting through their own table for it. The examples are listed rather
      // than given as a range, because what is missing need not be contiguous.
      const examples = uncovered.slice(0, 3).join(', ');
      const rest = uncovered.length - Math.min(3, uncovered.length);
      found.push(
        issue(
          path(null),
          codes.gap,
          `No ${noun} covers ${
            uncovered.length === 1
              ? `a party of ${uncovered[0]}`
              : `${uncovered.length} party sizes — ${examples}${rest ? ` and ${rest} more` : ''}`
          }. Every size between the minimum and the maximum needs a price.`,
        ),
      );
    }
  }

  return found;
}

/**
 * Every invariant the field DSL cannot express. An empty array means the config
 * is coherent; anything else means `quoteBooking` refuses rather than guessing.
 *
 * Refusing is the point. This codebase has been bitten repeatedly by the same
 * shape of bug — a duplicate coupon code, an overlapping shipping zone — where
 * the first row silently wins and the rest are dead configuration nobody can
 * see is dead. Overlapping seasons are that bug applied to a price.
 */
export function validatePricingConfig(cfg: BookingPricing): PricingIssue[] {
  const issues: PricingIssue[] = [];

  // ── Seasons ──
  cfg.seasonalPrices.forEach((s, i) => {
    if (monthDayToInt(s.from) == null || monthDayToInt(s.to) == null) {
      issues.push(issue(`seasonalPrices.${i}`, 'season_malformed', `Season ${i + 1} has an invalid date. Use mm-dd.`));
    }
  });
  for (let i = 0; i < cfg.seasonalPrices.length; i += 1) {
    for (let j = i + 1; j < cfg.seasonalPrices.length; j += 1) {
      if (seasonsOverlap(cfg.seasonalPrices[i], cfg.seasonalPrices[j])) {
        issues.push(
          issue(
            `seasonalPrices.${j}`,
            'season_overlap',
            `Season ${j + 1} overlaps season ${i + 1}. Two prices for one date is ambiguous.`,
          ),
        );
      }
    }
  }

  // ── Persons ──
  const min = Math.floor(num(cfg.minPersons, 1));
  const max = Math.floor(num(cfg.maxPersons, 999));
  if (cfg.hasPersons) {
    if (min < 1 || max < 1 || min > 999 || max > 999) {
      issues.push(issue('minPersons', 'persons_range', 'Person counts must be between 1 and 999.'));
    } else if (min > max) {
      issues.push(issue('maxPersons', 'persons_range', 'Maximum persons is below the minimum.'));
    }
  }
  // Nothing to check when per-person pricing is off: `readPricingConfig`
  // neutralises the person meta on the way in, so no stale value can reach a
  // price. That replaced a refusal here, which only trapped the editor — the
  // fields it named were hidden by the same switch that turned them off.

  // ── Mode-specific ──
  if (cfg.mode === 'group_threshold' && Math.floor(num(cfg.includedPersons)) < 1) {
    issues.push(
      issue('includedPersons', 'threshold_missing', 'Group pricing needs how many persons the flat price covers.'),
    );
  }
  if (cfg.mode === 'tiered') {
    if (cfg.tiers.length === 0) {
      issues.push(issue('tiers', 'tier_missing', 'Tiered pricing needs at least one party-size price.'));
    }
    issues.push(
      ...personRangeIssues(
        cfg.tiers,
        { min, max, enforceCoverage: cfg.hasPersons },
        (row) => (row === null ? 'tiers' : `tiers.${row}`),
        { range: 'tier_range', bounds: 'tier_bounds', overlap: 'tier_overlap', gap: 'tier_gap' },
        'price band',
      ),
    );
  }

  // ── Resources ──
  const seenResources = new Set<string>();
  cfg.resources.forEach((r, ri) => {
    if (r.id && seenResources.has(r.id)) {
      issues.push(issue(`resources.${ri}`, 'resource_duplicate', 'This resource is listed twice.'));
    }
    if (r.id) seenResources.add(r.id);

    const rules = r.seasonal ?? [];
    for (let i = 0; i < rules.length; i += 1) {
      for (let j = i + 1; j < rules.length; j += 1) {
        if (seasonsOverlap(rules[i], rules[j])) {
          issues.push(
            issue(
              `resources.${ri}.seasonal.${j}`,
              'resource_season_overlap',
              `"${r.label}" has two seasonal costs covering the same date.`,
            ),
          );
        }
      }
    }

    rules.forEach((rule, si) => {
      if (!rule.perPerson) return;
      issues.push(
        ...personRangeIssues(
          rule.brackets ?? [],
          { min, max, enforceCoverage: cfg.hasPersons },
          (row) =>
            row === null
              ? `resources.${ri}.seasonal.${si}.brackets`
              : `resources.${ri}.seasonal.${si}.brackets.${row}`,
          { range: 'bracket_range', bounds: 'bracket_bounds', overlap: 'bracket_overlap', gap: 'bracket_gap' },
          'group bracket',
        ),
      );
    });
  });

  // ── Extras ──
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

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * The extras block is stored as four sibling top-level keys rather than one
 * `extras` group, because the editor only propagates `shared` values for
 * top-level fields — nested inside a group they would drift between locales.
 */
function readExtras(data: Record<string, unknown>, locale: string): ExtrasConfig {
  return {
    enabled: data.extrasEnabled === true,
    title: resolveLoc(data.extrasTitle as Localized, locale) || undefined,
    multiplyPerPerson: data.extrasMultiplyPerPerson === true,
    mandatory: data.extrasMandatory === true,
    options: arr(data.extrasOptions).map((o) => {
      const row = rec(o);
      // The name is `localized: true`, so it is stored as a `{ locale: value }`
      // map — reading it as a plain string put an EMPTY label on every extra's
      // breakdown line. `resolveLoc` falls back to any non-empty locale, so a
      // half-translated extra is still named rather than blank.
      return { id: str(row.id), name: resolveLoc(row.name as Localized, locale), price: num(row.price) };
    }),
  };
}

/**
 * Normalise a raw `documents.data` object into a `BookingPricing`.
 *
 * Pure on purpose. `read.ts` does the I/O — fetching the row and resolving each
 * resource relation to its stable translation-group id — and hands the plain
 * JSON here. That split is what lets the whole engine be tested without a
 * database, which is this repo's rule for DB-adjacent logic.
 *
 * `resources` is passed in already resolved rather than read out of `data`,
 * because the ids the engine matches on are group ids that only a DB lookup can
 * supply.
 */
export function readPricingConfig(
  data: Record<string, unknown>,
  resources: ResourcePricing[],
  opts: { currency?: string; locale?: string } = {},
): BookingPricing {
  const rawBase = data.basePrice;
  const basePrice = rawBase === '' || rawBase == null ? null : num(rawBase);
  const hasPersons = data.hasPersons === true;
  const modeRaw = str(data.pricingMode, 'multiply');
  const mode = (PRICING_MODE_VALUES as readonly string[]).includes(modeRaw)
    ? (modeRaw as PricingMode)
    : 'multiply';

  /*
   * WAS: turning per-person pricing off left the mode, the tiers and the
   * extra-person charge behind in `data`, and the engine kept reading them — a
   * silently wrong price. That was met with a refused save, which then trapped
   * an editor: the admin hides a field a `showIf` switched off, so the values
   * being complained about were not on screen to clear.
   *
   * Neutralising here kills the bug at its source instead. Nothing downstream
   * can read stale person meta, and the leftover values stay in `data` so
   * ticking the switch back on restores the setup, which is how every other
   * conditional field in this CMS behaves.
   */
  return {
    basePrice,
    currency: opts.currency ?? 'EUR',
    hasPersons,
    minPersons: hasPersons ? Math.max(1, Math.floor(num(data.minPersons, 1))) : 1,
    maxPersons: hasPersons ? Math.max(1, Math.floor(num(data.maxPersons, 999))) : 1,
    mode: hasPersons ? mode : 'multiply',
    includedPersons: hasPersons ? Math.floor(num(data.includedPersons)) : 0,
    extraPerPerson: hasPersons ? num(data.extraPerPerson) : 0,
    tiers: !hasPersons
      ? []
      : arr(data.tiers).map((t) => {
          const row = rec(t);
          // A row written before bands existed states one exact head count, and
          // that is the band covering just that size. Only when the row has
          // neither end of its own: a half-typed `min` must not be overridden by
          // a leftover the editor can no longer see.
          const exact =
            row.min == null && row.max == null && row.persons != null
              ? Math.max(1, Math.floor(num(row.persons, 1)))
              : null;
          return {
            min: exact ?? Math.floor(num(row.min, 1)),
            max: exact ?? Math.floor(num(row.max, 1)),
            total: num(row.total),
          };
        }),
    seasonalPrices: arr(data.seasonalPrices).map((s) => {
      const row = rec(s);
      return {
        id: str(row.id) || undefined,
        from: str(row.from),
        to: str(row.to),
        price: num(row.price),
      };
    }),
    resources,
    extras: readExtras(data, opts.locale ?? ''),
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* The quote                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * THE algorithm. Deterministic, no I/O.
 *
 * Precedence, stated once because it is the part that surprises people: a
 * resource person-bracket beats `tiered`, and `tiered` beats `multiply` and
 * `group_threshold`. Both bracket and tier are explicit totals, and the
 * resource is the more specific statement of the two.
 */
export function quoteBooking(cfg: BookingPricing, sel: QuoteSelection): QuoteResult {
  // A price band states the whole total, so tiered pricing never reads the base
  // price. Demanding one anyway meant a fully configured tiered experience
  // quoted "price on request" over a field its own mode ignores.
  const tieredOnly = cfg.hasPersons && cfg.mode === 'tiered' && cfg.tiers.length > 0;
  if (!tieredOnly && (cfg.basePrice == null || !Number.isFinite(cfg.basePrice))) {
    return { ok: false, reason: 'price_on_request' };
  }

  const issues = validatePricingConfig(cfg);
  if (issues.length) return { ok: false, reason: 'invalid_config', issues };

  const persons = clampPersons(cfg, sel.persons ?? cfg.minPersons);
  const dateInt = dateToMonthDay(sel.date);
  const applied: QuoteApplied = {
    seasonalIndex: null,
    resourceRuleIndex: null,
    bracketIndex: null,
    tierPersons: null,
    groupOverride: false,
  };

  // ── A. The unit price: base, then season, then resource ──
  let unitMajor = num(cfg.basePrice);
  let unitLabel = 'Base price';
  let unitKind: QuoteLineKind = 'base';
  let unitCode = 'base';
  let unitRefId: string | undefined;

  if (dateInt != null) {
    const si = findSeason(cfg.seasonalPrices, dateInt);
    if (si >= 0) {
      unitMajor = num(cfg.seasonalPrices[si].price);
      applied.seasonalIndex = si;
      unitCode = `season:${cfg.seasonalPrices[si].id ?? si}`;
      unitLabel = 'Seasonal price';
    }
  }

  // An operator's exception for this one date beats the season: it is the more
  // specific statement, made on the calendar for exactly this day. Price bands
  // state whole totals and never read the base price, so they ignore it too.
  const baseOverride = sel.dateOverrides?.base;
  if (cfg.mode !== 'tiered' && baseOverride != null && Number.isFinite(baseOverride) && baseOverride >= 0) {
    unitMajor = baseOverride / 100;
    unitCode = 'date_override';
    unitLabel = 'Price for this date';
  }

  if (sel.resourceId) {
    // WAS: resources were matched by their description string, so renaming one
    // silently detached every price rule referring to it.
    const res = cfg.resources.find((r) => r.id === sel.resourceId);
    if (!res) return { ok: false, reason: 'unknown_resource' };

    let resCost = num(res.cost);
    if (dateInt != null) {
      const ri = findSeason(res.seasonal, dateInt);
      if (ri >= 0) {
        const rule = (res.seasonal ?? [])[ri];
        applied.resourceRuleIndex = ri;
        if (rule.perPerson && (rule.brackets ?? []).length > 0) {
          const bi = findBracket(rule.brackets, persons);
          if (bi >= 0) {
            resCost = num((rule.brackets ?? [])[bi].cost);
            applied.bracketIndex = bi;
            applied.groupOverride = true;
          }
        } else {
          resCost = num(rule.cost);
        }
      }
    }
    // The option's own calendar exception replaces whatever its rules gave —
    // including a party-size bracket, so the override reads as the option's
    // price for the day rather than as a group total.
    const optionOverride = sel.dateOverrides?.option;
    if (optionOverride != null && Number.isFinite(optionOverride) && optionOverride > 0) {
      resCost = optionOverride / 100;
      applied.groupOverride = false;
      applied.bracketIndex = null;
    }
    // A resource REPLACES the base price. It is not added to it.
    if (resCost > 0) {
      unitMajor = resCost;
      unitKind = 'resource';
      unitCode = `resource:${res.id}`;
      unitLabel = res.label;
      unitRefId = res.id;
    }
  }

  const unit = toMinor(unitMajor);
  const lines: QuoteLine[] = [];
  let total = unit;

  // ── B. Party size ──
  if (applied.groupOverride) {
    lines.push({
      kind: unitKind,
      code: unitCode,
      label: unitLabel,
      refId: unitRefId,
      quantity: 1,
      unitAmount: unit,
      amount: unit,
    });
  } else if (cfg.mode === 'tiered') {
    // WAS: tiered pricing was fully configurable in the admin and never read by
    // any pricing code. It is applied now.
    const ti = findBracket(cfg.tiers, persons);
    if (ti < 0) {
      return {
        ok: false,
        reason: 'invalid_config',
        issues: [issue('tiers', 'tier_gap', `No price band covers ${persons} persons.`)],
      };
    }
    total = toMinor(cfg.tiers[ti].total);
    applied.tierPersons = persons;
    lines.push({
      kind: 'base',
      code: `tier:${cfg.tiers[ti].min}-${cfg.tiers[ti].max}`,
      // "Base price — 7 persons" would be a lie on an experience priced only by
      // band, which needs no base price at all. A season or a chosen option has
      // replaced `unitLabel` with something meaningful, so that one still shows.
      label:
        unitCode === 'base' && cfg.basePrice == null
          ? `${persons} persons`
          : `${unitLabel} — ${persons} persons`,
      quantity: 1,
      unitAmount: total,
      amount: total,
    });
  } else if (cfg.mode === 'multiply') {
    total = unit * persons;
    lines.push({
      kind: unitKind,
      code: unitCode,
      // The head count belongs IN the label: the breakdown renders the label
      // against the per-person amount, so "Base price × 250,00 €" without it
      // would leave the multiplier the total is built from unstated.
      label: persons > 1 ? `${unitLabel} — ${pluralize(persons, 'person', 'persons')}` : unitLabel,
      refId: unitRefId,
      quantity: persons,
      unitAmount: unit,
      amount: total,
    });
  } else {
    lines.push({
      kind: unitKind,
      code: unitCode,
      label: unitLabel,
      refId: unitRefId,
      quantity: 1,
      unitAmount: unit,
      amount: unit,
    });
    if (cfg.mode === 'group_threshold') {
      const included = Math.floor(num(cfg.includedPersons));
      const extraCount = persons - included;
      if (extraCount > 0) {
        const perExtra = toMinor(cfg.extraPerPerson);
        const amount = perExtra * extraCount;
        total += amount;
        lines.push({
          kind: 'person',
          code: 'extra_persons',
          label: `Additional persons (over ${included}) — ${pluralize(extraCount, 'person', 'persons')}`,
          quantity: extraCount,
          unitAmount: perExtra,
          amount,
        });
      }
    }
  }

  // ── C. Extras ──
  if (cfg.extras.enabled) {
    const chosen = sel.extraIds ?? [];
    if (cfg.extras.mandatory && chosen.length === 0) {
      return { ok: false, reason: 'extra_required' };
    }
    for (const id of chosen) {
      const opt = cfg.extras.options.find((o) => o.id === id);
      if (!opt) return { ok: false, reason: 'unknown_extra' };
      const each = toMinor(opt.price);
      const quantity = cfg.extras.multiplyPerPerson ? persons : 1;
      const amount = each * quantity;
      total += amount;
      lines.push({
        kind: 'extra',
        code: `extra:${opt.id}`,
        label: cfg.extras.multiplyPerPerson
          ? `${opt.name} — ${pluralize(persons, 'person', 'persons')}`
          : opt.name,
        refId: opt.id,
        quantity,
        unitAmount: each,
        amount,
      });
    }
  }

  if (total === 0) return { ok: false, reason: 'price_on_request' };

  return {
    ok: true,
    currency: cfg.currency,
    persons,
    unitAmount: unit,
    lines,
    subtotal: total,
    total,
    applied,
  };
}
