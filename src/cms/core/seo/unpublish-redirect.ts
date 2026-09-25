/**
 * Redirects written by the CMS itself when a post goes dark.
 *
 * A published post moved back to draft, or archived, used to leave its URL
 * falling through to the page-not-found screen. For a collection that declares
 * `unpublishRedirect`, every write now reconciles one `seo_redirects` row owned
 * by the document (`document_id`):
 *
 *   - not live, and once published → a rule from its URL to its first live
 *     category (302 while a draft, 301 once archived), or to the category
 *     overview when it has none;
 *   - live again → the rule is removed, or it would shadow the page forever —
 *     the proxy consults redirects before any route.
 *
 * Source and target are computed here, never taken from a request, and the
 * target is always a single-slash internal path: this cannot become an open
 * redirect. A rule an admin already wrote for the same URL wins.
 *
 * The decision is `planUnpublishRedirect`, pure and tested; `applyUnpublishRedirect`
 * only gathers its inputs and carries it out.
 */
import { and, eq, inArray, isNull, ne, or } from 'drizzle-orm';

import type { CmsConfig, ResolvedCollection, UnpublishRedirectDefinition } from '../../config';
import { getDb, schema } from '../../db';
import type { DocumentRow } from '../../db/adapters/mysql/schema/documents';
import { isDocumentVisible } from '../read/visibility';
import { isModuleEnabled } from '../settings/modules';
import { redirectMatches, redirectWouldLoop, type RedirectRuleLike } from './match';

export interface UnpublishRedirectInput {
  spec: UnpublishRedirectDefinition | undefined;
  doc: { status: string; publishedAt: Date | string | null; locale: string };
  /** The post's public path in its own locale, or null when it has none. */
  sourcePath: string | null;
  /** Paths of the post's LIVE categories, in field order, already locale-prefixed. */
  categoryPaths: string[];
  defaultLocale: string;
  /**
   * False while the collection's module is switched off: its pages 404 on purpose,
   * so a redirect would only send visitors to another 404. Default true.
   */
  moduleEnabled?: boolean;
  /** Every rule not owned by this document; `active: false` marks a disabled one. */
  otherRules: ReadonlyArray<RedirectRuleLike & { active?: boolean }>;
}

export type UnpublishRedirectPlan =
  | { kind: 'upsert'; source: string; target: string; statusCode: 301 | 302 }
  | { kind: 'remove' }
  | { kind: 'none' };

/** Relative, single-slash, no scheme: `//host` is protocol-relative and leaves the site. */
const isInternalPath = (p: string): boolean => /^\/(?![/\\])/.test(p);

const isLive = (status: string): boolean => status === 'published' || status === 'scheduled';

export function planUnpublishRedirect(input: UnpublishRedirectInput): UnpublishRedirectPlan {
  const { spec, doc, sourcePath } = input;
  if (!spec) return { kind: 'none' };
  if (isLive(doc.status) || input.moduleEnabled === false) return { kind: 'remove' };
  // A document never published had no public URL anyone could have reached.
  if (!doc.publishedAt || !sourcePath || !isInternalPath(sourcePath)) return { kind: 'none' };
  const active = input.otherRules.filter((r) => r.active !== false);
  // An admin's rule for this URL wins. A disabled one too: it is still an explicit
  // decision about the URL, and `(source, kind)` is unique, so writing beside it
  // would fail the post's own save.
  if (active.some((r) => redirectMatches(r.source, r.kind, sourcePath))) return { kind: 'none' };
  if (input.otherRules.some((r) => r.kind === 'literal' && redirectMatches(r.source, 'literal', sourcePath))) {
    return { kind: 'none' };
  }

  const fallback = doc.locale === input.defaultLocale ? spec.fallbackPath : `/${doc.locale}${spec.fallbackPath}`;
  const target = [...input.categoryPaths, fallback].find(
    (candidate) =>
      isInternalPath(candidate) &&
      !redirectMatches(sourcePath, 'literal', candidate) &&
      !redirectWouldLoop(active, sourcePath, candidate),
  );
  if (!target) return { kind: 'none' };
  return { kind: 'upsert', source: sourcePath, target, statusCode: doc.status === 'archived' ? 301 : 302 };
}

/**
 * The path a term sends an unpublished document's visitors to, in the document's
 * locale: `termPathTemplate` when the spec has one (a filtered listing), else the
 * term collection's own page. Null when the term has neither.
 */
export function termRedirectPath(
  spec: UnpublishRedirectDefinition,
  termCollection: ResolvedCollection,
  slug: string,
  locale: string,
  defaultLocale: string,
): string | null {
  const template = spec.termPathTemplate;
  if (!template) return resolvePathFor(termCollection.routing.pathTemplate, slug, locale, defaultLocale);
  // In a query string a raw `&` or space would change the meaning of the URL.
  const encoded = template.includes('?') && template.indexOf('?') < template.indexOf('{slug}') ? encodeURIComponent(slug) : slug;
  return resolvePathFor(template, encoded, locale, defaultLocale);
}

function resolvePathFor(template: string | undefined, slug: string, locale: string, defaultLocale: string): string | null {
  if (!template) return null;
  const path = template.replace('{slug}', slug);
  return locale === defaultLocale ? path : `/${locale}${path}`;
}

type Db = ReturnType<typeof getDb>;

/** `seo_redirects.reason` of a rule written by this module. */
export const UNPUBLISH_REASON = 'unpublish';

