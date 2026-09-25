/**
 * What this codebase is known to store in a visitor's browser.
 *
 * Written down rather than discovered, and that is the honest trade: it cannot
 * find a tracker somebody pasted into a content block, but everything it does
 * report is something the source actually writes, with a key you can grep for.
 * A scanner that guessed would be worse than none, because the output feeds a
 * legal declaration.
 *
 * `localStorage` is in scope. GDPR governs "cookies and similar storage", and
 * three of the consent keys live there — a cookie-only scanner would fail to
 * report the site's own consent mechanism.
 *
 * Keep this in step with the code: `session.ts` and `mfa-challenge.ts` own the
 * `cms_*` cookies, `CookieBanner.tsx` the `<prefix>-cookie-*` keys, `PopupRuntime.tsx`
 * `<prefix>-popup-seen`, and next-intl
 * sets `NEXT_LOCALE`. The prefixed names come from `storageKeys`, the same
 * function the components use, so the two cannot drift apart by spelling.
 */
import { ANALYTICS_CATEGORY_KEY, type LocaleText } from './defaults';
import { storageKeys } from './storage-keys';

/** A cookie proper, or the "similar storage" the same rules cover. */
export type StorageKind = 'cookie' | 'storage';

/** Who ends up with it: anyone who loads the site, or only signed-in staff. */
export type Audience = 'visitor' | 'admin';

export interface StorageKey {
  name: string;
  kind: StorageKind;
}

export interface RegisteredService {
  name: string;
  provider: string | null;
  /** The category this belongs under, by key, when it is declared. */
  categoryKey: string;
  audience: Audience;
  purpose: LocaleText;
  keys: StorageKey[];
}

/**
 * Present on every install, with no configuration. The browser keys are named
 * after the site's `storagePrefix`.
 */
export function alwaysPresent(storagePrefix: string): RegisteredService[] {
  const keys = storageKeys(storagePrefix);
  return [
    {
      name: 'Session & consent',
      provider: null,
      categoryKey: 'necessary',
      audience: 'visitor',
      purpose: {
        el: 'Κρατά τη γλώσσα που επιλέξατε και την ίδια σας την απόφαση για τα cookies, ώστε να μη σας ξαναρωτήσουμε.',
        en: 'Keeps the language you chose and your cookie decision itself, so we do not ask you again.',
      },
      keys: [
        { name: 'NEXT_LOCALE', kind: 'cookie' },
        { name: keys.cookieConsent, kind: 'storage' },
        { name: keys.cookieCategories, kind: 'storage' },
        { name: keys.visitorRef, kind: 'storage' },
      ],
    },
    {
      name: 'Shop preferences',
      provider: null,
      categoryKey: 'necessary',
      audience: 'visitor',
      purpose: {
        el: 'Κρατά το καλάθι σας, τη λίστα επιθυμιών, τα προϊόντα που συγκρίνετε και όσα είδατε πρόσφατα. Μένουν στη συσκευή σας.',
        en: 'Keeps your basket, your wishlist, the products you are comparing, and what you viewed recently. They stay on your device.',
      },
      keys: [
        { name: keys.cart, kind: 'storage' },
        { name: keys.compare, kind: 'storage' },
        { name: keys.wishlist, kind: 'storage' },
        { name: keys.recentlyViewed, kind: 'storage' },
      ],
    },
    {
      name: 'Popups',
      provider: null,
      categoryKey: 'necessary',
      audience: 'visitor',
      purpose: {
        el: 'Θυμάται πότε είδατε κάθε αναδυόμενο μήνυμα, ώστε να μη σας το ξαναδείξουμε πιο συχνά απ’ ό,τι πρέπει. Μένει στη συσκευή σας.',
        en: 'Remembers when you last saw each popup, so it is not shown to you more often than it should be. It stays on your device.',
      },
      keys: [{ name: keys.popupSeen, kind: 'storage' }],
    },
    {
      name: 'Customer sign-in',
      provider: null,
      categoryKey: 'necessary',
      audience: 'visitor',
      purpose: {
        el: 'Κρατά συνδεδεμένο τον πελάτη που έχει λογαριασμό στο κατάστημα, ώστε να βλέπει τις παραγγελίες του.',
        en: 'Keeps a customer with a shop account signed in, so they can see their own orders.',
      },
      keys: [{ name: 'cms_customer', kind: 'cookie' }],
    },
    {
      name: 'Admin session',
      provider: null,
      categoryKey: 'necessary',
      // Never set for a visitor — only for somebody who signed in to the CMS.
      // Reported separately so it is not presented as something the public gets.
      audience: 'admin',
      purpose: {
        el: 'Κρατά συνδεδεμένο τον διαχειριστή του ιστότοπου και επιβεβαιώνει τον δεύτερο παράγοντα ταυτοποίησης.',
        en: 'Keeps a site administrator signed in and carries their second-factor challenge.',
      },
      keys: [
        { name: 'cms_session', kind: 'cookie' },
        { name: 'cms_mfa', kind: 'cookie' },
      ],
    },
  ];
}

/**
 * Google Analytics 4, as gtag.js actually sets it.
 *
 * `_ga` plus one `_ga_<container>` per stream. Deliberately not `_gid` — that
 * is Universal Analytics, and listing a cookie the site does not set is the
 * same kind of error as omitting one it does.
 */
export const GOOGLE_ANALYTICS_REGISTRY: RegisteredService = {
  name: 'Google Analytics 4',
  provider: 'Google',
  categoryKey: ANALYTICS_CATEGORY_KEY,
  audience: 'visitor',
  purpose: {
    el: 'Μετρά επισκέψεις και προβολές σελίδων ανώνυμα (η διεύθυνση IP ανωνυμοποιείται), ώστε να καταλαβαίνουμε πώς χρησιμοποιείται ο ιστότοπος.',
    en: 'Counts visits and page views anonymously (the IP address is anonymised) so we can understand how the site is used.',
  },
  keys: [{ name: '_ga', kind: 'cookie' }],
};

/** `G-ABC1234567` → `ABC1234567`, or null when the stored value is not an ID. */
export function gaContainerId(gaId: string): string | null {
  const match = /^G-([A-Z0-9]{4,20})$/i.exec(gaId.trim());
  return match ? match[1] : null;
}
