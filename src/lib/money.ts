/**
 * Client-safe money helpers. Product prices are authored in MAJOR units
 * (e.g. 49.99); the `orders`/`order_items` tables store MINOR units (integer
 * cents). Keep this file free of server imports so client components (cart,
 * checkout, admin tables) can use it without pulling in the DB layer.
 */

/** Locale-aware currency formatting. Falls back to `amount currency` on error. */
export function formatPrice(amount: number, currency: string, locale = 'el'): string {
  const intlLocale = locale === 'el' ? 'el-GR' : locale === 'en' ? 'en-US' : locale;
  try {
    return new Intl.NumberFormat(intlLocale, { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

/** Major units → integer minor units (cents). */
export const toMinor = (major: number): number => Math.round(major * 100);

/** Integer minor units (cents) → major units. */
export const fromMinor = (cents: number): number => cents / 100;
