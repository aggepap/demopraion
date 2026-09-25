/**
 * Which page "Preview draft" should open.
 *
 * The edit screen is one URL for a whole translation group: the row id in the
 * address is simply the variant that was opened, and the language tabs move a
 * `?locale=` parameter rather than navigating to the sibling row. So the
 * preview link cannot be built from the opened row — an editor working on the
 * English tab would be sent to the Greek article, which is the one whose id is
 * in the URL.
 *
 * Pure, so the rule is testable without a request.
 */

export interface PreviewCandidate {
  locale: string;
  /** The public path, or null for a collection with no public page. */
  canonicalPath: string | null;
}

export interface PreviewTarget {
  path: string;
  locale: string;
}

/**
 * The variant the editor is looking at, or `null` when there is nothing to
 * preview — a language with no saved row yet, or one with no public page.
 *
 * `null` rather than a fallback on purpose: opening SOME other language is
 * exactly the confusion this exists to prevent, so the button is hidden
 * instead.
 */
export function previewTargetFor(
  group: readonly PreviewCandidate[],
  requestedLocale: string | null,
  opened: PreviewCandidate
): PreviewTarget | null {
  const variant = requestedLocale
    ? group.find((candidate) => candidate.locale === requestedLocale)
    : opened;
  if (!variant?.canonicalPath) return null;
  return { path: variant.canonicalPath, locale: variant.locale };
}
