import { revalidateTag } from 'next/cache';

import { docTag, pathTag, typeTag } from './tags';

// Next 16's `revalidateTag(tag, profile)` requires a cache-life profile; an
// `expire: 0` config marks the tagged entries stale immediately (a purge).
const PURGE = { expire: 0 } as const;

/**
 * Invalidate the read caches touched by a document write. Called by the route
 * factories after every create/update/delete so the public site reflects
 * changes immediately — the piece v1 was missing (BACKEND.md §13.6).
 *
 * Wrapped in try/catch: `revalidateTag` only works inside a request/route
 * context, so calling it from a seed CLI (no request) is a harmless no-op.
 */
export function revalidateDocument(row: {
  type: string;
  slug: string;
  locale: string;
  canonicalPath: string | null;
}): void {
  try {
    revalidateTag(typeTag(row.type), PURGE);
    revalidateTag(docTag(row.type, row.locale, row.slug), PURGE);
    if (row.canonicalPath) revalidateTag(pathTag(row.canonicalPath), PURGE);
  } catch {
    // Outside a request context (e.g. seeding) — nothing to revalidate.
  }
}

export function revalidateType(type: string): void {
  try {
    revalidateTag(typeTag(type), PURGE);
  } catch {
    /* no-op outside request context */
  }
}
