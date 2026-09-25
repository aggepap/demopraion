/**
 * Product collection preset.
 *
 * A product is an ordinary `document` (type = 'product' by default), so it
 * reuses the entire content stack — admin CRUD, validation, versioning,
 * publishing, the read layer, revalidation. This factory just stamps the
 * commerce field shape so every site gets a consistent product schema without
 * hand-writing it. A site opts in by adding `productCollection()` to its
 * config `collections` and setting `modules.commerce: true`.
 *
 * Prices are authored in major units (e.g. 49.99); orders store minor units
 * (checkout converts). `variations[].price`, when set, overrides the base price.
 */
import type { IconName } from '../../admin/ui/icon-names';
import { defineCollection, f, listingPathOf, type CollectionDefinition, type Field, type UnpublishRedirectDefinition } from '../../config';

export interface ProductCollectionOptions {
  /** Collection key / document type. Default `product`. */
  key?: string;
  label?: string;
  labelPlural?: string;
  icon?: IconName;
  /** Route template for the storefront detail page. Default `/shop/{slug}`. */
  pathTemplate?: string;
  /** Collection key the `categories` relation points at. Default `category`. */
  categoryKey?: string;
  /** Collection key the `sizeChart` relation points at. Default `sizechart`. */
  sizeChartKey?: string;
  /** Collection key the `tags` relation points at. Default `tag`. */
  tagKey?: string;
  /** Extra fields appended to the preset (attributes, custom taxonomies, …). */
  extraFields?: Field[];
}

export const AVAILABILITY_VALUES = ['in-stock', 'out-of-stock', 'preorder', 'made-to-order'] as const;

/**
 * Catalog visibility (WooCommerce semantics): `hidden` products stay reachable
 * by direct URL — they're unlisted, not unpublished.
 */
export const VISIBILITY_VALUES = ['visible', 'catalog', 'search', 'hidden'] as const;

const VISIBILITY_LABELS: Record<(typeof VISIBILITY_VALUES)[number], string> = {
  visible: 'Shop and search',
  catalog: 'Shop only',
  search: 'Search only',
  hidden: 'Hidden (direct link only)',
};

/** Merchandising badges an editor can switch on. `sale` is derived from
 *  `compareAtPrice`, not stored, so it can never contradict the price. */
export const BADGE_VALUES = ['new', 'bestseller'] as const;

const BADGE_LABELS: Record<(typeof BADGE_VALUES)[number], string> = {
  new: 'New',
  bestseller: 'Bestseller',
};

/** `itemCondition` for structured data / marketplace feeds. */
export const CONDITION_VALUES = ['new', 'refurbished', 'used'] as const;

/**
 * Product type (addendum §5). `standard` covers simple + variable (variations
 * are orthogonal); the others change how the product is bought:
 *  - `grouped`  — a set of component products; the storefront adds the parts.
 *  - `external` — a "Buy on X" link, no checkout.
 *  - `digital`  — downloadable / virtual: no shipping, address step skipped.
 */
export const PRODUCT_TYPE_VALUES = ['standard', 'grouped', 'external', 'digital', 'giftcard'] as const;

const PRODUCT_TYPE_LABELS: Record<(typeof PRODUCT_TYPE_VALUES)[number], string> = {
  standard: 'Standard (simple / variable)',
  grouped: 'Grouped (set of products)',
  external: 'External / affiliate',
  digital: 'Digital download / virtual',
  giftcard: 'Gift card',
};

function productUnpublishRedirect(pathTemplate: string): UnpublishRedirectDefinition | undefined {
  const listing = listingPathOf(pathTemplate);
  return listing ? { taxonomyField: 'categories', fallbackPath: listing } : undefined;
}

