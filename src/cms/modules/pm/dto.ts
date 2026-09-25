import 'server-only';

import { inArray } from 'drizzle-orm';

import {
  PM_EDITABLE_FIELD_KEYS,
  walkFields,
  type CmsConfig,
  type Field,
  type ResolvedCollection,
} from '../../config';
import { documentSeo } from '../../core/seo/document';
import { mediaUrl } from '../../core/media/service';
import { getDb, schema } from '../../db';
import type { DocumentRow } from '../../db/adapters/mysql/schema/documents';
import { encodeRemoteId } from './identity';
import {
  absoluteUrl,
  flattenTitle,
  formatRobots,
  getAtPath,
  permalinkFor,
  toPmStatus,
} from './mapping';

/**
 * The item shape Product Manager ingests.
 *
 * Deliberately snake_case: this is PM's vocabulary, not praion's, and the
 * translation happens once here rather than being half-applied at four call
 * sites. `null` for an absent scalar and `[]` for an absent list — never an
 * omitted key — so PM can tell "we have no value" from "praion does not support
 * this field".
 */
export interface PmImage {
  /** The media uuid. The pivot of alt-text writes — see `applyImageAlts`. */
  id: string;
  src: string;
  /** The *effective* alt: the row's own, else the library default, else ''. */
  alt: string;
  position: number;
}

export interface PmSeoBlock {
  seo_title: string | null;
  meta_description: string | null;
  focus_keywords: string[];
  og_title: string | null;
  og_description: string | null;
  og_image: string | null;
  twitter_card: string | null;
  canonical_url: string | null;
  robots: string;
  include_in_sitemap: boolean;
  schema_raw_override: unknown;
  faqs: { question: string; answer: string }[];
  key_facts: string[];
  answer_summary: string | null;
  pros_cons: { pro: string; con: string }[];
}

export interface PmItem {
  id: number;
  remote_type: string;
  /**
   * WHICH collection this document belongs to (`article`, `answer`, `booking`,
   * …), matching the `key` of the content-type manifest entry.
   *
   * `remote_type` cannot answer that: it is PM's page-type vocabulary, and four
   * collections here share `wp_post`. Sending only the page type left PM with
   * an undifferentiated pile of "posts" in which an Experience and an Article
   * were the same thing — so PM could not offer a per-collection view, and
   * enriching one collection specifically was impossible.
   *
   * Both are sent because both are true and neither implies the other: PM keys
   * its editing rules on the page type and its lists on this.
   */
  content_type: string;
  remote_id: string;
  name: string | null;
  slug: string;
  status: 'publish' | 'draft';
  permalink: string | null;
  locale: string;
  description: string | null;
  short_description: string | null;
  images: PmImage[];
  seo: PmSeoBlock;
  modified_at: string | null;
  editable: string[];
  /**
   * Storage format per field, for the fields that are not plain prose (today:
   * MDX bodies). Absent key ⇒ ordinary text. See `fieldFormats`.
   */
  formats: Record<string, string>;
  // Products only.
  sku?: string | null;
  price?: number | null;
  currency?: string;
  categories?: string[];
  tags?: string[];
}

/** The gallery contract: a repeater whose children include `image` and `alt`. */
export interface GalleryPath {
  /** Dot path of the repeater itself, e.g. `gallery`. */
  path: string;
  imageKey: string;
  altKey: string;
}

/**
 * Find every repeater that pairs an image with a sibling `alt` text field.
 *
 * That pair *is* the bridge's contract for writable alt text — both
 * `productCollection` and `bookingCollection` already follow it. Discovering it
 * from the field tree rather than hardcoding paths means a site that adds
 * another gallery gets alt-text support without touching the bridge.
 */
export function galleryPaths(collection: ResolvedCollection): GalleryPath[] {
  const found: GalleryPath[] = [];
  walkFields(collection.fields, (field, path) => {
    if (field.kind !== 'repeater') return;
    const image = field.fields.find((f) => f.kind === 'image');
    const alt = field.fields.find((f) => f.kind === 'text' && f.key === 'alt');
    if (image && alt) {
      found.push({ path: path.join('.'), imageKey: image.key, altKey: alt.key });
    }
  });
  return found;
}

/** Every gallery row, flattened in declaration order, with its uuid and alt. */
function collectImages(
  collection: ResolvedCollection,
  data: Record<string, unknown>,
): { uuid: string; alt: string }[] {
  const out: { uuid: string; alt: string }[] = [];
  for (const gallery of galleryPaths(collection)) {
    const rows = getAtPath(data, gallery.path);
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const record = row as Record<string, unknown>;
      const uuid = record[gallery.imageKey];
      if (typeof uuid !== 'string' || uuid === '') continue;
      const alt = record[gallery.altKey];
      out.push({ uuid, alt: typeof alt === 'string' ? alt : '' });
    }
  }
  return out;
}

