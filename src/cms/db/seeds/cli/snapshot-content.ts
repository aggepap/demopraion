/**
 * Export the DB's content into a committed JSON snapshot, so a clean live
 * database can be populated by replaying it (see `seed-content.ts`).
 *
 *   npm run db:snapshot-content
 *
 * Dumps every `documents` row (all columns except editor ids + technical
 * timestamps) and every `document_relations` link. Document ids are preserved
 * so the relation links stay valid when replayed into a fresh database. The
 * snapshot is generated FROM the database — content is still authored only in
 * the DB/admin; this file is a build artifact, not hand-written content.
 */
import '../../adapters/mysql/load-env';

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { getMysqlDb } from '../../adapters/mysql/client';
import { documentRelations, documents } from '../../adapters/mysql/schema';

const OUT = join(process.cwd(), 'src/cms/db/seeds/data/content.json');
const iso = (d: Date | null) => (d ? d.toISOString() : null);

async function main(): Promise<void> {
  const db = getMysqlDb();

  const docs = await db.select().from(documents);
  const rels = await db.select().from(documentRelations);

  const snapshot = {
    generatedAt: new Date().toISOString(),
    documents: docs
      .sort((a, b) => a.id - b.id)
      .map((d) => ({
        id: d.id,
        type: d.type,
        slug: d.slug,
        locale: d.locale,
        status: d.status,
        publishedAt: iso(d.publishedAt),
        scheduledFor: iso(d.scheduledFor),
        modifiedAt: iso(d.modifiedAt),
        translationGroupId: d.translationGroupId,
        metaTitle: d.metaTitle,
        metaDescription: d.metaDescription,
        canonicalPath: d.canonicalPath,
        noindex: d.noindex,
        nofollow: d.nofollow,
        includeInSitemap: d.includeInSitemap,
        ogImageUuid: d.ogImageUuid,
        data: d.data,
      })),
    relations: rels
      .sort((a, b) => a.fromId - b.fromId || a.toId - b.toId)
      .map((r) => ({ fromId: r.fromId, toId: r.toId, fieldKey: r.fieldKey, position: r.position })),
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  console.log(
    `Wrote ${snapshot.documents.length} document(s) + ${snapshot.relations.length} relation(s) ` +
      `to ${relative(process.cwd(), OUT)}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
