/**
 * Product category collection preset.
 *
 * A category is an ordinary `document` (type = 'category' by default), so it
 * reuses the whole content stack — admin CRUD, validation, versioning,
 * publishing, the read layer. Categories are hierarchical via a self-relation
 * (`parent` → another category); the admin list stays flat for now, but the
 * stored parent link lets the storefront (and a later tree view) nest them.
 *
 * Products reference categories through a `categories` relation field (see
 * `productCollection`). Like products, this collection is gated by the
 * `commerce` module and hidden from the admin until it is enabled.
 */
import type { IconName } from '../../admin/ui/icon-names';
import { defineCollection, f, type CollectionDefinition, type Field } from '../../config';

export interface CategoryCollectionOptions {
  /** Collection key / document type. Default `category`. */
  key?: string;
  label?: string;
  labelPlural?: string;
  icon?: IconName;
  /** Route template for the storefront category page. Default `/shop/category/{slug}`. */
  pathTemplate?: string;
  /** Collection key the `sizeChart` relation points at. Default `sizechart`. */
  sizeChartKey?: string;
  /** Extra fields appended to the preset. */
  extraFields?: Field[];
}

export function categoryCollection(opts: CategoryCollectionOptions = {}): CollectionDefinition {
  const key = opts.key ?? 'category';
  return defineCollection({
    key,
    label: opts.label ?? 'Category',
    labelPlural: opts.labelPlural ?? 'Categories',
    icon: opts.icon ?? 'tags',
    module: 'commerce',
    pmPageType: 'product_category',
    pmGroup: 'Shop',
    routing: { pathTemplate: opts.pathTemplate ?? '/shop/category/{slug}' },
    fields: [
      // Localized: categories are single entities shared across all product
      // languages, each with a per-locale title.
      f.text('title', {
        label: 'Category name',
        required: true,
        maxLength: 255,
        localized: true,
        description: 'The heading of the category page and its name in menus, filters and the category picker.',
      }),
      f.textarea('description', {
        label: 'Description',
        rows: 3,
        localized: true,
        description: 'Optional intro text for the category, for the storefront to show on its page.',
      }),
      f.image('image', { label: 'Image', description: 'Optional picture for the category, for the storefront to use on category cards or its page.' }),
      f.relation('parent', { label: 'Parent category',
        to: key,
        description: 'Optional parent category (leave empty for a top-level category).',
      }),
      // A default size guide for every product in this category (a product's own
      // `sizeChart` overrides it).
      f.relation('sizeChart', { label: 'Size chart',
        to: opts.sizeChartKey ?? 'sizechart',
        description: 'Optional default size guide for products in this category.',
      }),
      ...(opts.extraFields ?? []),
    ],
  });
}
