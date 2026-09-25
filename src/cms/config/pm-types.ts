/**
 * Product Manager's page-type vocabulary, as this config layer sees it.
 *
 * ## Why the names look like WordPress
 *
 * `wp_page` / `wp_post` are historical: PM grew up against WooCommerce. The
 * Shopify adapter already reuses the same values for Shopify resources rather
 * than inventing a parallel set, and praion does the same. Do not add a
 * `praion_*` vocabulary — PM's enum is the contract, and a second spelling of
 * the same concept would have to be translated at every boundary.
 *
 * ## Why this file lives in `config/`
 *
 * `site.config.ts` needs these names for autocomplete on `pmPageType`, and
 * `defineConfig` needs them to validate. Keeping them here as plain data means
 * `config/` never imports from `modules/pm/`, so the bridge stays an optional
 * module that a site can leave switched off.
 */

/** Page types backed by a real document in a collection. */
export const PM_DOCUMENT_PAGE_TYPES = [
  'wp_page',
  'wp_post',
  'product',
  'product_category',
  'product_tag',
] as const;

/** Virtual pages — Next routes with no document behind them. */
export const PM_ARCHIVE_PAGE_TYPES = [
  'archive_home',
  'archive_blog',
  'archive_shop',
  'archive_search',
  'archive_404',
] as const;

export type PmDocumentPageType = (typeof PM_DOCUMENT_PAGE_TYPES)[number];
export type PmArchiveType = (typeof PM_ARCHIVE_PAGE_TYPES)[number];
export type PmPageType = PmDocumentPageType | PmArchiveType;

export const PM_PAGE_TYPES: readonly PmPageType[] = [
  ...PM_DOCUMENT_PAGE_TYPES,
  ...PM_ARCHIVE_PAGE_TYPES,
];

export function isPmDocumentPageType(value: string): value is PmDocumentPageType {
  return (PM_DOCUMENT_PAGE_TYPES as readonly string[]).includes(value);
}

export function isPmArchiveType(value: string): value is PmArchiveType {
  return (PM_ARCHIVE_PAGE_TYPES as readonly string[]).includes(value);
}

/**
 * The field keys PM may write, per page type.
 *
 * Mirrors `PmPageType::editableFieldKeys()` on the Laravel side. Praion narrows
 * this further per collection — a `richText` body refuses `description`, a
 * group-shaped title refuses `name` — but a key absent here is one PM will never
 * send at all.
 *
 * Archives carry no body and no social image, matching PM's `default` branch.
 */
export const PM_EDITABLE_FIELD_KEYS: Record<PmPageType, readonly string[]> = {
  product: [
    'name',
    'slug',
    'description',
    'short_description',
    'seo_title',
    'meta_description',
    'og_title',
    'og_description',
    'og_image',
  ],
  wp_page: ['name', 'slug', 'description', 'seo_title', 'meta_description', 'og_title', 'og_description', 'og_image'],
  wp_post: ['name', 'slug', 'description', 'seo_title', 'meta_description', 'og_title', 'og_description', 'og_image'],
  product_category: [
    'name',
    'slug',
    'description',
    'seo_title',
    'meta_description',
    'og_title',
    'og_description',
    'og_image',
  ],
  product_tag: [
    'name',
    'slug',
    'description',
    'seo_title',
    'meta_description',
    'og_title',
    'og_description',
    'og_image',
  ],
  archive_home: ['seo_title', 'meta_description', 'og_title', 'og_description'],
  archive_blog: ['seo_title', 'meta_description', 'og_title', 'og_description'],
  archive_shop: ['seo_title', 'meta_description', 'og_title', 'og_description'],
  archive_search: ['seo_title', 'meta_description', 'og_title', 'og_description'],
  archive_404: ['seo_title', 'meta_description', 'og_title', 'og_description'],
};

/**
 * PM field keys a collection may remap onto its own field paths.
 *
 * Only the content-shaped ones: the SEO/AEO keys all resolve through the
 * built-in SEO field set (`core/seo/fields.ts`), which every collection has, so
 * they need no per-collection mapping.
 */
export const PM_WRITABLE_KEYS = ['name', 'slug', 'description', 'short_description'] as const;
export type PmWritableKey = (typeof PM_WRITABLE_KEYS)[number];
