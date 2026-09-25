/**
 * What each kind of content tells search engines it is — as data.
 *
 * Every public route used to hard-code its JSON-LD: pages were always a WebPage,
 * articles and answers a generic WebPage too, and every booking a TouristTrip —
 * including a room to stay in. The only lever an owner had was pasting raw
 * JSON-LD into one document at a time.
 *
 * Now Settings → Structured data picks, per category, a schema.org type from the
 * types that make sense for that category, which optional parts to include, and
 * whether to add breadcrumbs and the SEO panel's FAQs. A document may override
 * its category's type from the same list (the `schemaType` SEO field). The
 * site-wide Organization may become a local-business subtype.
 *
 * The lists are deliberately short and follow Google's structured-data rules:
 * no QAPage for a publisher's own FAQ (it is for user-generated Q&A), no Event
 * for a tour without a date, no `offers` on an Accommodation.
 *
 * Pure and client-safe: the admin screen, the settings validator, the SEO field
 * and the node builder all share these shapes.
 */
import { z } from 'zod';

/** `site_settings` key holding the whole policy. */
export const SCHEMA_POLICY_KEY = 'seo.schema';

/** The per-document override, stored at `data.seo.schemaType`. */
export const SCHEMA_TYPE_FIELD_KEY = 'schemaType';

/** The per-document value meaning "use the category setting". */
export const SCHEMA_TYPE_INHERIT = 'inherit';

/** How a type is built. Several types share a family (BlogPosting, NewsArticle…). */
export type SchemaFamily = 'webpage' | 'article' | 'faq' | 'product' | 'trip' | 'accommodation' | 'none';

export const SCHEMA_TYPES = [
  'WebPage',
  'AboutPage',
  'ContactPage',
  'CollectionPage',
  'BlogPosting',
  'Article',
  'NewsArticle',
  'TechArticle',
  'CreativeWork',
  'FAQPage',
  'Product',
  'TouristTrip',
  'Trip',
  'Accommodation',
  'HotelRoom',
  'Apartment',
  'House',
  'VacationRental',
  'None',
] as const;
export type SchemaType = (typeof SCHEMA_TYPES)[number];

export const TYPE_FAMILY: Record<SchemaType, SchemaFamily> = {
  WebPage: 'webpage',
  AboutPage: 'webpage',
  ContactPage: 'webpage',
  CollectionPage: 'webpage',
  BlogPosting: 'article',
  Article: 'article',
  NewsArticle: 'article',
  TechArticle: 'article',
  CreativeWork: 'article',
  FAQPage: 'faq',
  Product: 'product',
  TouristTrip: 'trip',
  Trip: 'trip',
  Accommodation: 'accommodation',
  HotelRoom: 'accommodation',
  Apartment: 'accommodation',
  House: 'accommodation',
  VacationRental: 'accommodation',
  None: 'none',
};

/** One line on what the type does for the page, shown under the select. */
export const TYPE_HINTS: Record<SchemaType, string> = {
  WebPage: 'A plain page. Google may show breadcrumbs for it.',
  AboutPage: 'The page about the business.',
  ContactPage: 'The page with contact details.',
  CollectionPage: 'A page that lists other pages.',
  BlogPosting: 'A blog post. Eligible for article rich results.',
  Article: 'A general article. Eligible for article rich results.',
  NewsArticle: 'News. Use only for timely reporting.',
  TechArticle: 'A how-to or technical article.',
  CreativeWork: 'A piece of work, such as a project or case study.',
  FAQPage: 'Questions and answers. Read by AI engines; Google shows FAQ results only for a few sites.',
  Product: 'Something sold at a price. Needed for price and stock in Google results.',
  TouristTrip: 'A tour or excursion.',
  Trip: 'A trip or transfer.',
  Accommodation: 'A place to stay.',
  HotelRoom: 'A hotel room.',
  Apartment: 'An apartment.',
  House: 'A house or villa.',
  VacationRental: 'A holiday rental. Google shows these only through Hotel Center.',
  None: 'Only the site-wide business details. Nothing for this content.',
};

export const SCHEMA_PARTS = ['author', 'dates', 'image', 'speakable', 'brand', 'reviews', 'offers'] as const;
export type SchemaPart = (typeof SCHEMA_PARTS)[number];

export const PART_LABELS: Record<SchemaPart, string> = {
  author: 'Author',
  dates: 'Publish and update dates',
  image: 'Images',
  // Points at the elements marked `data-speakable="headline"` / `"summary"`
  // (`SPEAKABLE_SELECTORS` in nodes.ts); a template that marks neither is unaffected.
  speakable: 'Speakable (text for voice assistants)',
  brand: 'Brand',
  reviews: 'Reviews and rating',
  offers: 'Price and availability',
};

/** The parts a family can carry at all. */
const PARTS_FOR_FAMILY: Record<SchemaFamily, readonly SchemaPart[]> = {
  webpage: [],
  article: ['author', 'dates', 'image', 'speakable'],
  faq: [],
  product: ['brand', 'reviews', 'offers', 'image'],
  trip: ['offers', 'image'],
  accommodation: ['image'],
  none: [],
};

