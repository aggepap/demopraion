import 'server-only';

import { asc, eq } from 'drizzle-orm';
import { revalidateTag, unstable_cache } from 'next/cache';

import { adapter, getDb, schema } from '../../db';
import { compareToDeclaration, detectServices, type CookieScan } from './scan';
import {
  cookiePolicyVersion,
  toConsentOptions,
  withAnalyticsDeclaration,
  type CategoryWithServices,
  type ConsentOptions,
} from './declaration';
import { ANALYTICS_GA_ID_KEY, resolveGaId } from '../settings/analytics';
import { getSetting } from '../settings';
import { CMS_CACHE_REVALIDATE } from '../cache';

const COOKIES_TAG = 'cms:cookies';

export { cookiePolicyVersion };
export type { CategoryWithServices };

/** Full catalog: categories (sorted) with their services nested. */
export async function listCookieCatalog(): Promise<CategoryWithServices[]> {
  const db = getDb();
  const [cats, svcs] = await Promise.all([
    db.select().from(schema.cookieCategories).orderBy(asc(schema.cookieCategories.sortOrder)),
    db.select().from(schema.cookieServices),
  ]);
  return cats.map((c) => ({ ...c, services: svcs.filter((s) => s.categoryId === c.id) }));
}

export interface CategoryInput {
  key: string;
  name: Record<string, string>;
  description?: Record<string, string> | null;
  required?: boolean;
  sortOrder?: number;
}

export async function createCategory(input: CategoryInput): Promise<number> {
  const res = await getDb().insert(schema.cookieCategories).values({
    key: input.key,
    name: input.name,
    description: input.description ?? null,
    required: input.required ?? false,
    sortOrder: input.sortOrder ?? 0,
  });
  return adapter.insertId(res);
}

export async function updateCategory(id: number, patch: Partial<CategoryInput>): Promise<void> {
  const set: Record<string, unknown> = {};
  for (const k of ['key', 'name', 'description', 'required', 'sortOrder'] as const) {
    if (patch[k] !== undefined) set[k] = patch[k];
  }
  if (Object.keys(set).length) {
    await getDb().update(schema.cookieCategories).set(set).where(eq(schema.cookieCategories.id, id));
  }
}

export async function deleteCategory(id: number): Promise<void> {
  await getDb().delete(schema.cookieCategories).where(eq(schema.cookieCategories.id, id));
}

export interface ServiceInput {
  categoryId: number;
  name: string;
  provider?: string | null;
  purpose?: Record<string, string> | null;
  enabled?: boolean;
}

export async function createService(input: ServiceInput): Promise<number> {
  const res = await getDb().insert(schema.cookieServices).values({
    categoryId: input.categoryId,
    name: input.name,
    provider: input.provider ?? null,
    purpose: input.purpose ?? null,
    enabled: input.enabled ?? true,
  });
  return adapter.insertId(res);
}

export async function updateService(id: number, patch: Partial<Omit<ServiceInput, 'categoryId'>>): Promise<void> {
  const set: Record<string, unknown> = {};
  for (const k of ['name', 'provider', 'purpose', 'enabled'] as const) {
    if (patch[k] !== undefined) set[k] = patch[k];
  }
  if (Object.keys(set).length) {
    await getDb().update(schema.cookieServices).set(set).where(eq(schema.cookieServices.id, id));
  }
}

export async function deleteService(id: number): Promise<void> {
  await getDb().delete(schema.cookieServices).where(eq(schema.cookieServices.id, id));
}

/** Cached, best-effort read of the stored catalogue — the rows as an admin left
 *  them, before anything is derived. Returns [] on any failure (e.g. no DB at
 *  build) so it never breaks the page. Public readers want
 *  `getPublicCookieDeclaration`, which is this plus what the site actually loads. */
export async function getCookieCatalogPublic(): Promise<CategoryWithServices[]> {
  try {
    return await unstable_cache(async () => listCookieCatalog(), ['cms-cookie-catalog'], {
      tags: [COOKIES_TAG],
      revalidate: CMS_CACHE_REVALIDATE,
    })();
  } catch {
    return [];
  }
}

export interface ConsentRecord {
  visitorRef: string;
  decision: 'accepted' | 'rejected' | 'custom';
  categories: Record<string, boolean>;
  policyVersion?: string | null;
  locale?: string | null;
  ua?: string | null;
}

/**
 * Write down what a visitor decided.
 *
 * Appended, never updated: a change of mind is a second record, because the point
 * of this table is what was true at a given moment. Overwriting the row would
 * destroy the only evidence that the earlier state ever existed.
 */
export async function recordConsent(input: ConsentRecord): Promise<number> {
  const [res] = await getDb().insert(schema.cookieConsents).values({
    visitorRef: input.visitorRef.slice(0, 64),
    decision: input.decision,
    categories: input.categories,
    policyVersion: input.policyVersion?.slice(0, 64) ?? null,
    locale: input.locale?.slice(0, 8) ?? null,
    ua: input.ua?.slice(0, 255) ?? null,
  });
  return Number((res as { insertId: number | string }).insertId);
}

/**
 * The declaration as a visitor is actually shown it: the stored catalogue plus
 * Google Analytics whenever a measurement ID resolves.
 *
 * Two reads, composed here rather than nested. `getCookieCatalogPublic` is cached
 * under `cms:cookies` and the setting under `cms:setting:*`; folding the setting
 * into the cookie cache would leave a just-changed measurement ID undeclared for
 * up to five minutes, because the settings write revalidates the other tag.
 */
export async function getPublicCookieDeclaration(): Promise<CategoryWithServices[]> {
  const [catalog, stored] = await Promise.all([
    getCookieCatalogPublic(),
    getSetting<string>(ANALYTICS_GA_ID_KEY),
  ]);
  return withAnalyticsDeclaration(catalog, resolveGaId(stored));
}

/**
 * What the banner needs: the categories a visitor can actually decide about, with
 * the services named under each, and the stamp of this exact declaration.
 */
export async function getConsentOptions(): Promise<ConsentOptions> {
  return toConsentOptions(await getPublicCookieDeclaration());
}

/**
 * What the site stores, against what it declares.
 *
 * Reads the same two sources the public declaration does, so the admin is told
 * about the site visitors actually get — including the analytics entry that is
 * declared automatically rather than stored.
 */
export async function getCookieScan(storagePrefix: string): Promise<CookieScan> {
  const [declaration, stored] = await Promise.all([
    getPublicCookieDeclaration(),
    getSetting<string>(ANALYTICS_GA_ID_KEY),
  ]);
  return compareToDeclaration(
    detectServices({ gaId: resolveGaId(stored), storagePrefix }),
    declaration,
  );
}

/** Purge the cached public catalog after an admin write. */
export function revalidateCookies(): void {
  try {
    revalidateTag(COOKIES_TAG, { expire: 0 });
  } catch {
    /* outside request scope */
  }
}
