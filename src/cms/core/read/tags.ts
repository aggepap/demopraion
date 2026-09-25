/**
 * Cache-tag conventions shared by the read helpers (which tag their
 * `unstable_cache` entries) and the write path (which revalidates them). This
 * is the wiring v1 never had — tag-based invalidation that actually fires on
 * every admin write (BACKEND.md §13.6).
 */
export const typeTag = (type: string) => `cms:type:${type}`;
export const docTag = (type: string, locale: string, slug: string) =>
  `cms:doc:${type}:${locale}:${slug}`;
export const pathTag = (path: string) => `cms:path:${path}`;
