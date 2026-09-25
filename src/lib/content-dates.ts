/**
 * Publication / modification dates for editorial content (articles,
 * answers, scenarios).
 *
 * Both values are hand-authored in the per-type metadata modules and are
 * the single source of truth for the visible `<time>` elements, the
 * JSON-LD `datePublished` / `dateModified`, and the Open Graph
 * `article:published_time` / `article:modified_time` tags.
 *
 * Why not derive `modifiedDate` from git
 * -------------------------------------
 * "Last commit that touched the file" is not the same as "the content
 * changed". Commit 245ead0 rewrote one markdown link target
 * (`/services/additional` → `/pricing`) across 10 MDX bodies without
 * altering a single word a reader sees — a git-derived date would have
 * claimed all ten were updated that day. The previous `getGitModifiedDate`
 * helper also silently fell back to the hardcoded value in production
 * (the Plesk build has no git history), so the "automatic" date never ran
 * where it mattered.
 *
 * The dates are therefore maintained by hand and guarded by
 * `scripts/check-content-dates.mjs`, which fails the deploy when an MDX
 * body changes without its `modifiedDate` moving forward.
 */
import type { Locale } from '@/lib/i18n/config';

/** `modifiedDate` is per-locale: editing the Greek body must not make the
 *  English page claim it was updated. `publishDate` stays shared — a piece
 *  is published once, in both languages, on the same day. */
export type ModifiedDates = Record<Locale, string>;

export interface ContentDates {
  /** `YYYY-MM-DD`. Immutable once set. */
  publishDate: string;
  modifiedDate: ModifiedDates;
}

const LOCALE_TAG: Record<Locale, string> = {
  el: 'el-GR',
  en: 'en-GB',
};

/**
 * `2026-05-06` → `6 Μαΐου 2026` (el) / `6 May 2026` (en).
 *
 * `Intl` already produces the Greek genitive month name, so no month table
 * is needed. The date is parsed and formatted in UTC: a bare `YYYY-MM-DD`
 * is parsed as midnight UTC, and formatting in a behind-UTC timezone would
 * otherwise render the previous day.
 */
export function formatContentDate(date: string, locale: Locale): string {
  return new Intl.DateTimeFormat(LOCALE_TAG[locale], {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

/**
 * True when the content has a modification worth surfacing. `YYYY-MM-DD`
 * strings compare lexicographically in chronological order, so no Date
 * construction is needed. Content that has never been revised carries
 * `modifiedDate === publishDate` and shows only the publication date.
 */
export function hasBeenModified(dates: ContentDates, locale: Locale): boolean {
  return dates.modifiedDate[locale] > dates.publishDate;
}

/**
 * The single date a listing card should carry: the revision date once the
 * piece has been revised, otherwise the publication date. Cards are dense
 * enough already — one date that is always the most recent one beats two
 * that the reader has to compare.
 */
export function latestContentDate(dates: ContentDates, locale: Locale): string {
  return hasBeenModified(dates, locale) ? dates.modifiedDate[locale] : dates.publishDate;
}
