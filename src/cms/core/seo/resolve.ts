/**
 * Request-time SEO resolution used by the proxy (Node runtime) and the
 * not-found handler: match a path against the active redirects, and log
 * unmatched paths to the 404 monitor.
 *
 * NOT `server-only` — the proxy imports it. Every function is fail-open
 * (any error resolves to "no redirect" / a swallowed log) so SEO bookkeeping
 * can never break request handling. The active-redirect list is cached and
 * tag-revalidated on any redirect write.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { revalidateTag, unstable_cache } from 'next/cache';

import { getDb, schema } from '../../db';
import { localeKeyedPathCandidates } from './locale-path';
import { redirectMatches } from './match';
import { CMS_CACHE_REVALIDATE } from '../cache';

const REDIRECTS_TAG = 'cms:seo-redirects';
const META_TAG = 'cms:seo-meta';

interface ActiveRedirect {
  id: number;
  source: string;
  target: string;
  statusCode: number;
  kind: string;
}

const loadActiveRedirects = unstable_cache(
  async (): Promise<ActiveRedirect[]> => {
    const db = getDb();
    return db
      .select({
        id: schema.seoRedirects.id,
        source: schema.seoRedirects.source,
        target: schema.seoRedirects.target,
        statusCode: schema.seoRedirects.statusCode,
        kind: schema.seoRedirects.kind,
      })
      .from(schema.seoRedirects)
      .where(eq(schema.seoRedirects.active, true))
      /*
       * Explicit, and the same order the admin table shows.
       *
       * There was no `ORDER BY` here at all, so the winner among overlapping rules was
       * whatever the database happened to return first — in practice the oldest. Meanwhile
       * the admin list sorted newest-first, so the rule sitting at the top of the table,
       * looking the most important, was the one that lost. Someone adding a broader rule
       * over a path an older rule already covered saw it saved, saw it first in the list,
       * and watched the old target keep being served.
       *
       * Oldest first is the rule that is kept: it is what the resolver already did in
       * practice, so no live site changes behaviour today, and "the rule you wrote first
       * wins" is at least a sentence that can be put on the screen. The admin table now
       * sorts the same way and numbers the rows, so what is at the top is what wins.
       */
      .orderBy(asc(schema.seoRedirects.id));
  },
  ['cms-seo-active-redirects'],
  { tags: [REDIRECTS_TAG], revalidate: CMS_CACHE_REVALIDATE },
);

export { redirectMatches } from './match';

export interface RedirectMatch {
  id: number;
  target: string;
  statusCode: number;
}

/** First active redirect matching `path`, or null. Fail-open. */
export async function resolveRedirect(path: string): Promise<RedirectMatch | null> {
  let redirects: ActiveRedirect[];
  try {
    redirects = await loadActiveRedirects();
  } catch {
    return null;
  }
  for (const r of redirects) {
    if (redirectMatches(r.source, r.kind, path)) {
      return { id: r.id, target: r.target, statusCode: r.statusCode };
    }
  }
  return null;
}

/** Increment a redirect's hit counter (fire-and-forget). */
export async function bumpRedirectHit(id: number): Promise<void> {
  try {
    await getDb()
      .update(schema.seoRedirects)
      .set({ hits: sql`${schema.seoRedirects.hits} + 1`, lastHitAt: new Date() })
      .where(eq(schema.seoRedirects.id, id));
  } catch {
    /* swallow */
  }
}

/** Purge the cached active-redirect list after a redirect write. */
export function revalidateRedirects(): void {
  try {
    revalidateTag(REDIRECTS_TAG, { expire: 0 });
  } catch {
    /* outside request scope */
  }
}

export interface MetaOverride {
  title: string | null;
  description: string | null;
  robots: string | null;
  canonical: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
}