/**
 * Resolve the effective alt for a set of images.
 *
 * The gallery row's own alt wins; the media library's `alt_text` fills in behind
 * it. PM should score what a visitor actually gets, not what one storage layer
 * happens to hold — the two disagree constantly, because the library default is
 * the thing nobody remembers to override.
 */
async function withEffectiveAlts(images: { uuid: string; alt: string }[]): Promise<PmImage[]> {
  const needsFallback = images.filter((i) => i.alt === '').map((i) => i.uuid);

  const libraryAlts = new Map<string, string>();
  if (needsFallback.length > 0) {
    const rows = await getDb()
      .select({ uuid: schema.mediaFiles.uuid, altText: schema.mediaFiles.altText })
      .from(schema.mediaFiles)
      .where(inArray(schema.mediaFiles.uuid, needsFallback));
    for (const row of rows) {
      if (row.altText) libraryAlts.set(row.uuid, row.altText);
    }
  }

  return images.map((image, position) => ({
    id: image.uuid,
    src: absoluteUrl(mediaUrl(image.uuid)),
    alt: image.alt || libraryAlts.get(image.uuid) || '',
    position,
  }));
}

/** A field's stored value as a plain string, or null. Never a stringified object. */
function asText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

/** What PM may write here, and the site's own sentence for everything it may not. */
export interface PmFieldSupport {
  writable: string[];
  /** field key → why praion refuses it, in words a PM user can act on. */
  refused: Record<string, string>;
}

/**
 * Which PM keys this collection will actually accept, and why not for the rest.
 *
 * Derived **purely from the collection config**, never from one document's
 * stored data. That matters twice over: the `/ping` manifest has no document to
 * inspect, and a data-driven answer would be wrong anyway — a document that
 * happens to have an empty title group would look writable while every other
 * document of the same type did not.
 *
 * This is the single source for both the `editable[]` array on every read DTO
 * and the `refused` map in the manifest, so the two can never drift apart and
 * tell a user different things about the same field.
 */
export function pmFieldSupport(collection: ResolvedCollection): PmFieldSupport {
  const pageType = collection.pmPageType;
  if (!pageType) return { writable: [], refused: {} };

  const allowed = PM_EDITABLE_FIELD_KEYS[pageType];
  const map = collection.pmFieldMap ?? {};
  const writable: string[] = [];
  const refused: Record<string, string> = {};

  for (const key of allowed) {
    if (key === 'name') {
      // An explicit mapping is the site saying where a flat string should go.
      if (map.name) {
        writable.push(key);
        continue;
      }
      const titlePath = resolveTitlePath(collection);
      if (!titlePath) {
        refused.name = 'This collection does not declare where its title is stored.';
        continue;
      }
      if (fieldKindAt(collection, titlePath) === 'group') {
        refused.name =
          'The title is a three-part group (before / accent / after) whose middle part renders ' +
          'in an accent colour. A single string would be written into the first part and blank ' +
          'the other two, silently destroying the styling.';
        continue;
      }
      writable.push(key);
      continue;
    }

    if (key === 'description') {
      const path = map.description ?? 'description';
      const kind = fieldKindAt(collection, path);
      if (kind === 'richText') {
        refused.description =
          'The body is stored as structured rich text, not HTML, and there is no converter. ' +
          'Writing HTML here would put raw markup on the live page.';
        continue;
      }
      if (kind === null) {
        refused.description = 'This collection has no body field.';
        continue;
      }
      writable.push(key);
      continue;
    }

    if (key === 'short_description') {
      const path = map.short_description;
      if (!path) {
        refused.short_description = 'This collection has no short description field.';
        continue;
      }
      writable.push(key);
      continue;
    }

    writable.push(key);
  }

  return { writable, refused };
}

/** Backwards-compatible view for the read DTO. */
export function editableKeysFor(collection: ResolvedCollection): string[] {
  return pmFieldSupport(collection).writable;
}

/**
 * Where this collection's title actually lives.
 *
 * `titlePath` when declared, otherwise the same fallback order
 * `deriveDocumentTitle` uses — `title`, `name`, `question`, `label` — because a
 * collection that never declared one still has a title the admin displays, and
 * refusing to write it would be an answer about the config rather than about the
 * content. Only top-level string fields qualify, which is what the derivation
 * looks at too.
 */
export function resolveTitlePath(collection: ResolvedCollection): string | null {
  if (collection.titlePath) return collection.titlePath;
  for (const key of ['title', 'name', 'question', 'label']) {
    const kind = fieldKindAt(collection, key);
    if (kind === 'text' || kind === 'textarea') return key;
  }
  return null;
}

/** The declared kind of the field at a dot path, or null if there is none. */
function fieldKindAt(collection: ResolvedCollection, path: string): string | null {
  return fieldAt(collection, path)?.kind ?? null;
}

