import type { DocumentRow } from '../../db/adapters/mysql/schema/documents';

/**
 * Is the document in front of the public right now: `published`, or `scheduled`
 * whose `scheduledFor` has passed. Its own module so the write path (unpublish
 * redirects) judges a category live by the same rule the public read layer does.
 */
export function isDocumentVisible(row: Pick<DocumentRow, 'status' | 'scheduledFor'>, now: Date = new Date()): boolean {
  if (row.status === 'published') return true;
  // `scheduledFor` may be a string on an unstable_cache hit — coerce to Date.
  return row.status === 'scheduled' && row.scheduledFor != null && new Date(row.scheduledFor) <= now;
}