const loadMetaOverride = unstable_cache(
  async (path: string, locale: string): Promise<MetaOverride | null> => {
    const db = getDb();
    // Both spellings of the path: rows the PM bridge wrote before it keyed them
    // like every reader does were stored under the locale-prefixed URL.
    const rows = await db
      .select({
        path: schema.seoMeta.path,
        title: schema.seoMeta.title,
        description: schema.seoMeta.description,
        robots: schema.seoMeta.robots,
        canonical: schema.seoMeta.canonical,
        ogTitle: schema.seoMeta.ogTitle,
        ogDescription: schema.seoMeta.ogDescription,
        ogImage: schema.seoMeta.ogImage,
      })
      .from(schema.seoMeta)
      .where(
        and(inArray(schema.seoMeta.path, localeKeyedPathCandidates(path, locale)), eq(schema.seoMeta.locale, locale)),
      );
    const row = rows.find((r) => r.path === path) ?? rows[0];
    if (!row) return null;
    return {
      title: row.title,
      description: row.description,
      robots: row.robots,
      canonical: row.canonical,
      ogTitle: row.ogTitle,
      ogDescription: row.ogDescription,
      ogImage: row.ogImage,
    };
  },
  ['cms-seo-meta'],
  { tags: [META_TAG], revalidate: CMS_CACHE_REVALIDATE },
);

/** Admin-authored per-path meta override for (path, locale), or null.
 *  Best-effort: null on any failure (e.g. no DB at build time). */
export async function getMetaOverride(path: string, locale: string): Promise<MetaOverride | null> {
  try {
    return await loadMetaOverride(path, locale);
  } catch {
    return null;
  }
}

/** Purge cached meta overrides after a write. */
export function revalidateMeta(): void {
  try {
    revalidateTag(META_TAG, { expire: 0 });
  } catch {
    /* outside request scope */
  }
}

// ── Compiled <head> payloads (the PM bridge) ────────────────────────────────

const PAYLOAD_TAG = 'cms:pm-payload';

export interface HeadPayload {
  headMeta: Record<string, string | null> | null;
  jsonld: unknown;
  alternates: { hreflang: string; href: string }[] | null;
  /** True → this replaces the page's generated graph and outranks its columns. */
  seoOverride: boolean;
}

const loadHeadPayload = unstable_cache(
  async (path: string, locale: string): Promise<HeadPayload | null> => {
    const db = getDb();
    // Both spellings of the path: the bridge stored non-default-locale payloads
    // under the prefixed URL (`/en/foo`) before it keyed them like the readers.
    const rows = await db
      .select({
        path: schema.pmHeadPayloads.path,
        headMeta: schema.pmHeadPayloads.headMeta,
        jsonld: schema.pmHeadPayloads.jsonld,
        alternates: schema.pmHeadPayloads.alternates,
        seoOverride: schema.pmHeadPayloads.seoOverride,
      })
      .from(schema.pmHeadPayloads)
      .where(
        and(
          inArray(schema.pmHeadPayloads.path, localeKeyedPathCandidates(path, locale)),
          eq(schema.pmHeadPayloads.locale, locale),
        ),
      );
    const row = rows.find((r) => r.path === path) ?? rows[0];
    if (!row) return null;
    return {
      headMeta: row.headMeta,
      jsonld: row.jsonld,
      alternates: row.alternates,
      seoOverride: row.seoOverride === true,
    };
  },
  ['cms-pm-head-payload'],
  { tags: [PAYLOAD_TAG], revalidate: CMS_CACHE_REVALIDATE },
);

/**
 * The compiled payload for (path, locale), or null.
 *
 * Fail-open like its siblings: a page must never fail to render because the
 * bridge's table is unreachable. The worst outcome allowed is that the page
 * renders exactly as it did before PM was connected.
 */
export async function getHeadPayload(path: string, locale: string): Promise<HeadPayload | null> {
  try {
    return await loadHeadPayload(path, locale);
  } catch {
    return null;
  }
}

/** Purge cached payloads after a push. */
export function revalidatePayload(path?: string): void {
  try {
    revalidateTag(PAYLOAD_TAG, { expire: 0 });
    if (path) revalidateTag(`${PAYLOAD_TAG}:${path}`, { expire: 0 });
  } catch {
    /* outside request scope */
  }
}

/** Record an unmatched path in the 404 monitor (upsert + hit bump). Fail-open. */
export async function log404(
  path: string,
  locale: string | null,
  meta: { ua?: string | null; referrer?: string | null } = {},
): Promise<void> {
  try {
    await getDb()
      .insert(schema.seo404Log)
      .values({
        path,
        locale,
        userAgentSample: meta.ua ?? null,
        referrerSample: meta.referrer ?? null,
      })
      .onDuplicateKeyUpdate({
        set: { hits: sql`${schema.seo404Log.hits} + 1`, lastSeen: new Date() },
      });
  } catch {
    /* swallow */
  }
}
