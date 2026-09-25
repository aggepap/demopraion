import 'server-only';

import { asc, desc, eq } from 'drizzle-orm';

import { adapter, getDb, schema } from '../../db';
import type { Seo404LogEntry, SeoMeta, SeoRedirect } from '../../db/adapters/mysql/schema/seo';

export const REDIRECT_KINDS = ['literal', 'wildcard', 'regex'] as const;
export type RedirectKind = (typeof REDIRECT_KINDS)[number];

// ── Redirects ─────────────────────────────────────────────────────────────
/**
 * Redirects in the order they are matched, so the table can be read as the rule book.
 *
 * This used to sort newest-first while the resolver had no ordering at all and in practice
 * took the oldest — so the entry at the top of the screen, where the eye goes, was the one
 * that lost to the entry further down. Both use the same order now.
 */
export function listRedirects(): Promise<SeoRedirect[]> {
  return getDb().select().from(schema.seoRedirects).orderBy(asc(schema.seoRedirects.id));
}

export interface RedirectInput {
  source: string;
  target: string;
  statusCode?: number;
  kind?: RedirectKind;
  active?: boolean;
  notes?: string | null;
}

export async function createRedirect(input: RedirectInput, actorId: number | null): Promise<SeoRedirect> {
  const db = getDb();
  const res = await db.insert(schema.seoRedirects).values({
    source: input.source,
    target: input.target,
    statusCode: input.statusCode ?? 301,
    kind: input.kind ?? 'literal',
    active: input.active ?? true,
    notes: input.notes ?? null,
    createdBy: actorId,
  });
  const id = adapter.insertId(res);
  const [row] = await db.select().from(schema.seoRedirects).where(eq(schema.seoRedirects.id, id)).limit(1);
  return row;
}

export async function updateRedirect(id: number, patch: Partial<RedirectInput>): Promise<void> {
  const set: Record<string, unknown> = {};
  for (const k of ['source', 'target', 'statusCode', 'kind', 'active', 'notes'] as const) {
    if (patch[k] !== undefined) set[k] = patch[k];
  }
  if (Object.keys(set).length === 0) return;
  await getDb().update(schema.seoRedirects).set(set).where(eq(schema.seoRedirects.id, id));
}

export async function deleteRedirect(id: number): Promise<void> {
  await getDb().delete(schema.seoRedirects).where(eq(schema.seoRedirects.id, id));
}

// ── 404 log ───────────────────────────────────────────────────────────────
export function list404(limit = 100): Promise<Seo404LogEntry[]> {
  return getDb()
    .select()
    .from(schema.seo404Log)
    .orderBy(desc(schema.seo404Log.lastSeen))
    .limit(Math.min(500, Math.max(1, limit)));
}

export async function set404Ignored(id: number, ignored: boolean): Promise<void> {
  await getDb().update(schema.seo404Log).set({ ignored }).where(eq(schema.seo404Log.id, id));
}

export async function delete404(id: number): Promise<void> {
  await getDb().delete(schema.seo404Log).where(eq(schema.seo404Log.id, id));
}

// ── Per-path meta overrides ─────────────────────────────────────────────────
export function listMeta(): Promise<SeoMeta[]> {
  return getDb().select().from(schema.seoMeta).orderBy(schema.seoMeta.path);
}

export interface MetaInput {
  path: string;
  locale: string;
  title?: string | null;
  description?: string | null;
  robots?: string | null;
  canonical?: string | null;
  ogTitle?: string | null;
  ogDescription?: string | null;
  ogImage?: string | null;
}

export async function upsertMeta(input: MetaInput, actorId: number | null): Promise<void> {
  const fields = {
    title: input.title ?? null,
    description: input.description ?? null,
    robots: input.robots ?? null,
    canonical: input.canonical ?? null,
    ogTitle: input.ogTitle ?? null,
    ogDescription: input.ogDescription ?? null,
    ogImage: input.ogImage ?? null,
    updatedBy: actorId,
  };
  await getDb()
    .insert(schema.seoMeta)
    .values({ path: input.path, locale: input.locale, ...fields })
    .onDuplicateKeyUpdate({ set: fields });
}

/** The columns a partial meta write sets: every key supplied, `null` included. */
export function metaPatchColumns(
  input: Partial<MetaInput>,
): Partial<Record<Exclude<keyof MetaInput, 'path' | 'locale'>, string | null>> {
  const set: Partial<Record<Exclude<keyof MetaInput, 'path' | 'locale'>, string | null>> = {};
  for (const key of [
    'title',
    'description',
    'robots',
    'canonical',
    'ogTitle',
    'ogDescription',
    'ogImage',
  ] as const) {
    if (input[key] !== undefined) set[key] = input[key];
  }
  return set;
}

/**
 * Write only the keys actually supplied, leaving the rest of the row alone.
 *
 * `upsertMeta` above is a *whole-row* write: it builds every column with
 * `input.x ?? null` and hands the lot to `onDuplicateKeyUpdate`. That is right
 * for the admin screen, which always submits the complete form — and badly wrong
 * for any partial writer, because setting one field silently nulls the other
 * six. A machine pushing `og_title` alone would wipe an editor's hand-authored
 * title, description, robots and canonical on that path.
 *
 * The PM bridge needs this, but it is a latent footgun for anything that writes
 * a subset, so it lives here next to its sibling rather than in the bridge.
 *
 * A call with no writable keys is a no-op rather than an empty upsert, so the
 * caller does not have to check first.
 */
export async function patchMeta(
  input: { path: string; locale: string } & Partial<Omit<MetaInput, 'path' | 'locale'>>,
  actorId: number | null,
): Promise<void> {
  const set: Record<string, unknown> = metaPatchColumns(input);
  if (Object.keys(set).length === 0) return;
  set.updatedBy = actorId;

  await getDb()
    .insert(schema.seoMeta)
    .values({ path: input.path, locale: input.locale, ...set })
    .onDuplicateKeyUpdate({ set });
}

export async function deleteMeta(id: number): Promise<void> {
  await getDb().delete(schema.seoMeta).where(eq(schema.seoMeta.id, id));
}
