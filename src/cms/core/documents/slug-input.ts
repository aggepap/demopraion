import { invalidInput } from '../errors';
import { slugify } from '../slug';

export const SLUG_UNUSABLE =
  'That address has no letters or numbers left once it is made URL-safe. Type a slug with some.';

/**
 * The slug an admin/API write stores, normalised by the same `slugify` the rest
 * of the CMS uses (Greek transliterated, lowercase, hyphenated, ASCII).
 *
 * The collection routes used to trim and length-check a slug and store the
 * rest verbatim, so "Νέα Άρθρα" or "My Post" went in as typed and produced an
 * address that had to be percent-encoded, or that differed by case from every
 * link anyone wrote to it.
 *
 * `keep` lists slugs that are already stored for this document (its own slug,
 * or its translation group's). One of those is passed back untouched: slugs
 * saved before this rule existed may not be normalised, and rewriting one on an
 * unrelated save would move a live page — so only a NEW slug is normalised.
 */
export function normalizeDocumentSlug(raw: string, keep: readonly (string | null | undefined)[] = []): string {
  const trimmed = raw.trim();
  if (keep.includes(trimmed)) return trimmed;
  const slug = slugify(trimmed);
  if (!slug) {
    throw invalidInput(
      { formErrors: [], fieldErrors: { slug: [SLUG_UNUSABLE] }, pathErrors: { slug: [SLUG_UNUSABLE] } },
      SLUG_UNUSABLE,
    );
  }
  return slug;
}
