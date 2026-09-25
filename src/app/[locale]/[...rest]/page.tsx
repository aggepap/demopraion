import { redirect } from 'next/navigation';

import { log404 } from '@/cms/core/seo/resolve';
import { pageNotFoundPath } from '@/lib/i18n/page-not-found';

/**
 * Catch-all for unmatched in-locale URLs.
 *
 * Why `redirect()` to a real page instead of `notFound()`:
 * On Next 16.2.9 + Turbopack, a `notFound()` thrown from a `[...rest]`
 * catch-all renders through the framework's HTTP-error document
 * (`<html id="__next_error__">`), which sits OUTSIDE `[locale]/layout.tsx`.
 * Empirically (production build, verified 2026-06-22) that response ships:
 *   - NO CSS bundle linked  → the page is completely unstyled
 *   - an EMPTY server-rendered <body> (`<div hidden><!--$--><!--/$--></div>`);
 *     the `NotFoundContent` markup exists only in the RSC flight payload, so
 *     crawlers / no-JS clients see a blank page
 *   - no Header / Footer / `<html lang>` / global Organization JSON-LD
 * Deleting the catch-all is worse still — unmatched URLs then fall through
 * to the bare root `app/not-found.tsx` (hardcoded `lang="el"`, English
 * "Page not found", no chrome).
 *
 * Redirecting to a real `/page-not-found` route gives us instead:
 *   - Fully branded, styled UI with Header + Footer + localized H1 + 3 CTAs.
 *   - HTTP 307 from the unmatched URL, 200 from the destination.
 *   - The destination has `robots: { index: false, follow: false }`, so the
 *     307→200 "soft 404" is never indexed — it's a GSC coverage annotation,
 *     not a ranking signal.
 *
 * Trade-off: address bar shows `/page-not-found`, and GSC may list a
 * "Soft 404". Accepted as the lesser evil vs a blank/unstyled error page.
 * Revisit if a future Next release attaches the `notFound()` segment
 * boundary inside the locale layout (then switch to native `notFound()`).
 */
interface CatchAllProps {
  params: Promise<{ locale: string; rest: string[] }>;
}

export default async function LocaleCatchAll({ params }: CatchAllProps) {
  const { locale, rest } = await params;
  // Into the 404 monitor first, the same as `[slug]` does: this is where every
  // unmatched deeper URL lands, and the redirect below hides it from any log.
  // Redirect rules already ran in the proxy, so nothing here was redirected.
  await log404(`/${rest.join('/')}`, locale);
  redirect(pageNotFoundPath(locale));
}
