/**
 * Write-boundary validation for a single settings value, against the type its
 * key declares. Lifted out of the settings route so it can be tested without
 * a request, and so the one place that knows what a `boolean` or `money`
 * setting may hold is not buried in a handler.
 *
 * Plain data and `zod` only — no `server-only`, no database.
 */
import { z } from 'zod';

import {
  BOOLEAN_SETTING_VALUES,
  formatMultiValue,
  MODULE_PREFIX,
  parseMultiValue,
  type SettingFieldDef,
} from './schema';
import { checkStructuredSetting } from './structured';

/** Upper bound for a free-text setting value. Generous; the point is that one exists. */
const MAX_SETTING_TEXT = 20_000;

/**
 * Validate a value against the type its key declares.
 *
 * The route's own input schema is `z.unknown()` per key, because the managed
 * keys are a mix of plain strings and structured JSON (shipping zones, coupons,
 * custom-field configs) that each have their own sanitiser further in. That
 * left the simple keys — site name, GA id, email — accepting literally any JSON
 * value, which then came back out of the database and into the page that reads
 * it. Typed keys are checked here; structured keys keep their existing
 * sanitisers, which is where their shape is actually known.
 */
export function validateSettingValue(
  key: string,
  def: SettingFieldDef | undefined,
  value: unknown
): { ok: true; value: unknown } | { ok: false; message: string } {
  // The structured keys (shipping, coupons, custom fields) have no descriptor
  // because they are not single fields. They used to fall straight through this
  // function, so the database accepted any JSON at all and the admin worked only
  // because every reader coerced defensively — the same assumption that let
  // "3,50" become a free gift wrap (F-032). They are checked at the boundary now.
  const structured = checkStructuredSetting(key, value);
  if (structured) return structured;

  /*
   * A module flag is the one key with no descriptor that still has a shape.
   *
   * `module.<name>` is not in MANAGED_SETTINGS and is not structured, so it fell
   * through to the "unknown key, store it as-is" branch below and accepted
   * anything. Its only reader honours the override solely when
   * `typeof override === 'boolean'` and otherwise falls back to the compile-time
   * default — so `PATCH { "module.commerce": "false" }` answered 200, the next GET
   * echoed `"false"` back as though the module had been turned off, and the module
   * stayed on. An easy mistake for any script, and nothing anywhere said it had not
   * worked (F-061). Refused at the boundary instead of ignored on read.
   */
  if (key.startsWith(MODULE_PREFIX)) {
    if (typeof value !== 'boolean') {
      return {
        ok: false,
        message: `${key} must be true or false, not ${typeof value === 'string' ? `the text "${value}"` : typeof value}.`,
      };
    }
    return { ok: true, value };
  }

  if (!def) return { ok: true, value };
  if (value === null || value === undefined) return { ok: true, value: '' };
  if (typeof value !== 'string') {
    return { ok: false, message: `${def.label} must be text.` };
  }
  if (value.length > MAX_SETTING_TEXT) {
    return { ok: false, message: `${def.label} is too long (max ${MAX_SETTING_TEXT} characters).` };
  }
  if (
    def.type === 'email' &&
    value.trim() !== '' &&
    !z.string().email().safeParse(value.trim()).success
  ) {
    return { ok: false, message: `${def.label} must be a valid email address.` };
  }
  if (def.type === 'money' && value.trim() !== '') {
    /*
     * A money field was a free-text box, and `parseMoneyMajor` (its only reader)
     * turns anything unparseable into 0. So "3,50" — which is how this is
     * written in Greek, and this admin is used in Greek — saved without
     * complaint and made gift wrapping free. Nothing on the screen, in the log,
     * or in the stored value said so.
     *
     * A comma is accepted and normalised, since that is what people type. What
     * is refused is genuinely ambiguous input: "3,500" could be three-and-a-half
     * or three thousand five hundred, and guessing at money is worse than asking.
     */
    const raw = value.trim();
    if (!/^\d+([.,]\d{1,2})?$/.test(raw)) {
      return {
        ok: false,
        message: `${def.label} must be an amount like 3.50 or 3,50 (no thousands separator).`,
      };
    }
    return { ok: true, value: raw.replace(',', '.') };
  }
  if (def.type === 'gaId' && value.trim() !== '') {
    /*
     * The only managed setting that reaches a raw inline script.
     *
     * `AnalyticsLoader` interpolates it into a single-quoted JS string literal, so
     * a value carrying a quote closed the literal and everything after it ran as
     * script — on every page, for every visitor who accepted cookies, not just for
     * the admin who saved it. Nothing on the screen hinted at that, and a snippet
     * copied from an untrustworthy "how to install GA" page is exactly how it
     * would arrive (F-063).
     *
     * An allow-list, not an escape list: the real format is narrow and known, so
     * there is no reason to reason about which characters are dangerous. The
     * reader escapes as well — neither half is trusted to be the only guard.
     */
    if (!/^G-[A-Z0-9]{4,20}$/i.test(value.trim())) {
      return {
        ok: false,
        message: `${def.label} looks like G-XXXXXXXXXX — letters and digits only, no quotes or spaces.`,
      };
    }
    return { ok: true, value: value.trim() };
  }
  if (def.type === 'boolean') {
    /*
     * Exactly `on` or `off` (or empty, which reads as off). Anything looser —
     * `true`, `ON`, `1` — would store happily and then read as off, which is
     * the gift-wrap failure again: a value accepted and silently ignored.
     */
    if (value !== '' && !(BOOLEAN_SETTING_VALUES as readonly string[]).includes(value)) {
      return { ok: false, message: `${def.label} must be on or off.` };
    }
    return { ok: true, value };
  }
  if (def.type === 'select' && def.options?.length) {
    const allowed = def.options.map((o) => o.value);
    if (value !== '' && !allowed.includes(value)) {
      return { ok: false, message: `${def.label} must be one of: ${allowed.join(', ')}.` };
    }
  }
  if (def.type === 'multiselect' && def.options?.length) {
    const allowed = def.options.map((o) => o.value);
    const chosen = parseMultiValue(value);
    const unknown = chosen.filter((v) => !allowed.includes(v));
    if (unknown.length) {
      return { ok: false, message: `${def.label} does not offer: ${unknown.join(', ')}.` };
    }
    // Re-encoded rather than stored as typed: whitespace and duplicates would
    // otherwise reach the readers, which split on commas and trust what they get.
    return { ok: true, value: formatMultiValue(chosen) };
  }
  return { ok: true, value };
}
