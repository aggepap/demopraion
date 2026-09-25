import 'server-only';

import { asc, eq } from 'drizzle-orm';
import { revalidateTag, unstable_cache } from 'next/cache';

import { adapter, getDb, schema } from '../../db';
import { CMS_CACHE_REVALIDATE } from '../cache';
import { invalidInput, notFound } from '../errors';
import type { SnippetInput, SnippetKind, SnippetRecord } from './schema';

const SCRIPTS_TAG = 'cms:scripts';

type Row = typeof schema.scriptSnippets.$inferSelect;

function toRecord(row: Row): SnippetRecord {
  return { ...row, kind: row.kind as SnippetKind };
}

export async function listSnippets(): Promise<SnippetRecord[]> {
  const rows = await getDb().select().from(schema.scriptSnippets).orderBy(asc(schema.scriptSnippets.name));
  return rows.map(toRecord);
}

/**
 * The snippet a `[script name="…"]` asks for, or null when there is no such
 * snippet or it is switched off. Cached per slug and cleared by every write.
 */
export async function getEnabledSnippetBySlug(slug: string): Promise<SnippetRecord | null> {
  const read = async () => {
    const [row] = await getDb()
      .select()
      .from(schema.scriptSnippets)
      .where(eq(schema.scriptSnippets.slug, slug))
      .limit(1);
    return row && row.enabled ? toRecord(row) : null;
  };
  try {
    return await unstable_cache(read, ['cms-script-snippet', slug], {
      tags: [SCRIPTS_TAG],
      revalidate: CMS_CACHE_REVALIDATE,
    })();
  } catch {
    // A page must render even when the snippet store cannot be read.
    return null;
  }
}

/**
 * A consent category must be one the site declares. Otherwise the snippet would
 * wait for a choice no visitor is ever offered, and silently never run.
 */
async function assertCategoryExists(key: string | null): Promise<void> {
  if (!key) return;
  const [row] = await getDb()
    .select({ id: schema.cookieCategories.id })
    .from(schema.cookieCategories)
    .where(eq(schema.cookieCategories.key, key))
    .limit(1);
  if (!row) {
    throw invalidInput(
      { formErrors: [], fieldErrors: { consentCategory: ['Unknown cookie category.'] } },
      'Choose a consent category from the Cookies screen.',
    );
  }
}

export async function createSnippet(input: SnippetInput): Promise<number> {
  await assertCategoryExists(input.consentCategory);
  const res = await getDb().insert(schema.scriptSnippets).values(input);
  return adapter.insertId(res);
}

export async function updateSnippet(id: number, input: SnippetInput): Promise<void> {
  await assertCategoryExists(input.consentCategory);
  const res = await getDb().update(schema.scriptSnippets).set(input).where(eq(schema.scriptSnippets.id, id));
  if (adapter.affectedRows(res) === 0) throw notFound('Snippet not found.');
}

export async function deleteSnippet(id: number): Promise<void> {
  const res = await getDb().delete(schema.scriptSnippets).where(eq(schema.scriptSnippets.id, id));
  if (adapter.affectedRows(res) === 0) throw notFound('Snippet not found.');
}

export function revalidateScripts(): void {
  try {
    revalidateTag(SCRIPTS_TAG, { expire: 0 });
  } catch {
    /* outside request scope */
  }
}