export function productCollection(opts: ProductCollectionOptions = {}): CollectionDefinition {
  const categoryKey = opts.categoryKey ?? 'category';
  const sizeChartKey = opts.sizeChartKey ?? 'sizechart';
  const tagKey = opts.tagKey ?? 'tag';
  const productKey = opts.key ?? 'product';
  return defineCollection({
    key: opts.key ?? 'product',
    label: opts.label ?? 'Product',
    labelPlural: opts.labelPlural ?? 'Products',
    icon: opts.icon ?? 'shopping-bag',
    // Tied to the commerce module: hidden from the admin until the Modules
    // toggle enables commerce (the schema still lives here in code).
    module: 'commerce',
    // Stamped here so a cloned site inherits the PM mapping without touching
    // its config. `subtitle` is the short marketing line, which is exactly what
    // PM means by `short_description`.
    pmPageType: 'product',
    pmFieldMap: { short_description: 'subtitle' },
    pmGroup: 'Shop',
    pmDescription: 'Products in the shop.',
    routing: { pathTemplate: opts.pathTemplate ?? '/shop/{slug}' },
    // Unpublished, a product's URL redirects to its first live category page (302
    // draft, 301 archived), or to the shop when it has none.
    unpublishRedirect: productUnpublishRedirect(opts.pathTemplate ?? '/shop/{slug}'),
    fields: [
      // Fields marked `shared` are identical across all languages (defined once,
      // propagated to every locale on save); the rest — title, subtitle,
      // description, specs, and the localized labels inside attributes — are
      // authored per language.

      // ── General ──────────────────────────────────────────────────────────
      f.text('title', { label: 'Product name', required: true, maxLength: 255, section: 'General', description: 'The product page heading, and the name shown in listings, the cart and the order.' }),
      f.text('subtitle', { label: 'Short tagline', maxLength: 255, section: 'General', description: 'One line under the name on the product page and cards.' }),
      f.richText('description', { label: 'Description', section: 'General', description: 'The full product text on the product page.' }),
      f.repeater('gallery', [f.image('image', { label: 'Image', description: 'A product photo. The first image is the main one on cards and in feeds.' }), f.text('alt', { label: 'Alt text', description: 'Describes the image for screen readers and search engines.' })], {
        label: 'Gallery',
        itemLabel: 'Image',
        shared: true,
        description: 'Product photos in display order. The same images are used in every language.',
      }),

      // ── Organization ─────────────────────────────────────────────────────
      f.relation('categories', { label: 'Categories',
        to: categoryKey,
        many: true,
        picker: 'categoryTree',
        shared: true,
        description: 'One or more product categories. Use “Manage categories” to add or organise them.',
        section: 'Organization',
      }),
      // Flat cross-cutting labels (separate from the category tree) driving tag
      // archive pages + chips.
      f.relation('tags', { label: 'Tags',
        to: tagKey,
        many: true,
        shared: true,
        description: 'Optional cross-cutting labels (e.g. “summer”, “gift”).',
        section: 'Organization',
      }),
      // Optional reusable size guide. When empty the storefront falls back to
      // the chart assigned to the product's category (see the read layer).
      f.relation('sizeChart', { label: 'Size chart',
        to: sizeChartKey,
        shared: true,
        description: 'Optional size guide shown on the product page.',
        section: 'Organization',
      }),

      // ── Pricing ──────────────────────────────────────────────────────────
      // Currency is a single site-wide setting (Settings → Ecommerce), not a
      // per-product field, so all prices format consistently.
      f.number('price', { label: 'Price', required: true, min: 0, shared: true, description: 'Major units, e.g. 49.99', section: 'Pricing' }),
      f.number('compareAtPrice', { label: 'Original price ("was")', min: 0, shared: true, description: 'Optional "was" price for sale display', section: 'Pricing' }),

      // ── Inventory ────────────────────────────────────────────────────────
      f.text('sku', { label: 'SKU', maxLength: 64, shared: true, section: 'Inventory', description: 'Your own stock code. Copied onto order lines and sent in product feeds; a variation’s SKU wins over this one.' }),
      f.select('availability', { label: 'Availability',
        options: AVAILABILITY_VALUES.map((value) => ({ value })),
        default: 'in-stock',
        shared: true,
        section: 'Inventory',
        description: 'Shown on the product page and sent to search engines and feeds. Out of stock disables Add to cart.',
      }),
      f.number('stock', { label: 'Stock', min: 0, integer: true, shared: true, description: 'Units in stock (leave empty if untracked)', section: 'Inventory' }),

      // ── Shipping ─────────────────────────────────────────────────────────
      // Stored in `data` JSON. Weight feeds the weight-tier shipping charges
      // (`lineWeight`); the dimensions are informational.
      f.number('weight', { label: 'Weight', min: 0, shared: true, description: 'Product weight (used to calculate shipping)', section: 'Shipping' }),
      f.select('weightUnit', { label: 'Weight unit',
        options: [{ value: 'kg' }, { value: 'g' }, { value: 'lb' }],
        default: 'kg',
        shared: true,
        section: 'Shipping',
        description: 'The unit the weight above is entered in.',
      }),
      f.select('dimensionUnit', { label: 'Dimension unit',
        options: [{ value: 'cm' }, { value: 'in' }],
        default: 'cm',
        shared: true,
        section: 'Shipping',
        description: 'The unit the dimensions below are entered in.',
      }),
      f.group('dimensions', [
        f.number('length', { label: 'Length', min: 0, description: 'Packed length, in the dimension unit.' }),
        f.number('width', { label: 'Width', min: 0, description: 'Packed width, in the dimension unit.' }),
        f.number('height', { label: 'Height', min: 0, description: 'Packed height, in the dimension unit.' }),
      ], { label: 'Dimensions', shared: true, description: 'Parcel size, for shipping. Leave empty if unknown.' }),

      // ── Attributes & variations (WooCommerce-style swatches) ─────────────
      // The attribute structure (which attributes/values exist, their swatch
      // appearance) and the variation matrix are SHARED across languages; only
      // the attribute `name` and value `label` are translated per language.
      // Stable `id`s keep variation references intact when labels are edited.
      f.repeater(
        'attributes',
        [
          f.text('id', { hidden: true }),
          f.text('name', { label: 'Attribute name', required: true, localized: true, description: 'e.g. Color, Size' }),
          f.select('swatchType', { label: 'Shown as',
            options: [{ value: 'button' }, { value: 'color' }, { value: 'image' }],
            default: 'button',
            description: 'How this attribute renders on the storefront.',
          }),
          f.select('filterDisplay', { label: 'Shown in filters as',
            options: [
              { value: 'auto', label: 'Automatic — swatches for colours and images' },
              { value: 'swatches', label: 'Swatches' },
              { value: 'list', label: 'Checkbox list' },
            ],
            default: 'auto',
            description:
              'Colour and image attributes are offered as swatches in the shop filters; everything else as a list. Override it here when a colour is better read as a name.',
          }),
          f.repeater(
            'values',
            [
              f.text('id', { hidden: true }),
              f.text('label', { label: 'Value', required: true, localized: true, description: 'One choice of this attribute, e.g. Red or XL.' }),
              f.color('color', { label: 'Colour', description: 'Used when swatch type is "color".' }),
              f.image('image', { label: 'Swatch image', description: 'Used when swatch type is "image", e.g. a fabric close-up.' }),
              // Per-value gallery ("photo per colour"): selecting this value swaps
              // the whole product gallery to these images, falling back to the
              // base gallery when empty. Shared with the attributes structure;
              // `alt` stays plain text like the base gallery.
              f.repeater(
                'gallery',
                [
                  f.image('image', { label: 'Image', description: 'A photo of the product in this value.' }),
                  f.text('alt', { label: 'Alt text', description: 'Describes the image for screen readers and search engines.' }),
                ],
                { label: 'Variant gallery', itemLabel: 'Image', description: 'Optional — shown when this value is selected.' },
              ),
            ],
            { label: 'Values', itemLabel: 'Value', autoId: true, description: 'The choices a customer picks between for this attribute.' },
          ),
        ],
        { label: 'Attributes', itemLabel: 'Attribute', autoId: true, shared: true, description: 'What the product comes in, e.g. Colour and Size. Used to build the variations below and the shop filters.' },
      ),
      f.variations('variations', { label: 'Variations', attributesKey: 'attributes', shared: true, description: 'One row per combination of attribute values. A variation’s own price, stock and SKU replace the product’s; a disabled one is not offered in the shop.' }),

      // ── Specs ────────────────────────────────────────────────────────────
      f.repeater(
        'specs',
        [
          f.text('label', { label: 'Shown as', required: true, description: 'The name of the spec, e.g. Material.' }),
          f.text('value', { label: 'Value', required: true, description: 'The spec itself, e.g. 100% cotton.' }),
        ],
        { label: 'Specs', itemLabel: 'Spec', description: 'A table of facts on the product page.' },
      ),

      // ── Product type (§5) ────────────────────────────────────────────────
      // Only the section matching the chosen type is meaningful; the others
      // stay empty. `standard` needs nothing extra here.
      f.select('productType', {
        label: 'Product type',
        options: PRODUCT_TYPE_VALUES.map((value) => ({ value, label: PRODUCT_TYPE_LABELS[value] })),
        default: 'standard',
        shared: true,
        description: 'Changes how the product is bought (see the matching section below).',
        section: 'Type',
      }),
      // Grouped: the component products + how many of each. The storefront adds
      // the components to the cart; each is priced + stocked on its own.
      f.repeater(
        'components',
        [
          f.relation('product', { label: 'Product', to: productKey, description: 'A product that is part of this set.' }),
          f.number('quantity', { label: 'Quantity', min: 1, integer: true, default: 1, description: 'How many of it the set adds to the cart.' }),
        ],
        { label: 'Components', itemLabel: 'Component', shared: true, section: 'Grouped product', description: 'The products in this set. Each is added to the cart, priced and stocked on its own.' },
      ),
      // External / affiliate: a "Buy on X" link instead of add-to-cart.
      f.text('externalUrl', { label: 'External buy link', maxLength: 512, shared: true, description: 'Where "Buy" links to.', section: 'External product' }),
      f.text('externalLabel', { label: 'Buy button text', maxLength: 64, localized: true, description: 'CTA label, e.g. "Buy on Skroutz".', section: 'External product' }),
      // Digital download / virtual: no shipping, address step skipped at checkout.
      // Files are listed on the PDP by name; secure per-order delivery is future work.
      f.repeater(
        'downloadFiles',
        [
          f.text('name', { label: 'File name', required: true, description: 'The name the customer sees for this file.' }),
          f.text('url', { label: 'URL', description: 'File URL (media or external).' }),
        ],
        { label: 'Download files', itemLabel: 'File', shared: true, section: 'Digital download', description: 'The files listed on the product page by name.' },
      ),
      f.number('downloadLimit', { label: 'Download limit', min: 0, integer: true, shared: true, description: 'Max downloads per order (0 = unlimited).', section: 'Digital download' }),
      f.number('downloadExpiryDays', { label: 'Download expires after', min: 0, integer: true, shared: true, description: 'Days the download stays valid (0 = never expires).', section: 'Digital download' }),

      // ── Merchandising ────────────────────────────────────────────────────
      // How the product presents itself in the catalog. All shared: a product
      // is featured (or hidden) as a whole, not per language — only the custom
      // badge label is translated.
      f.boolean('featured', { label: 'Featured',
        shared: true,
        description: 'Show first in the default catalog order.',
        section: 'Merchandising',
      }),
      f.select('visibility', {
        label: 'Visibility',
        options: VISIBILITY_VALUES.map((value) => ({ value, label: VISIBILITY_LABELS[value] })),
        default: 'visible',
        shared: true,
        description: 'Hidden products keep working links — they just stop being listed.',
        section: 'Merchandising',
      }),
      f.select('badges', {
        label: 'Badges',
        options: BADGE_VALUES.map((value) => ({ value, label: BADGE_LABELS[value] })),
        multiple: true,
        shared: true,
        description: 'A “Sale” badge is added automatically when a compare-at price is set.',
        section: 'Merchandising',
      }),
      f.text('badgeLabel', { label: 'Custom badge text',
        maxLength: 24,
        localized: true,
        shared: true,
        description: 'Optional custom badge, e.g. “Limited edition”.',
        section: 'Merchandising',
      }),
      // Manual sort override — used by the "manual" sort option (lower first).
      f.number('menuOrder', { label: 'Sort position',
        integer: true,
        shared: true,
        description: 'Manual sort position (lower shows first). Leave empty for none.',
        section: 'Merchandising',
      }),

      // ── Purchase limits (§6) ─────────────────────────────────────────────
      // Enforced in the buy box, the cart and (authoritatively) at checkout.
      f.number('minQty', { label: 'Minimum quantity', min: 1, integer: true, shared: true, description: 'Minimum quantity per order.', section: 'Purchase limits' }),
      f.number('maxQty', { label: 'Maximum quantity', min: 1, integer: true, shared: true, description: 'Maximum quantity per order (empty = no cap).', section: 'Purchase limits' }),
      f.number('qtyStep', { label: 'Sold in multiples of', min: 1, integer: true, shared: true, description: 'Quantities must be multiples of this (e.g. sold in packs of 6).', section: 'Purchase limits' }),
      f.boolean('soldIndividually', { label: 'One per order', shared: true, description: 'Limit to one per order.', section: 'Purchase limits' }),

      // ── Merchant identifiers ─────────────────────────────────────────────
      // Product identity for structured data and marketplace feeds.
      f.text('brand', { label: 'Brand', maxLength: 120, shared: true, section: 'Merchant', description: 'The maker’s brand, sent to search engines and product feeds.' }),
      f.text('gtin', { label: 'Barcode (GTIN)', maxLength: 14, shared: true, description: 'EAN / UPC / ISBN', section: 'Merchant' }),
      f.text('mpn', { label: 'Manufacturer part number', maxLength: 64, shared: true, description: 'Manufacturer part number', section: 'Merchant' }),
      f.select('condition', { label: 'Condition',
        options: CONDITION_VALUES.map((value) => ({ value })),
        default: 'new',
        shared: true,
        section: 'Merchant',
        description: 'New, refurbished or used. Sent to search engines and product feeds.',
      }),
      ...(opts.extraFields ?? []),
    ],
  });
}
