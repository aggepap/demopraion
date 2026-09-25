/**
 * One named reader per booking setting.
 *
 * A settings key with no reader is a control that governs nothing — a switch on
 * the wall wired to no bulb. It has happened here often enough to be a
 * recognised bug class, so `BOOKING_SETTING_READERS` exists to be asserted
 * against `MANAGED_SETTINGS` in a test: add a `booking.*` key without a reader
 * and the suite fails rather than the site quietly ignoring it.
 *
 * Every reader is total — it returns a usable value for an unset, blank or
 * malformed setting rather than throwing, because `getSetting` is fail-open and
 * a settings outage must not take down a price.
 */
import 'server-only';

import {
  BOOKING_CURRENCY_KEY,
  BOOKING_KINDS,
  BOOKING_KINDS_KEY,
  BOOKING_DEFAULT_CAPACITY_KEY,
  BOOKING_DEPOSIT_PERCENT_KEY,
  BOOKING_LEAD_TIME_KEY,
  BOOKING_MODE_KEY,
  BOOKING_MODES,
  BOOKING_NOTIFICATION_EMAILS_KEY,
  BOOKING_PAYMENT_PROVIDER_KEY,
  BOOKING_PAYMENT_INSTRUCTIONS_KEY,
  BOOKING_PAYMENT_HOLD_KEY,
  BOOKING_PAYMENT_LINK_EXPIRY_KEY,
  BOOKING_REQUEST_EXPIRY_KEY,
  BOOKING_SURCHARGE_PAYPAL_KEY,
  BOOKING_SURCHARGE_STRIPE_KEY,
  BOOKING_SURCHARGE_VIVA_KEY,
  BOOKING_TIMEZONE_KEY,
  DEFAULT_BOOKING_KINDS,
  DEFAULT_BOOKING_MODE,
  DEFAULT_BOOKING_TIMEZONE,
  getSetting,
  parseMultiValue,
  type BookingKindValue,
} from '../../core';
import { getBookingCurrency } from './read';

/** Which flow a booking follows when the item does not override it. */
export type BookingMode = (typeof BOOKING_MODES)[number];

export const DEFAULT_REQUEST_EXPIRY_HOURS = 72;
export const DEFAULT_PAYMENT_HOLD_MINUTES = 20;
export const DEFAULT_PAYMENT_LINK_EXPIRY_DAYS = 7;
export const DEFAULT_CAPACITY_PER_DAY = 1;
export const DEFAULT_LEAD_TIME_HOURS = 0;

/**
 * A positive number from a settings value, or the fallback.
 *
 * Settings are stored as JSON, so a field the admin typed into arrives as a
 * string and the same field seeded programmatically arrives as a number. Both
 * have to work, and anything else has to fall back rather than poison a
 * calculation with NaN.
 */
async function positiveNumber(key: string, fallback: number, opts: { min?: number } = {}): Promise<number> {
  const raw = await getSetting(key);
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < (opts.min ?? 0)) return fallback;
  return n;
}

/** The default flow for items set to `inherit`. */
export async function getBookingMode(): Promise<BookingMode> {
  const raw = await getSetting(BOOKING_MODE_KEY);
  return typeof raw === 'string' && (BOOKING_MODES as readonly string[]).includes(raw)
    ? (raw as BookingMode)
    : DEFAULT_BOOKING_MODE;
}

/**
 * Which booking kinds this site sells.
 *
 * Read by the field resolver that decides whether an experience is asked which
 * kind it is. Total, like every reader here: unknown values are dropped and an
 * empty result falls back to every kind, so a malformed setting widens rather
 * than narrows. Narrowing on bad input would take away the operator's ability
 * to author, which is the one failure they could not work around.
 */
export async function getBookingKinds(): Promise<BookingKindValue[]> {
  const chosen = parseMultiValue(await getSetting(BOOKING_KINDS_KEY)).filter((v): v is BookingKindValue =>
    (BOOKING_KINDS as readonly string[]).includes(v),
  );
  // An empty or unrecognised setting means every kind, not none. A site whose
  // settings row was never saved must not lose the ability to author anything.
  return chosen.length > 0 ? chosen : [...DEFAULT_BOOKING_KINDS];
}

/**
 * The timezone booking dates are calendar days in.
 *
 * Validated against `Intl` rather than trusted: a typo here would otherwise
 * throw deep inside date formatting, at the moment someone tries to book.
 */
export async function getBookingTimezone(): Promise<string> {
  const raw = await getSetting(BOOKING_TIMEZONE_KEY);
  const tz = typeof raw === 'string' ? raw.trim() : '';
  if (!tz) return DEFAULT_BOOKING_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return tz;
  } catch {
    console.error('[booking/settings] invalid timezone, falling back', { value: tz });
    return DEFAULT_BOOKING_TIMEZONE;
  }
}

export function getRequestExpiryHours(): Promise<number> {
  return positiveNumber(BOOKING_REQUEST_EXPIRY_KEY, DEFAULT_REQUEST_EXPIRY_HOURS, { min: 1 });
}

