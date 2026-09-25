// Not `server-only` — reused by the seed CLIs alongside the document service.
import { eq } from 'drizzle-orm';

import type { ResolvedCollection } from '../../config';
import { getDb, schema } from '../../db';

/**
 * Relation fields store their target ids in the document's `data` JSON (so the
 * edit form is simple), and those links are mirrored into `document_relations`
 * as a queryable reverse index. On every write we re-derive the index from
 * `data`, keeping the two in sync with the write path as the single authority.
 *
 * Phase 1 syncs top-level relation fields only; relation fields nested inside
 * repeaters/groups are still stored and validated in `data`, they just don't
 * populate the reverse index yet.
 */
export function extractRelationLinks(
  collection: ResolvedCollection,
  data: Record<string, unknown>,
): Array<{ fieldKey: string; toId: number; position: number }> {
  const links: Array<{ fieldKey: string; toId: number; position: number }> = [];
  for (const field of collection.fields) {
    if (field.kind !== 'relation') continue;
    const value = data[field.key];
    if (value == null) continue;
    const ids = field.many ? (Array.isArray(value) ? value : []) : [value];
    ids.forEach((id, position) => {
      if (typeof id === 'number' && Number.isInteger(id)) {
        links.push({ fieldKey: field.key, toId: id, position });
      }
    });
  }
  return links;
}

/** Replace the reverse-index rows for `fromId` with links derived from `data`.
 *  Pass an existing transaction/db handle so it participates in the write. */
export async function syncDocumentRelations(
  fromId: number,
  collection: ResolvedCollection,
  data: Record<string, unknown>,
  db: ReturnType<typeof getDb> = getDb(),
): Promise<void> {
  await db.delete(schema.documentRelations).where(eq(schema.documentRelations.fromId, fromId));
  const links = extractRelationLinks(collection, data);
  if (links.length === 0) return;
  await db
    .insert(schema.documentRelations)
    .values(links.map((l) => ({ fromId, toId: l.toId, fieldKey: l.fieldKey, position: l.position })));
}
