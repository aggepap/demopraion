/**
 * The decisions `db:seed-content` makes, kept pure so they can be tested
 * without a database (see `cli/seed-content.ts`).
 *
 * The snapshot carries each document's original id so relation links can be
 * replayed. Inserting with that id is only safe when the id is free: on a
 * database that already has content, the same id can belong to a different
 * document, and the insert failed on the primary key and aborted the run. So a
 * document is matched by its natural key (type, slug, locale); its original id
 * is kept when free and replaced by a fresh one when not, and relation links
 * are rewritten through the resulting id map.
 */

export interface SnapshotKey {
  id: number;
  type: string;
  slug: string;
  locale: string;
}

export type SeedDocumentPlan =
  /** Already present under its natural key — leave it, map to its id. */
  | { kind: 'skip'; dbId: number }
  /** Insert. `keepId` says whether the snapshot's id is free to reuse. */
  | { kind: 'insert'; keepId: boolean };

export function naturalKey(doc: Pick<SnapshotKey, 'type' | 'slug' | 'locale'>): string {
  return `${doc.type}\u0000${doc.slug}\u0000${doc.locale}`;
}

/**
 * @param existingId the id of the row already stored under the doc's natural key
 * @param idTaken    whether the snapshot's id is used by some other row
 */
export function planSeedDocument(existingId: number | undefined, idTaken: boolean): SeedDocumentPlan {
  if (existingId !== undefined) return { kind: 'skip', dbId: existingId };
  return { kind: 'insert', keepId: !idTaken };
}

/**
 * A snapshot relation rewritten onto database ids, or null when either end
 * was never seeded (and so cannot be linked).
 */
export function remapRelation<R extends { fromId: number; toId: number }>(
  rel: R,
  idMap: ReadonlyMap<number, number>,
): R | null {
  const fromId = idMap.get(rel.fromId);
  const toId = idMap.get(rel.toId);
  if (fromId === undefined || toId === undefined) return null;
  return { ...rel, fromId, toId };
}