export interface SchemaCategory {
  key: SchemaCategoryKey;
  label: string;
  /** The collection whose documents belong to it. */
  collection: string;
  /** The module that must be on for it to exist. */
  module?: string;
  /** Booking kind, for the two booking categories. */
  kind?: 'transport' | 'stay';
  /** Allowed types; the first is the default. */
  types: readonly SchemaType[];
  /** The parts the admin can switch on and off here. */
  parts: readonly SchemaPart[];
}

export const SCHEMA_CATEGORY_KEYS = [
  'pages',
  'articles',
  'answers',
  'caseStudies',
  'products',
  'bookingTransport',
  'bookingStay',
] as const;
export type SchemaCategoryKey = (typeof SCHEMA_CATEGORY_KEYS)[number];

export const SCHEMA_CATEGORIES: readonly SchemaCategory[] = [
  {
    key: 'pages',
    label: 'Pages',
    collection: 'page',
    types: ['WebPage', 'AboutPage', 'ContactPage', 'CollectionPage', 'None'],
    parts: [],
  },
  {
    key: 'articles',
    label: 'Articles',
    collection: 'article',
    types: ['BlogPosting', 'Article', 'NewsArticle', 'TechArticle', 'None'],
    parts: ['author', 'dates', 'image', 'speakable'],
  },
  {
    key: 'answers',
    label: 'Answers (FAQ)',
    collection: 'answer',
    types: ['FAQPage', 'Article', 'WebPage', 'None'],
    parts: ['dates', 'speakable'],
  },
  {
    key: 'caseStudies',
    label: 'Case studies',
    collection: 'scenario',
    types: ['Article', 'CreativeWork', 'WebPage', 'None'],
    parts: ['author', 'dates', 'image', 'speakable'],
  },
  {
    key: 'products',
    label: 'Products',
    collection: 'product',
    module: 'commerce',
    types: ['Product', 'None'],
    parts: ['brand', 'reviews', 'offers'],
  },
  {
    key: 'bookingTransport',
    label: 'Day trips',
    collection: 'booking',
    module: 'booking',
    kind: 'transport',
    types: ['TouristTrip', 'Trip', 'Product', 'None'],
    parts: ['offers', 'image'],
  },
  {
    key: 'bookingStay',
    label: 'Stays',
    collection: 'booking',
    module: 'booking',
    kind: 'stay',
    types: ['Accommodation', 'HotelRoom', 'Apartment', 'House', 'VacationRental', 'Product', 'None'],
    parts: ['image', 'offers'],
  },
];

const CATEGORY_BY_KEY = new Map(SCHEMA_CATEGORIES.map((c) => [c.key, c]));
const category = (key: SchemaCategoryKey): SchemaCategory => CATEGORY_BY_KEY.get(key)!;

export const BUSINESS_TYPES = [
  'Organization',
  'LocalBusiness',
  'OnlineStore',
  'Store',
  'TravelAgency',
  'LodgingBusiness',
  'Hotel',
  'BedAndBreakfast',
  'Resort',
  'ProfessionalService',
  'Restaurant',
] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

/** Types Google treats as a place people visit: they need an address. */
export const LOCAL_BUSINESS_TYPES: readonly BusinessType[] = BUSINESS_TYPES.filter(
  (t) => t !== 'Organization' && t !== 'OnlineStore',
);

export const isLocalBusiness = (type: string): boolean =>
  (LOCAL_BUSINESS_TYPES as readonly string[]).includes(type);

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface CategoryPolicy {
  type: SchemaType;
  breadcrumbs: boolean;
  appendFaq: boolean;
  /** One entry per part the category offers. */
  parts: Partial<Record<SchemaPart, boolean>>;
}

export interface BusinessPolicy {
  type: BusinessType;
  /** e.g. `€€`. Only emitted for a local business. */
  priceRange: string;
}

export interface SchemaPolicy {
  business: BusinessPolicy;
  categories: Record<SchemaCategoryKey, CategoryPolicy>;
}

const categorySchema = (c: SchemaCategory) =>
  z
    .object({
      type: z.enum(c.types as [SchemaType, ...SchemaType[]]),
      breadcrumbs: z.boolean(),
      appendFaq: z.boolean(),
      parts: z
        .object(Object.fromEntries(c.parts.map((p) => [p, z.boolean()])))
        .partial()
        .strict(),
    })
    .partial()
    .strict();

const businessSchema = z
  .object({ type: z.enum(BUSINESS_TYPES), priceRange: z.string().trim().max(20) })
  .partial()
  .strict();

/** The write boundary: every key optional, nothing unknown, types per category. */
export const schemaPolicySchema = z
  .object({
    business: businessSchema,
    categories: z
      .object(Object.fromEntries(SCHEMA_CATEGORIES.map((c) => [c.key, categorySchema(c)])))
      .partial()
      .strict(),
  })
  .partial()
  .strict();

// ── Reading ──────────────────────────────────────────────────────────────────