/** What an auto rule says about itself in the admin's redirect list. */
export const UNPUBLISH_REDIRECT_NOTE = 'Auto: post unpublished — removed when it is published again';

/**
 * Reconcile the redirect owned by `row` after a write. Runs inside the caller's
 * transaction; returns whether `seo_redirects` changed, so the caller can purge
 * the cached rule list once the transaction has committed.
 */
export async function applyUnpublishRedirect(
  db: Db,
  config: CmsConfig,
  collection: ResolvedCollection,
  row: DocumentRow,
  pathFor: (collection: ResolvedCollection, slug: string, locale: string) => string | null,
): Promise<boolean> {
  const spec = collection.unpublishRedirect;
  if (!spec) return false;
  // Only this module's rule: the document may also own slug-change redirects
  // (`slug-change-redirect.ts`), which must survive it going live. A null reason
  // is a row written before the column existed, when unpublish was the only kind.
  const owned = and(
    eq(schema.seoRedirects.documentId, row.id),
    or(eq(schema.seoRedirects.reason, UNPUBLISH_REASON), isNull(schema.seoRedirects.reason)),
  );
  const moduleEnabled = await collectionModuleEnabled(config, collection);

  if (isLive(row.status) || !moduleEnabled) {
    const [existing] = await db.select({ id: schema.seoRedirects.id }).from(schema.seoRedirects).where(owned).limit(1);
    if (!existing) return false;
    await db.delete(schema.seoRedirects).where(owned);
    return true;
  }
  if (!row.publishedAt) return false;

  const sourcePath = pathFor(collection, row.slug, row.locale);
  const categoryPaths = await liveTermPaths(db, config, collection, row);
  const otherRules = await db
    .select({
      source: schema.seoRedirects.source,
      kind: schema.seoRedirects.kind,
      target: schema.seoRedirects.target,
      active: schema.seoRedirects.active,
    })
    .from(schema.seoRedirects)
    .where(
      or(
        isNull(schema.seoRedirects.documentId),
        ne(schema.seoRedirects.documentId, row.id),
        ne(schema.seoRedirects.reason, UNPUBLISH_REASON),
      ),
    );

  const plan = planUnpublishRedirect({
    spec,
    doc: row,
    sourcePath,
    categoryPaths,
    defaultLocale: config.defaultLocale,
    moduleEnabled,
    otherRules,
  });
  if (plan.kind !== 'upsert') return false;

  const values = {
    source: plan.source,
    target: plan.target,
    statusCode: plan.statusCode,
    kind: 'literal' as const,
    active: true,
    notes: UNPUBLISH_REDIRECT_NOTE,
    documentId: row.id,
    reason: UNPUBLISH_REASON,
  };
  const [existing] = await db
    .select({ id: schema.seoRedirects.id, source: schema.seoRedirects.source, target: schema.seoRedirects.target, statusCode: schema.seoRedirects.statusCode })
    .from(schema.seoRedirects)
    .where(owned)
    .limit(1);
  if (existing) {
    if (existing.source === values.source && existing.target === values.target && existing.statusCode === values.statusCode) {
      return false;
    }
    await db.update(schema.seoRedirects).set(values).where(eq(schema.seoRedirects.id, existing.id));
  } else {
    await db.insert(schema.seoRedirects).values({ ...values, createdBy: null });
  }
  return true;
}

/** Public paths of the post's live terms, in field order, in the POST's locale. */
async function liveTermPaths(
  db: Db,
  config: CmsConfig,
  collection: ResolvedCollection,
  row: DocumentRow,
): Promise<string[]> {
  const spec = collection.unpublishRedirect;
  if (!spec) return [];
  const field = collection.fields.find((x) => x.key === spec.taxonomyField);
  if (!field || field.kind !== 'relation') return [];
  const termCollection = config.collectionByKey.get(field.to);
  if (!termCollection) return [];

  const raw = (row.data as Record<string, unknown> | null)?.[field.key];
  const ids = (Array.isArray(raw) ? raw : [raw]).filter((v): v is number => typeof v === 'number' && Number.isInteger(v));
  if (ids.length === 0) return [];

  const terms = await db
    .select({
      id: schema.documents.id,
      slug: schema.documents.slug,
      status: schema.documents.status,
      scheduledFor: schema.documents.scheduledFor,
    })
    .from(schema.documents)
    .where(and(eq(schema.documents.type, termCollection.key), inArray(schema.documents.id, ids)));
  const byId = new Map(terms.map((t) => [t.id, t]));
  const now = new Date();
  return ids
    .map((id) => byId.get(id))
    .filter((t): t is (typeof terms)[number] => t !== undefined && isDocumentVisible(t, now))
    // Terms are one document in the default locale; the URL still follows the post's language.
    .map((t) => termRedirectPath(spec, termCollection, t.slug, row.locale, config.defaultLocale))
    .filter((p): p is string => p !== null);
}

/**
 * Is the collection's module on? A collection with no module always is. The flag
 * lives in settings; if they cannot be read (a seed CLI outside Next, a cold
 * database) the config's own default decides, rather than failing the save.
 */
async function collectionModuleEnabled(config: CmsConfig, collection: ResolvedCollection): Promise<boolean> {
  if (!collection.module) return true;
  try {
    return await isModuleEnabled(config, collection.module);
  } catch {
    return Boolean(config.modules[collection.module as keyof typeof config.modules]);
  }
}
