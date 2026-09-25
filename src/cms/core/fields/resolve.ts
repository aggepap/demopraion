import 'server-only';

import type { CmsConfig, ResolvedCollection } from '../../config';
import { notFound } from '../errors';
import {
  compileSeoGroup,
  resolveSeoFields,
  sanitizeSeoFieldOverrides,
  type SeoFieldOverrides,
} from '../seo/field-overrides';
import { SEO_FIELDS_DATA_KEY, type SeoFieldDef } from '../seo/fields';
import { CUSTOM_FIELDS_KEY, SEO_FIELDS_KEY, getSetting } from '../settings';
import {
  customFieldsForCollection,
  documentCategoryIds,
  visibleCustomFields,
  withCustomFields,
  type CustomFieldsConfig,
} from './definitions';

/**
 * Server-side resolution of a collection *including* its admin-defined custom
 * fields (see `definitions.ts`).
 *
 * Every caller that renders or validates a document's fields must go through
 * here rather than reading `config.collectionByKey` directly, or runtime fields
 * would be invisible to the admin form (and rejected by the validator).
 *
 * The read rides the existing settings cache (`unstable_cache`, tagged
 * `cms:settings`), which the settings PATCH already purges — so there's no new
 * invalidation path to maintain.
 */

/** The whole `Record<collectionKey, CustomFieldsConfig>` blob. */
export async function getAllCustomFields(): Promise<Record<string, unknown>> {
  const raw = await getSetting<Record<string, unknown>>(CUSTOM_FIELDS_KEY);
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

/** One collection's custom-field config, sanitised. */
export async function getCustomFieldsConfig(collectionKey: string): Promise<CustomFieldsConfig> {
  return customFieldsForCollection(await getAllCustomFields(), collectionKey);
}

/**
 * The admin's edits to the built-in SEO/AEO field set, sanitised.
 *
 * Rides the same settings cache as the custom fields, so there is still exactly
 * one invalidation path (the settings PATCH purges `cms:settings`).
 */
export async function getSeoFieldOverrides(): Promise<SeoFieldOverrides> {
  return sanitizeSeoFieldOverrides(await getSetting<unknown>(SEO_FIELDS_KEY));
}

/** The SEO fields a collection shows, in display order. Empty when the
 *  collection opts out of the SEO block (`seo: false`). */
export async function getSeoFieldsFor(collection: ResolvedCollection): Promise<SeoFieldDef[]> {
  if (!collection.seo) return [];
  return resolveSeoFields(await getSeoFieldOverrides(), collection.key);
}

export interface ResolveCollectionOptions {
  /**
   * The document's category ids, used for conditional visibility. Pass the
   * incoming `data` on a write so `required` matches what the editor saw.
   */
  categoryIds?: readonly number[];
  /** Convenience: derive `categoryIds` from a document's `data`. */
  data?: Record<string, unknown>;
  /**
   * Drop `required` on every custom field. Used when restoring a version: the
   * snapshot was valid under the definitions of its day, and a definition that
   * turned required since must not block the rollback.
   */
  relaxRequired?: boolean;
}

/**
 * A collection with its runtime custom fields merged in. Throws the standard
 * not-found error for an unknown key, matching the previous inline lookups.
 */
export async function resolveCollectionWithCustomFields(
  config: CmsConfig,
  key: string,
  opts: ResolveCollectionOptions = {},
): Promise<ResolvedCollection> {
  const collection = config.collectionByKey.get(key);
  if (!collection) throw notFound(`Unknown collection "${key}".`);
  return mergeCustomFields(config, collection, opts);
}

/** As above, for callers that already hold the resolved collection. */
export async function mergeCustomFields(
  config: CmsConfig,
  base: ResolvedCollection,
  opts: ResolveCollectionOptions = {},
): Promise<ResolvedCollection> {
  /*
   * A module's own settings-driven adjustment runs FIRST, so custom fields are
   * merged into the field set the site is actually using today. See
   * `FieldResolver` — the reason it lives here rather than at each call site is
   * that this function is the one path both the editor and the validator take.
   */
  const resolver = config.fieldResolvers[base.key];
  const resolved = resolver
    ? { ...base, fields: await resolver(base.fields, { data: opts.data }) }
    : base;

  const collection = await withSeoGroup(resolved, opts);

  const custom = await getCustomFieldsConfig(collection.key);
  if (custom.fields.length === 0) return collection;

  const categoryIds = opts.categoryIds ?? documentCategoryIds(opts.data);
  const visibleIds = opts.relaxRequired
    ? new Set<string>()
    : new Set(visibleCustomFields(custom, categoryIds).map((d) => d.id));
  return withCustomFields(collection, custom, {
    visibleIds,
    knownCollections: new Set(config.collectionByKey.keys()),
  });
}

/**
 * Append the built-in SEO/AEO group.
 *
 * Runs for EVERY collection with `seo: true` (all of them, today) and does not
 * depend on any stored setting, which is what makes the fields "always there":
 * an empty `cms.seoFields` row still resolves the full shipped set.
 *
 * A code-defined field keyed `seo` wins, same guard as `withCustomFields` —
 * a site that declares its own must not have it silently replaced.
 */
async function withSeoGroup(
  collection: ResolvedCollection,
  opts: ResolveCollectionOptions,
): Promise<ResolvedCollection> {
  if (!collection.seo) return collection;
  if (collection.fields.some((field) => field.key === SEO_FIELDS_DATA_KEY)) return collection;

  const defs = resolveSeoFields(await getSeoFieldOverrides(), collection.key);
  const group = compileSeoGroup(
    // Restoring a version must not be blocked by a field that turned required
    // after the snapshot was taken — the same reasoning as the custom fields.
    opts.relaxRequired ? defs.map((d) => ({ ...d, field: { ...d.field, required: false } })) : defs,
  );
  if (!group) return collection;
  return { ...collection, fields: [...collection.fields, group] };
}
