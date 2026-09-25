import { revalidateTag, unstable_cache } from 'next/cache';
import { eq } from 'drizzle-orm';

import { getDb, schema } from '../../db';

/**
 * Site-settings KV store — for global, non-document configuration (nav, footer,
 * shared widget copy, feature toggles). Cached with a shared tag so a write
 * invalidates all readers. One layer, unlike v1's two settings implementations
 * (BACKEND.md §13.2).
 */
const SETTINGS_TAG = 'cms:settings';
const settingTag = (key: string) => `cms:setting:${key}`;

/** One uncached read of a setting row. Throws on a DB failure. */
async function readSetting<T>(key: string): Promise<T | null> {
  const db = getDb();
  const [row] = await db
    .select({ value: schema.siteSettings.value })
    .from(schema.siteSettings)
    .where(eq(schema.siteSettings.key, key))
    .limit(1);
  return (row?.value as T | undefined) ?? null;
}

export async function getSetting<T = unknown>(key: string): Promise<T | null> {
  // Best-effort: a DB failure (e.g. a static build with no DB reachable)
  // resolves to null — not cached — so the layout/read path degrades instead
  // of crashing the prerender. Mirrors the document read layer.
  try {
    return await unstable_cache(() => readSetting<T>(key), ['cms-setting', key], {
      tags: [SETTINGS_TAG, settingTag(key)],
      revalidate: CMS_CACHE_REVALIDATE,
    })();
  } catch (err) {
    console.error('[cms/settings] getSetting failed', { key }, err);
    return null;
  }
}

/**
 * The stored value straight from the database, bypassing the cache — and, unlike
 * `getSetting`, a DB failure throws instead of reading as "unset".
 *
 * For reads that make a decision about a value somebody just wrote: a one-use
 * OAuth `state`, or the baseline a conflict check compares against. Those must
 * see the row as it is now, not as some cache entry remembers it — cached reads
 * never expire by the clock (`CMS_CACHE_REVALIDATE`), so a missed purge would
 * otherwise be permanent.
 */
export async function getSettingUncached<T = unknown>(key: string): Promise<T | null> {
  return readSetting<T>(key);
}

export async function getSettings<T = unknown>(keys: string[]): Promise<Record<string, T | null>> {
  const entries = await Promise.all(keys.map(async (k) => [k, await getSetting<T>(k)] as const));
  return Object.fromEntries(entries);
}

/**
 * Upsert a setting, then purge that key's cached reads.
 *
 * The purge lives here rather than in the callers because cached reads never
 * expire by the clock (`CMS_CACHE_REVALIDATE = false`): a writer that forgot to
 * revalidate — the Google OAuth flow did — left every later `getSetting` reading
 * the old value until the next deploy. Every write path now purges, whoever the
 * caller is. Outside a request (seed CLIs) `revalidateTag` throws, and there is
 * nothing to purge, so that is swallowed.
 *
 * `onDuplicateKeyUpdate` is the one MariaDB-specific call here — it moves
 * behind the adapter when the Postgres adapter (onConflictDoUpdate) lands.
 */
export async function setSetting(key: string, value: unknown, updatedBy: number | null = null): Promise<void> {
  const db = getDb();
  await db
    .insert(schema.siteSettings)
    .values({ key, value, updatedBy })
    .onDuplicateKeyUpdate({ set: { value, updatedBy } });
  invalidateSetting(key);
}

/** Purge the cached reads of one key. A no-op outside a request context. */
export function invalidateSetting(key: string): void {
  try {
    revalidateTag(settingTag(key), { expire: 0 });
  } catch {
    // Outside a request context (e.g. seeding) — nothing is cached to purge.
  }
}

export { SETTINGS_TAG, settingTag };

export {
  MANAGED_SETTINGS,
  MANAGED_SETTING_KEYS,
  SECURITY_REQUIRE_2FA_KEY,
  moduleSettingKey,
  I18N_LOCALES_KEY,
  ECOMMERCE_CURRENCY_KEY,
  ECOMMERCE_CURRENCIES,
  DEFAULT_CURRENCY,
  ECOMMERCE_PAYMENT_PROVIDER_KEY,
  DEFAULT_PAYMENT_PROVIDER,
  ECOMMERCE_SHIPPING_KEY,
  ECOMMERCE_COUPONS_KEY,
  ECOMMERCE_GIFTWRAP_FEE_KEY,
  BOOKING_CURRENCY_KEY,
  parseMultiValue,
  formatMultiValue,
  readBooleanSetting,
  BOOLEAN_SETTING_VALUES,
  BOOKING_KINDS_KEY,
  BOOKING_KINDS,
  DEFAULT_BOOKING_KINDS,
  BOOKING_MODE_KEY,
  BOOKING_MODES,
  DEFAULT_BOOKING_MODE,
  BOOKING_TIMEZONE_KEY,
  DEFAULT_BOOKING_TIMEZONE,
  BOOKING_REQUEST_EXPIRY_KEY,
  BOOKING_PAYMENT_HOLD_KEY,
  BOOKING_PAYMENT_LINK_EXPIRY_KEY,
  BOOKING_PAYMENT_INSTRUCTIONS_KEY,
  BOOKING_DEPOSIT_PERCENT_KEY,
  BOOKING_NOTIFICATION_EMAILS_KEY,
  BOOKING_DEFAULT_CAPACITY_KEY,
  BOOKING_LEAD_TIME_KEY,
  BOOKING_PAYMENT_PROVIDER_KEY,
  BOOKING_SURCHARGE_STRIPE_KEY,
  BOOKING_SURCHARGE_PAYPAL_KEY,
  BOOKING_SURCHARGE_VIVA_KEY,
  CUSTOM_FIELDS_KEY,
  SEO_FIELDS_KEY,
  MODULE_PREFIX,
  EXTRA_MANAGED_KEYS,
  resolveLocaleSet,
  type SettingFieldDef,
  type SettingFieldType,
  type LocaleSettings,
  type StoredLocaleSettings,
  type BookingKindValue,
} from './schema';
import { CMS_CACHE_REVALIDATE } from '../cache';
export { ANALYTICS_GA_ID_KEY, resolveGaId } from './analytics';
export { resolveModuleFlags, isModuleEnabled } from './modules';
export { resolveLocaleSettings } from './locales';
