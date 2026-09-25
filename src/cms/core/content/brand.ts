import { defineCollection, f, type CollectionDefinition, type Field } from '../../config';

/**
 * Brand logos, for the `[brands]` shortcode.
 *
 * A collection rather than the distinct `brand` values already on products: a
 * logo, a link and an order are content in their own right, and a site with no
 * products at all (client logos on a services page) has the same need.
 *
 * No `routing`: brands have no page of their own, so they do not route
 * publicly. They are still listed under Content, where the logos are edited.
 */
export interface BrandCollectionOptions {
  key?: string;
  label?: string;
  labelPlural?: string;
  extraFields?: Field[];
}

export const DEFAULT_BRAND_TYPE = 'brand';

export function brandCollection(opts: BrandCollectionOptions = {}): CollectionDefinition {
  return defineCollection({
    key: opts.key ?? DEFAULT_BRAND_TYPE,
    label: opts.label ?? 'Brand',
    labelPlural: opts.labelPlural ?? 'Brands',
    icon: 'tag',
    seo: false,
    fields: [
      f.text('title', {
        label: 'Brand name',
        required: true,
        maxLength: 191,
        description: 'Read out to people who cannot see the logo, and shown instead of it when there is no logo.',
      }),
      f.image('logo', {
        label: 'Logo',
        description: 'Shown small — an SVG or a transparent PNG works best.',
      }),
      f.text('url', {
        label: 'Website',
        maxLength: 500,
        description: 'Optional. Opens in a new tab.',
      }),
      ...(opts.extraFields ?? []),
    ],
  });
}