export interface SchemaPolicyHints {
  moduleFlags?: Record<string, boolean>;
  bookingKinds?: readonly string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

/** What the site sells decides what it is, until the owner says otherwise. */
function defaultBusinessType(hints: SchemaPolicyHints): BusinessType {
  const flags = hints.moduleFlags ?? {};
  if (flags.commerce) return 'OnlineStore';
  if (flags.booking) {
    const kinds = hints.bookingKinds ?? [];
    return kinds.length > 0 && kinds.every((k) => k === 'stay') ? 'LodgingBusiness' : 'TravelAgency';
  }
  return 'Organization';
}

function readCategory(c: SchemaCategory, raw: unknown): CategoryPolicy {
  const stored = isRecord(raw) ? raw : {};
  const parts = isRecord(stored.parts) ? stored.parts : {};
  return {
    type: (c.types as readonly unknown[]).includes(stored.type) ? (stored.type as SchemaType) : c.types[0],
    breadcrumbs: bool(stored.breadcrumbs, true),
    appendFaq: bool(stored.appendFaq, true),
    parts: Object.fromEntries(c.parts.map((p) => [p, bool(parts[p], true)])),
  };
}

/**
 * The policy as the site reads it. Tolerant field by field: one bad value falls
 * back to its default and leaves the rest of the owner's choices standing, so a
 * hand-edited row can never blank out a site's structured data.
 */
export function parseSchemaPolicy(raw: unknown, hints: SchemaPolicyHints = {}): SchemaPolicy {
  const stored = isRecord(raw) ? raw : {};
  const business = isRecord(stored.business) ? stored.business : {};
  const categories = isRecord(stored.categories) ? stored.categories : {};
  return {
    business: {
      type: (BUSINESS_TYPES as readonly unknown[]).includes(business.type)
        ? (business.type as BusinessType)
        : defaultBusinessType(hints),
      priceRange: typeof business.priceRange === 'string' ? business.priceRange.trim().slice(0, 20) : '',
    },
    categories: Object.fromEntries(
      SCHEMA_CATEGORIES.map((c) => [c.key, readCategory(c, categories[c.key])]),
    ) as Record<SchemaCategoryKey, CategoryPolicy>,
  };
}

/** The parts the admin can toggle for a category when it uses a given type. */
export function partsFor(categoryKey: SchemaCategoryKey, type: SchemaType): SchemaPart[] {
  const family = PARTS_FOR_FAMILY[TYPE_FAMILY[type]];
  return category(categoryKey).parts.filter((p) => family.includes(p));
}

/** What one document emits, resolved from its category and its own override. */
export interface SchemaChoice {
  category: SchemaCategoryKey;
  type: SchemaType;
  family: SchemaFamily;
  breadcrumbs: boolean;
  appendFaq: boolean;
  /**
   * Whether each part is included when the data exists. A part the type cannot
   * carry is off; one the category does not offer as a toggle is on.
   */
  parts: Record<SchemaPart, boolean>;
}

export function resolveSchemaChoice(
  policy: SchemaPolicy,
  categoryKey: SchemaCategoryKey,
  override: string | null | undefined,
): SchemaChoice {
  const c = category(categoryKey);
  const p = policy.categories[categoryKey];
  // An override outside the category's list is ignored — including a day-trip
  // type on a stay, which the combined booking select makes possible.
  const type = override && (c.types as readonly string[]).includes(override) ? (override as SchemaType) : p.type;
  const family = TYPE_FAMILY[type];
  const carried = PARTS_FOR_FAMILY[family];
  return {
    category: categoryKey,
    type,
    family,
    breadcrumbs: family !== 'none' && p.breadcrumbs,
    appendFaq: family !== 'none' && p.appendFaq,
    parts: Object.fromEntries(
      SCHEMA_PARTS.map((part) => [
        part,
        carried.includes(part) && (c.parts.includes(part) ? p.parts[part] !== false : true),
      ]),
    ) as Record<SchemaPart, boolean>,
  };
}

// ── Which category ───────────────────────────────────────────────────────────

/** Every category a collection's documents can fall in (two for bookings). */
export function categoriesForCollection(collectionKey: string): SchemaCategory[] {
  return SCHEMA_CATEGORIES.filter((c) => c.collection === collectionKey);
}

/**
 * The category of one document. Bookings split by kind; anything that is not a
 * stay is a day trip, matching the booking collection's own default.
 */
export function categoryForCollection(collectionKey: string, data?: unknown): SchemaCategoryKey | null {
  const matches = categoriesForCollection(collectionKey);
  if (matches.length <= 1) return matches[0]?.key ?? null;
  const kind = isRecord(data) && data.kind === 'stay' ? 'stay' : 'transport';
  return (matches.find((c) => c.kind === kind) ?? matches[0]).key;
}

/** The categories this site actually has, for the admin screen. */
export function availableSchemaCategories(input: {
  collectionKeys: readonly string[];
  moduleFlags: Record<string, boolean>;
  bookingKinds?: readonly string[];
}): SchemaCategory[] {
  return SCHEMA_CATEGORIES.filter(
    (c) =>
      input.collectionKeys.includes(c.collection) &&
      (!c.module || input.moduleFlags[c.module]) &&
      (!c.kind || (input.bookingKinds ?? ['transport', 'stay']).includes(c.kind)),
  );
}
