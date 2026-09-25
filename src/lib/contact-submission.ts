/**
 * Turning a public contact-form POST into a `form_submissions` row.
 *
 * Lives here rather than in the route because a Next route module may only
 * export handlers, and this is the part worth testing: the page slug is derived
 * from a header the browser controls and written to a varchar(191).
 */
import type { NewSubmissionInput } from '@/cms/core/forms/service';
import { locales } from '@/lib/i18n/config';

/** The forms `/api/contact` serves. Kept in step with the route's zod union. */
export type ContactFormKind = 'contact';

/** `source_page_slug` is varchar(191) and `createSubmission` does not truncate it. */
const MAX_SLUG_LENGTH = 191;

/**
 * The page a form was submitted from, as a locale-independent path:
 * `/en/about?utm=x` → `/about`. Null rather than a throw on anything
 * unparseable — this runs before the enquiry is stored.
 */
export function pageSlugFromReferer(referer: string | null | undefined): string | null {
  if (!referer) return null;
  let pathname: string;
  try {
    ({ pathname } = new URL(referer));
  } catch {
    return null;
  }
  // Whole segments only: `/energy` starts with `en` and must stay `/energy`.
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length > 0 && (locales as readonly string[]).includes(segments[0])) {
    segments.shift();
  }
  return `/${segments.join('/')}`.slice(0, MAX_SLUG_LENGTH);
}

export interface ContactSubmissionSource {
  kind: ContactFormKind;
  email: string;
  locale?: string;
  /** The label/value rows already built for the notification email. */
  payload: Record<string, unknown>;
  /** The request headers — referrer and user-agent are read from here. */
  headers: Headers;
}

/** Build the row for a validated contact-form submission. */
export function contactSubmissionRecord(src: ContactSubmissionSource): NewSubmissionInput {
  const referer = src.headers.get('referer');
  return {
    formType: src.kind,
    email: src.email,
    payload: src.payload,
    sourcePageSlug: pageSlugFromReferer(referer),
    sourceLocale: src.locale ?? null,
    referrerUrl: referer,
    ua: src.headers.get('user-agent'),
  };
}