/** The declared field at a dot path, or null if there is none. */
function fieldAt(collection: ResolvedCollection, path: string): Field | null {
  let found: Field | null = null;
  walkFields(collection.fields, (field, fieldPath) => {
    if (fieldPath.join('.') === path) found = field;
  });
  return found;
}

/**
 * The STORAGE FORMAT of every writable field that is not plain prose.
 *
 * PM assumes a field it can edit is text it may sanitize as HTML. That is true
 * of a title and false of an MDX body: running an HTML sanitizer over
 * `<Painpoint number="1" heading="…">` deletes the tag AND the heading with it,
 * because the copy lives in a JSX attribute. PM had no way to know the
 * difference, so it corrupted every scenario body it imported.
 *
 * Only non-prose formats are listed. A missing key means "ordinary text",
 * which is what every other field is and what PM already assumes.
 */
export function fieldFormats(collection: ResolvedCollection): Record<string, string> {
  const map = collection.pmFieldMap ?? {};
  const formats: Record<string, string> = {};

  for (const key of editableKeysFor(collection)) {
    // `editableKeysFor` returns `string[]` while `pmFieldMap` is keyed by
    // `PmWritableKey`, so the lookup needs narrowing. An unmapped key reads as
    // `undefined` and is skipped on the next line, which is the intended
    // behaviour either way.
    const path =
      key === 'description'
        ? (map.description ?? 'description')
        : map[key as keyof typeof map];
    if (!path) continue;
    const field = fieldAt(collection, path);
    if (field?.kind === 'code') {
      // The language hint IS the format: `mdx`, `markdown`, `html`. Falling
      // back to `code` rather than guessing mdx — either way it already tells
      // PM not to treat the value as prose.
      formats[key] = field.language ?? 'code';
    }
  }

  return formats;
}

export interface BuildItemOptions {
  config: CmsConfig;
  collection: ResolvedCollection;
  row: DocumentRow;
  /** Resolved names of related documents, when the caller has fetched them. */
  categories?: string[];
  tags?: string[];
}

/** Build the wire item for one document. */
export async function buildItem(opts: BuildItemOptions): Promise<PmItem> {
  const { config, collection, row } = opts;
  const data = (row.data ?? {}) as Record<string, unknown>;
  const seo = documentSeo(row);
  const map = collection.pmFieldMap ?? {};

  const namePath = map.name ?? resolveTitlePath(collection);
  const name = namePath ? flattenTitle(getAtPath(data, namePath)) : null;

  const descriptionPath = map.description ?? 'description';
  const shortPath = map.short_description;

  const images = await withEffectiveAlts(collectImages(collection, data));

  const item: PmItem = {
    id: row.id,
    remote_type: collection.pmPageType!,
    content_type: collection.key,
    remote_id: encodeRemoteId(row),
    // Fall back to the derived title so an untitled document still reports
    // something recognisable rather than an empty row in PM's list.
    name: name ?? asText(getAtPath(data, 'title')) ?? null,
    slug: row.slug,
    status: toPmStatus(row.status),
    permalink: permalinkFor(config, collection, row),
    locale: row.locale,
    description: asText(getAtPath(data, descriptionPath)),
    short_description: shortPath ? asText(getAtPath(data, shortPath)) : null,
    images,
    seo: {
      seo_title: seo.metaTitle,
      meta_description: seo.metaDescription,
      focus_keywords: seo.focusKeywords,
      og_title: seo.ogTitle,
      og_description: seo.ogDescription,
      og_image: seo.ogImageUuid ? absoluteUrl(mediaUrl(seo.ogImageUuid)) : null,
      twitter_card: seo.twitterCard,
      canonical_url: seo.canonicalUrl,
      robots: formatRobots({ noindex: seo.noindex, nofollow: seo.nofollow }),
      include_in_sitemap: seo.includeInSitemap,
      schema_raw_override: seo.schemaOverride,
      faqs: seo.faqs,
      key_facts: seo.keyFacts,
      answer_summary: seo.answerSummary,
      pros_cons: seo.prosCons,
    },
    // The editorial revision date, not the technical stamp. `modified_after`
    // filters on `updated_at`; this is what a reader would call "last updated".
    modified_at: (row.modifiedAt ?? row.publishedAt ?? row.updatedAt)?.toISOString() ?? null,
    formats: fieldFormats(collection),
    editable: editableKeysFor(collection),
  };

  if (collection.pmPageType === 'product') {
    item.sku = asText(getAtPath(data, 'sku'));
    const price = getAtPath(data, 'price');
    item.price = typeof price === 'number' ? price : null;
    item.currency = 'EUR';
    item.categories = opts.categories ?? [];
    item.tags = opts.tags ?? [];
  }

  return item;
}