export function getPaymentHoldMinutes(): Promise<number> {
  return positiveNumber(BOOKING_PAYMENT_HOLD_KEY, DEFAULT_PAYMENT_HOLD_MINUTES, { min: 1 });
}

export function getPaymentLinkTtlDays(): Promise<number> {
  return positiveNumber(BOOKING_PAYMENT_LINK_EXPIRY_KEY, DEFAULT_PAYMENT_LINK_EXPIRY_DAYS, { min: 1 });
}

export function getDefaultCapacity(): Promise<number> {
  return positiveNumber(BOOKING_DEFAULT_CAPACITY_KEY, DEFAULT_CAPACITY_PER_DAY, { min: 1 });
}

export function getDefaultLeadTimeHours(): Promise<number> {
  return positiveNumber(BOOKING_LEAD_TIME_KEY, DEFAULT_LEAD_TIME_HOURS);
}

/** The deposit as basis points, so percentages stay integer arithmetic. */
export async function getDepositPercentBps(): Promise<number> {
  const percent = await positiveNumber(BOOKING_DEPOSIT_PERCENT_KEY, 0);
  return Math.round(Math.min(100, Math.max(0, percent)) * 100);
}

/** The provider key configured in Settings → Booking. */
export async function getBookingPaymentProvider(): Promise<string> {
  const raw = await getSetting(BOOKING_PAYMENT_PROVIDER_KEY);
  return typeof raw === 'string' && raw.trim() ? raw.trim() : 'manual';
}

/** The manual-payment instructions, trimmed; '' when none are set. */
export async function getPaymentInstructions(): Promise<string> {
  const raw = await getSetting(BOOKING_PAYMENT_INSTRUCTIONS_KEY);
  return typeof raw === 'string' ? raw.trim() : '';
}

/** Which setting holds each gateway's surcharge. Manual has none — there is no
 *  processor taking a cut of a bank transfer. */
const SURCHARGE_KEYS: Record<string, string> = {
  stripe: BOOKING_SURCHARGE_STRIPE_KEY,
  paypal: BOOKING_SURCHARGE_PAYPAL_KEY,
  viva: BOOKING_SURCHARGE_VIVA_KEY,
};

/**
 * A provider's surcharge in basis points, so percentages stay integer
 * arithmetic all the way to the charge. Unknown providers surcharge nothing.
 */
export async function getSurchargeBps(providerKey: string): Promise<number> {
  const key = SURCHARGE_KEYS[providerKey];
  if (!key) return 0;
  const percent = await positiveNumber(key, 0);
  return Math.round(Math.min(100, Math.max(0, percent)) * 100);
}

export function getStripeSurchargeBps(): Promise<number> {
  return getSurchargeBps('stripe');
}

export function getPayPalSurchargeBps(): Promise<number> {
  return getSurchargeBps('paypal');
}

export function getVivaSurchargeBps(): Promise<number> {
  return getSurchargeBps('viva');
}

/** Addresses told about new requests — one per line, blanks discarded. */
export async function getBookingRecipients(): Promise<string[]> {
  const raw = await getSetting(BOOKING_NOTIFICATION_EMAILS_KEY);
  if (typeof raw !== 'string') return [];
  return [
    ...new Set(
      raw
        .split(/[\n,;]+/)
        .map((s) => s.trim())
        .filter((s) => s.includes('@')),
    ),
  ];
}

/**
 * Every `booking.*` managed key mapped to the function that reads it.
 *
 * Asserted against `MANAGED_SETTINGS` in `test/booking/settings.test.ts`.
 */
export const BOOKING_SETTING_READERS: Record<string, () => Promise<unknown>> = {
  [BOOKING_KINDS_KEY]: getBookingKinds,
  [BOOKING_MODE_KEY]: getBookingMode,
  [BOOKING_CURRENCY_KEY]: getBookingCurrency,
  [BOOKING_TIMEZONE_KEY]: getBookingTimezone,
  [BOOKING_NOTIFICATION_EMAILS_KEY]: getBookingRecipients,
  [BOOKING_REQUEST_EXPIRY_KEY]: getRequestExpiryHours,
  [BOOKING_PAYMENT_HOLD_KEY]: getPaymentHoldMinutes,
  [BOOKING_PAYMENT_LINK_EXPIRY_KEY]: getPaymentLinkTtlDays,
  [BOOKING_DEPOSIT_PERCENT_KEY]: getDepositPercentBps,
  [BOOKING_DEFAULT_CAPACITY_KEY]: getDefaultCapacity,
  [BOOKING_LEAD_TIME_KEY]: getDefaultLeadTimeHours,
  [BOOKING_PAYMENT_PROVIDER_KEY]: getBookingPaymentProvider,
  [BOOKING_PAYMENT_INSTRUCTIONS_KEY]: getPaymentInstructions,
  [BOOKING_SURCHARGE_STRIPE_KEY]: getStripeSurchargeBps,
  [BOOKING_SURCHARGE_PAYPAL_KEY]: getPayPalSurchargeBps,
  [BOOKING_SURCHARGE_VIVA_KEY]: getVivaSurchargeBps,
};
