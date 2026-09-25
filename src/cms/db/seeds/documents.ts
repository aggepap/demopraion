/**
 * Shared helpers for a site's document seeders.
 *
 * Site code binds these to its own config (the core cannot import
 * `@/site.config`), then seeds one document per (type, slug, locale).
 */
import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import type { CmsConfig } from '../../config';
import { createDocument, updateDocument, type DocumentWriteInput } from '../../core/documents/service';
import { getDb, schema } from '../index';

import { seedAction, type SeedAction, type SeedMode } from './seed-mode';

/**
 * The translation group id shared by every locale variant of a (type, slug).
 *
 * Reuses an existing group id when any variant of the slug is already seeded,
 * otherwise mints a fresh UUID. Because every locale of a slug is written with
 * the same id, the admin shows one grouped entry per document — and re-running
 * a seeder repairs any pre-existing rows whose locales were never linked
 * (their ids converge onto the reused/first value). Idempotent.
 */
export async function resolveTranslationGroupId(type: string, slug: string): Promise<string> {
  const db = getDb();
  const rows = await db
    .select({ groupId: schema.documents.translationGroupId })
    .from(schema.documents)
    .where(and(eq(schema.documents.type, type), eq(schema.documents.slug, slug)));
  return rows.find((r) => r.groupId)?.groupId ?? randomUUID();
}

/**
 * Store one seeded document, honouring the run's mode: created when absent,
 * overwritten only under `--force`, otherwise left exactly as the editor left it.
 *
 * Shared so that "skip unless forced" is a single decision rather than one per
 * seeder that has to be kept in agreement.
 */
export async function applySeedDocument(
  config: CmsConfig,
  type: string,
  slug: string,
  locale: string,
  mode: SeedMode,
  input: DocumentWriteInput,
): Promise<SeedAction> {
  const db = getDb();
  const [existing] = await db
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.type, type),
        eq(schema.documents.slug, slug),
        eq(schema.documents.locale, locale),
      ),
    )
    .limit(1);

  const action = seedAction(Boolean(existing), mode);
  if (action === 'update' && existing) await updateDocument(config, existing.id, input, null);
  if (action === 'create') await createDocument(config, type, input, null);
  return action;
}
