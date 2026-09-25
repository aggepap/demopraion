/**
 * Product tag collection preset (addendum §6).
 *
 * Tags are a flat taxonomy, separate from the hierarchical `category` tree —
 * cross-cutting labels ("summer", "handmade", "gift") that drive tag archive
 * pages + chips. An ordinary `document` (type = 'tag'), so it reuses the whole
 * content stack. Gated by the `commerce` module; per-locale title like a
 * category.
 */
import type { IconName } from '../../admin/ui/icon-names';
import { defineCollection, f, type CollectionDefinition, type Field } from '../../config';

export interface TagCollectionOptions {
  /** Collection key / document type. Default `tag`. */
  key?: string;
  label?: string;
  labelPlural?: string;
  icon?: IconName;
  /** Route template for the storefront tag archive. Default `/shop/tag/{slug}`. */
  pathTemplate?: string;
  /** Extra fields appended to the preset. */
  extraFields?: Field[];
}

export const DEFAULT_TAG_TYPE = 'tag';

export function tagCollection(opts: TagCollectionOptions = {}): CollectionDefinition {
  return defineCollection({
    key: opts.key ?? DEFAULT_TAG_TYPE,
    label: opts.label ?? 'Tag',
    labelPlural: opts.labelPlural ?? 'Tags',
    icon: opts.icon ?? 'tag',
    module: 'commerce',
    pmPageType: 'product_tag',
    pmGroup: 'Shop',
    routing: { pathTemplate: opts.pathTemplate ?? '/shop/tag/{slug}' },
    fields: [
      f.text('title', {
        label: 'Tag name',
        required: true,
        maxLength: 191,
        localized: true,
        description: 'Shown as a chip on products and as the heading of the tag page.',
      }),
      ...(opts.extraFields ?? []),
    ],
  });
}
