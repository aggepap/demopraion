/**
 * The slug to hold after a save: the one the server stored, not the one typed.
 *
 * The create and PATCH routes normalise a new slug (`core/slug.ts` — "My Post"
 * becomes `my-post`). The form went on showing what was typed until a reload,
 * compared the next save against it, and copied the TYPED spelling to the
 * other languages — which the server then normalised again, one PATCH per
 * language, for a change nobody made.
 *
 * Falls back to the typed value when the response carries no usable slug, so
 * an unexpected response shape never blanks the field.
 */
export function slugAfterSave(typed: string, saved: { slug?: unknown } | null | undefined): string {
  const stored = saved?.slug;
  return typeof stored === 'string' && stored !== '' ? stored : typed;
}
