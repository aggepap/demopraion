/**
 * The names a site gives what it stores in a visitor's browser.
 *
 * Every name carries the site's `storagePrefix` (see `defineConfig`), so a site
 * built from this core never tells its visitors it stores another site's keys.
 *
 * Pure and dependency-free on purpose: the cookie registry (server) and the
 * components that actually write the keys (client) both derive their names from
 * here, which is what keeps the published declaration and the real storage in
 * step.
 */
export interface StorageKeyNames {
  cookieConsent: string;
  cookieCategories: string;
  visitorRef: string;
  /** Not stored: the window event fired when a visitor decides. Same prefix. */
  consentEvent: string;
  cart: string;
  compare: string;
  /** Saved products for a guest; a signed-in customer's list is in the database. */
  wishlist: string;
  recentlyViewed: string;
  /** When this visitor last saw each popup, so its frequency rule can be kept. */
  popupSeen: string;
}

export function storageKeys(prefix: string): StorageKeyNames {
  return {
    cookieConsent: `${prefix}-cookie-consent`,
    cookieCategories: `${prefix}-cookie-categories`,
    visitorRef: `${prefix}-visitor-ref`,
    consentEvent: `${prefix}-consent-changed`,
    cart: `${prefix}-cart`,
    compare: `${prefix}-compare`,
    wishlist: `${prefix}-wishlist`,
    recentlyViewed: `${prefix}-recently-viewed`,
    popupSeen: `${prefix}-popup-seen`,
  };
}
