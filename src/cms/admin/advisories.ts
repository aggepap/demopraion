/**
 * Cross-field checks the field DSL cannot express, run in the editor as the
 * document is typed.
 *
 * `showIf` and zod cover one field at a time. Whether a set of price bands
 * leaves a party size unpriced is a statement about several fields at once, and
 * the only code that knew it was the price engine — which runs when a *customer*
 * asks for a quote. So a booking whose pricing was incoherent saved cleanly,
 * published cleanly, and then told visitors "price on request" with nothing in
 * the admin to explain it.
 *
 * ADVISORY. Nothing here blocks a save: an unfinished draft is allowed to be
 * incoherent, and a refusal would trap the editor mid-setup.
 *
 * No round trip. `pricing.ts`, `stay.ts` and `data.ts` are pure by contract (no
 * `server-only`, no DB, no `next/*`), so the browser runs the same functions the
 * quote endpoint does and cannot disagree with it. `/api/cms/bookings/validate-pricing`
 * is the same check for callers that are not this form.
 */
import {
  readBookingKind,
  toResourcePricing,
} from '../modules/booking/data';
import { readPricingConfig, validatePricingConfig } from '../modules/booking/pricing';
import { readStayConfig, validateStayConfig } from '../modules/booking/stay';
import type { PricingIssue } from '../modules/booking/pricing';

/** Field path (dotted, as the form addresses controls) → messages. */
export type AdvisoryMap = Record<string, string[]>;

export type Advisory = (data: Record<string, unknown>, locale: string) => AdvisoryMap;

/**
 * Fold an issue onto a path the form actually renders.
 *
 * A repeater gives its rows to sub-controls (`tiers.0.min`) and keeps its own
 * banner at the field path (`tiers`). An issue about a whole ROW (`tiers.0`)
 * addresses neither, so it would render nowhere at all. Folding the row index
 * away moves it to the repeater's banner, and the row number moves into the
 * message so it still says which one.
 */
function renderablePath(issue: PricingIssue): [string, string] {
  const segments = issue.path.split('.');
  const last = segments[segments.length - 1];
  if (segments.length > 1 && /^\d+$/.test(last)) {
    return [segments.slice(0, -1).join('.'), `Row ${Number(last) + 1}: ${issue.message}`];
  }
  return [issue.path, issue.message];
}

function group(issues: PricingIssue[], rename: (path: string) => string): AdvisoryMap {
  const map: AdvisoryMap = {};
  for (const issue of issues) {
    const [path, message] = renderablePath({ ...issue, path: rename(issue.path) });
    (map[path] ??= []).push(message);
  }
  return map;
}

/**
 * Translate the ENGINE's names for things into the FORM's.
 *
 * The two vocabularies were never meant to meet: the price engine calls a
 * bookable thing a `resource` and keeps extras under `extras.options`, while the
 * fields an editor sees are `options` and `extrasOptions`. Every message about
 * one of those addressed a path no control owns, so it rendered nowhere —
 * silently, which is the one failure mode this channel exists to remove.
 *
 * The indices need translating too, not just the names: `toResourcePricing`
 * drops rows with no id, so its third resource can be the fourth `options` row.
 */
function bookingPathRenamer(data: Record<string, unknown>): (path: string) => string {
  const rows = Array.isArray(data.options) ? data.options : [];
  const formIndex: number[] = [];
  rows.forEach((row, i) => {
    const id = (row as Record<string, unknown> | null)?.id;
    if (typeof id === 'string' && id.trim()) formIndex.push(i);
  });

  return (path) => {
    if (path === 'extras.options' || path.startsWith('extras.options.')) {
      return `extrasOptions${path.slice('extras.options'.length)}`;
    }
    const match = /^resources\.(\d+)(.*)$/.exec(path);
    if (!match) return path;
    const mapped = formIndex[Number(match[1])];
    // An index with no row behind it can only come from a document that changed
    // under us; dropping the message beats pointing at the wrong option.
    return mapped === undefined ? path : `options.${mapped}${match[2]}`;
  };
}

/**
 * A bookable item prices either by the day (transport) or by the night (stay),
 * through two separate engines. Which one applies is `kind`, exactly as
 * `resolveBookingPricing` decides it on the server.
 */
const bookingPricing: Advisory = (data, locale) => {
  const options = toResourcePricing(data, locale);
  const pricing = readPricingConfig(data, options, { locale });
  return group(
    readBookingKind(data) === 'stay'
      ? validateStayConfig(readStayConfig(data, options, pricing.extras, { locale }))
      : validatePricingConfig(pricing),
    bookingPathRenamer(data),
  );
};

/** Keyed by a collection's `advisories` declaration. */
export const ADVISORIES: Record<string, Advisory> = {
  'booking-pricing': bookingPricing,
};
