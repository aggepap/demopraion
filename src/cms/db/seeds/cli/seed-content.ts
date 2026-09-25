/**
 * Populate a database from the committed content snapshot (see
 * `snapshot-content.ts`). Intended for a clean live database on first deploy.
 *
 *   npm run db:seed-content
 *
 * Matches documents by (type, slug, locale): one already present is skipped.
 * A new one keeps its original id when that id is free and gets a fresh one
 * when another document holds it (the run used to abort on the primary key
 * there); relation links are rewritten through the resulting id map, and an
 * already-present link is skipped — so re-running is safe. Every inserted
 * document gets its first `document_versions` row, as `createDocument` writes,
 * so the history panel and the optimistic-concurrency token start at 1 rather
 * than at an empty history. Editor ids are dropped (created_by/updated_by →
 * null), since admin-user ids differ per environment. Locale variants keep
 * their shared `translationGroupId`, so they show as one grouped entry.
 */
import '../../adapters/mysql/load-env';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { and, eq } from 'drizzle-orm';

import { editableSnapshot } from '../../../core/documents/snapshot';
import { getMysqlDb } from '../../adapters/mysql/client';
import type { DocumentStatus } from '../../adapters/mysql/schema/documents';
import { documentRelations, documents, documentVersions } from '../../adapters/mysql/schema';
import { adapter } from '../../index';
import { planSeedDocument, remapRelation } from '../content-plan';

interface SnapshotDoc {
  id: number;
  type: string;
  slug: string;
  locale: string;
  status: DocumentStatus;
  publishedAt: string | null;
  scheduledFor: string | null;
  modifiedAt: string | null;
  translationGroupId: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  canonicalPath: string | null;
  noindex: boolean;
  nofollow: boolean;
  includeInSitemap: boolean;
  ogImageUuid: string | null;
  data: Record<string, unknown>;
}
interface SnapshotRelation {
  fromId: number;
  toId: number;
  fieldKey: string;
  position: number;
}
interface Snapshot {
  generatedAt: string;
  documents: SnapshotDoc[];
  relations: SnapshotRelation[];
}

const FILE = join(process.cwd(), 'src/cms/db/seeds/data/content.json');
const toDate = (s: string | null) => (s ? new Date(s) : null);

async function main(): Promise<void> {
  if (!existsSync(FILE)) {
    console.error(
      `No content snapshot found at ${FILE}.\n` +
        'Generate it first from a database that has the content:\n' +
        '  npm run db:snapshot-content',
    );
    process.exit(1);
  }
  const snapshot = JSON.parse(readFileSync(FILE, 'utf8')) as Snapshot;
  const db = getMysqlDb();

  let created = 0;
  let renumbered = 0;
  let skipped = 0;
  /** Snapshot id → id in this database. */
  const idMap = new Map<number, number>();
  for (const doc of snapshot.documents) {
    const [existing] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.type, doc.type),
          eq(documents.slug, doc.slug),
          eq(documents.locale, doc.locale),
        ),
      )
      .limit(1);
    const [holder] = existing
      ? []
      : await db.select({ id: documents.id }).from(documents).where(eq(documents.id, doc.id)).limit(1);
    const plan = planSeedDocument(existing?.id, Boolean(holder));
    if (plan.kind === 'skip') {
      idMap.set(doc.id, plan.dbId);
      skipped++;
      continue;
    }
    const dbId = await db.transaction(async (tx) => {
      const result = await tx.insert(documents).values({
        ...(plan.keepId ? { id: doc.id } : {}),
        type: doc.type,
        slug: doc.slug,
        locale: doc.locale,
        status: doc.status,
        publishedAt: toDate(doc.publishedAt),
        scheduledFor: toDate(doc.scheduledFor),
        modifiedAt: toDate(doc.modifiedAt),
        translationGroupId: doc.translationGroupId,
        metaTitle: doc.metaTitle,
        metaDescription: doc.metaDescription,
        canonicalPath: doc.canonicalPath,
        noindex: doc.noindex,
        nofollow: doc.nofollow,
        includeInSitemap: doc.includeInSitemap,
        ogImageUuid: doc.ogImageUuid,
        data: doc.data,
        createdBy: null,
        updatedBy: null,
      });
      const id = plan.keepId ? doc.id : adapter.insertId(result);
      const [row] = await tx.select().from(documents).where(eq(documents.id, id)).limit(1);
      await tx.insert(documentVersions).values({
        documentId: id,
        version: 1,
        snapshot: editableSnapshot(row),
        createdBy: null,
      });
      return id;
    });
    idMap.set(doc.id, dbId);
    created++;
    if (!plan.keepId) renumbered++;
  }

  let relCreated = 0;
  let relSkipped = 0;
  for (const snapRel of snapshot.relations) {
    // Both endpoints must have been seeded or matched.
    const rel = remapRelation(snapRel, idMap);
    if (!rel) {
      relSkipped++;
      continue;
    }
    const [dup] = await db
      .select({ id: documentRelations.id })
      .from(documentRelations)
      .where(
        and(
          eq(documentRelations.fromId, rel.fromId),
          eq(documentRelations.toId, rel.toId),
          eq(documentRelations.fieldKey, rel.fieldKey),
        ),
      )
      .limit(1);
    if (dup) {
      relSkipped++;
      continue;
    }
    await db.insert(documentRelations).values({
      fromId: rel.fromId,
      toId: rel.toId,
      fieldKey: rel.fieldKey,
      position: rel.position,
    });
    relCreated++;
  }

  console.log(
    `Documents: ${created} inserted (${renumbered} under a new id), ${skipped} already present. ` +
      `Relations: ${relCreated} inserted, ${relSkipped} skipped.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
