/**
 * Redirects written by the CMS itself when a live document changes address.
 *
 * Changing the slug of a page visitors can already reach used to break every
 * link to it — bookmarks, search results, links from other sites — because the
 * old address simply stopped answering. Every write now reconciles the rules the
 * document owns for this reason (`reason = 'slug_change'`):
 *
 *   - a public document whose address changed → a 301 from the old address to
 *     the new one, in the document's own language;
 *   - earlier slug rules of the same document that pointed at the old address are
 *     moved on to the new one, so a page renamed twice is one hop, not two;
 *   - a slug rule whose source is now a live page's own address is removed —
 *     renaming back, or a new page taking an old address — or the proxy, which
 *     consults redirects before any route, would hide that page for good.
 *
 * Source and target are computed from the document, never taken from a request,
 * and both must be single-slash internal paths: this cannot become an open
 * redirect. A rule an admin wrote for the old address wins, as it does for the
 * unpublish rules next door (`unpublish-redirect.ts`), whose rows this never
 * touches.
 *
 * The decision is `planSlugChangeRedirect`, pure and tested;
 * `applySlugChangeRedirect` only gathers its inputs and carries it out.
 */
import { inArray } from 'drizzle-orm';

import type { ResolvedCollection } from '../../config';
import { getDb, schema } from '../../db';
import type { DocumentRow } from '../../db/adapters/mysql/schema/documents';
import { isDocumentVisible } from '../read/visibility';
import { redirectMatches, redirectWouldLoop } from './match';

/** `seo_redirects.reason` of a rule written by this module. */
export const SLUG_CHANGE_REASON = 'slug_change';

/** What an auto rule says about itself in the admin's redirect list. */
export const SLUG_CHANGE_NOTE = 'Auto: the page’s address changed — old links are sent to the new one';

export interface SlugRuleRow {
  id: number;
  source: string;
  target: string;
  kind: string;
  active: boolean;
  documentId: number | null;
  reason: string | null;
}

export interface SlugChangeInput {
  documentId: number;
  /** Could visitors reach the document at `oldPath` before this write? */
  wasPublic: boolean;
  /** Can visitors reach it at `newPath` after this write? */
  isPublic: boolean;
  /** Public path before the write, locale-prefixed; null when there was none. */
  oldPath: string | null;
  /** Public path after the write; null when the collection has no page. */
  newPath: string | null;
  /** Every stored redirect rule. */
  rules: ReadonlyArray<SlugRuleRow>;
}

export interface SlugChangePlan {
  create: { source: string; target: string } | null;
  /** This document's slug rules whose target becomes `newPath`. */
  retarget: number[];
  /** Slug rules (any document's) that would hide the live page at `newPath`. */
  remove: number[];
}

/** Relative, single-slash, no scheme: `//host` is protocol-relative and leaves the site. */
const isInternalPath = (p: string | null): p is string => p !== null && /^\/(?![/\\])/.test(p);

const isSlugRule = (r: SlugRuleRow): boolean => r.reason === SLUG_CHANGE_REASON;

export function planSlugChangeRedirect(input: SlugChangeInput): SlugChangePlan {
  const { oldPath, newPath, rules } = input;
  const remove =
    input.isPublic && isInternalPath(newPath)
      ? rules.filter((r) => isSlugRule(r) && redirectMatches(r.source, 'literal', newPath)).map((r) => r.id)
      : [];
  const none: SlugChangePlan = { create: null, retarget: [], remove };

  if (!input.wasPublic || !isInternalPath(oldPath) || !isInternalPath(newPath)) return none;
  if (redirectMatches(oldPath, 'literal', newPath)) return none;

  const remaining = rules.filter((r) => !remove.includes(r.id));
  const retarget = remaining
    .filter((r) => isSlugRule(r) && r.documentId === input.documentId && redirectMatches(r.target, 'literal', oldPath))
    .map((r) => r.id);

  // A rule already answering at the old address wins — an admin's (active or
  // disabled: it is still a decision about that URL, and `(source, kind)` is
  // unique) or anyone's automatic one.
  const taken = remaining.some((r) =>
    r.active ? redirectMatches(r.source, r.kind, oldPath) : r.kind === 'literal' && redirectMatches(r.source, 'literal', oldPath),
  );
  if (taken) return { ...none, retarget };

  // Loops are judged on the rules as they will be after this write.
  const after = remaining
    .filter((r) => r.active)
    .map((r) => (retarget.includes(r.id) ? { ...r, target: newPath } : r));
  if (redirectWouldLoop(after, oldPath, newPath)) return { ...none, retarget };

  return { create: { source: oldPath, target: newPath }, retarget, remove };
}

type Db = ReturnType<typeof getDb>;

/**
 * Reconcile slug redirects after a write. `before` is the row as it was (null on
 * create). Runs inside the caller's transaction; returns whether `seo_redirects`
 * changed, so the caller can purge the cached rule list once it has committed.
 */
export async function applySlugChangeRedirect(
  db: Db,
  collection: ResolvedCollection,
  before: DocumentRow | null,
  row: DocumentRow,
  pathFor: (collection: ResolvedCollection, slug: string, locale: string) => string | null,
  now: Date = new Date(),
): Promise<boolean> {
  const wasPublic = before !== null && isDocumentVisible(before, now);
  const isPublic = isDocumentVisible(row, now);
  if (!wasPublic && !isPublic) return false;
  const oldPath = before ? pathFor(collection, before.slug, before.locale) : null;
  const newPath = pathFor(collection, row.slug, row.locale);
  if (newPath === null) return false;
  const addressChanged = oldPath !== null && oldPath !== newPath;
  // An ordinary save of a live page, or a hidden page that kept its address:
  // nothing can have changed, so skip reading the rules on every save.
  if (!addressChanged && (wasPublic || !isPublic)) return false;

  const rules = await db
    .select({
      id: schema.seoRedirects.id,
      source: schema.seoRedirects.source,
      target: schema.seoRedirects.target,
      kind: schema.seoRedirects.kind,
      active: schema.seoRedirects.active,
      documentId: schema.seoRedirects.documentId,
      reason: schema.seoRedirects.reason,
    })
    .from(schema.seoRedirects);

  const plan = planSlugChangeRedirect({ documentId: row.id, wasPublic, isPublic, oldPath, newPath, rules });
  let changed = false;
  if (plan.remove.length > 0) {
    await db.delete(schema.seoRedirects).where(inArray(schema.seoRedirects.id, plan.remove));
    changed = true;
  }
  if (plan.retarget.length > 0) {
    await db.update(schema.seoRedirects).set({ target: newPath }).where(inArray(schema.seoRedirects.id, plan.retarget));
    changed = true;
  }
  if (plan.create) {
    await db.insert(schema.seoRedirects).values({
      source: plan.create.source,
      target: plan.create.target,
      statusCode: 301,
      kind: 'literal',
      active: true,
      notes: SLUG_CHANGE_NOTE,
      documentId: row.id,
      reason: SLUG_CHANGE_REASON,
      createdBy: null,
    });
    changed = true;
  }
  return changed;
}
