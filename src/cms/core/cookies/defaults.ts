/**
 * The catalogue a site starts with, and the entry that describes Google
 * Analytics.
 *
 * Two readers share this file on purpose. `seedCookieCatalog` writes the
 * categories into an empty database, and `withAnalyticsDeclaration` synthesizes
 * the analytics category when an admin has deleted it but still has a
 * measurement ID configured. If those two disagreed about what "analytics"
 * means, a visitor's stored consent for one would not apply to the other.
 *
 * No `server-only` here, and nothing site-specific: `AnalyticsLoader` (a client
 * component) reads `ANALYTICS_CATEGORY_KEY` from this module, and the CMS core
 * must stay extractable.
 */

/** Per-locale copy. The site's two locales are named so a missing one is a type
 *  error, and the index signature keeps it assignable to the column type. */
export interface LocaleText {
  el: string;
  en: string;
  [locale: string]: string;
}

export interface DefaultCookieService {
  name: string;
  provider: string | null;
  purpose: LocaleText;
}

export interface DefaultCookieCategory {
  key: string;
  name: LocaleText;
  description: LocaleText;
  required: boolean;
  sortOrder: number;
  services: readonly DefaultCookieService[];
}

/**
 * The category key GA is asked about. A cookie category with this key is what
 * makes analytics separately refusable; without one, `useCategoryConsent` falls
 * back to the blanket consent flag and GA rides in on any acceptance.
 */
export const ANALYTICS_CATEGORY_KEY = 'analytics';

/**
 * Google Analytics as it appears in the declaration.
 *
 * Not seeded — a site with no measurement ID must not claim to run GA. It is
 * added to the declaration only when an ID actually resolves.
 */
export const GOOGLE_ANALYTICS_SERVICE: DefaultCookieService = {
  name: 'Google Analytics 4',
  provider: 'Google',
  purpose: {
    el: 'Μετρά επισκέψεις και προβολές σελίδων ανώνυμα (η διεύθυνση IP ανωνυμοποιείται), ώστε να καταλαβαίνουμε πώς χρησιμοποιείται ο ιστότοπος.',
    en: 'Counts visits and page views anonymously (the IP address is anonymised) so we can understand how the site is used.',
  },
};

export const DEFAULT_COOKIE_CATEGORIES: readonly DefaultCookieCategory[] = [
  {
    key: 'necessary',
    name: { el: 'Απαραίτητα', en: 'Necessary' },
    description: {
      el: 'Χωρίς αυτά ο ιστότοπος δεν λειτουργεί: θυμούνται τη συνεδρία σας, το καλάθι σας και την ίδια σας την επιλογή για τα cookies. Δεν χρησιμοποιούνται για παρακολούθηση και δεν απενεργοποιούνται.',
      en: 'The site does not work without these: they remember your session, your basket, and your cookie choice itself. They are not used for tracking and cannot be switched off.',
    },
    required: true,
    sortOrder: 0,
    services: [
      {
        // Deliberately generic: the column is a single string with no locale
        // map, and this file is part of the reusable core.
        name: 'Session & consent',
        provider: null,
        purpose: {
          el: 'Κρατά τη συνεδρία σύνδεσης, το καλάθι αγορών και την καταγραφή της επιλογής σας για τα cookies.',
          en: 'Keeps the login session, the shopping basket, and the record of your cookie choice.',
        },
      },
    ],
  },
  {
    key: ANALYTICS_CATEGORY_KEY,
    name: { el: 'Στατιστικά', en: 'Analytics' },
    description: {
      el: 'Μας δείχνουν πώς χρησιμοποιείται ο ιστότοπος — ποιες σελίδες διαβάζονται και από πού έρχονται οι επισκέπτες — ώστε να τον βελτιώνουμε. Αν τα απορρίψετε, ο ιστότοπος λειτουργεί κανονικά.',
      en: 'They show us how the site is used — which pages are read, and where visitors arrive from — so we can improve it. Refusing them changes nothing about how the site works.',
    },
    required: false,
    sortOrder: 1,
    services: [],
  },
  {
    key: 'marketing',
    name: { el: 'Μάρκετινγκ', en: 'Marketing' },
    description: {
      el: 'Χρησιμοποιούνται για να σας εμφανίζονται σχετικές διαφημίσεις σε άλλους ιστότοπους και για να μετράται η απόδοσή τους.',
      en: 'Used to show you relevant advertising on other sites, and to measure how it performs.',
    },
    required: false,
    sortOrder: 2,
    services: [],
  },
];

/** The default definition of a category, by key. */
export function defaultCategory(key: string): DefaultCookieCategory | undefined {
  return DEFAULT_COOKIE_CATEGORIES.find((c) => c.key === key);
}
