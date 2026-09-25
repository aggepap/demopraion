/**
 * The built-in SEO/AEO field set — present on every collection, always.
 *
 * Unlike `core/fields` (admin-*defined* fields, which exist only once someone
 * creates them), these 15 are declared here in code. An empty settings blob
 * still yields the full set: there is no seeder, and a fresh database has the
 * same SEO surface as a five-year-old one. `field-overrides.ts` layers an
 * admin's relabelling/reordering/disabling on top.
 *
 * ## Two storage backings, one list
 *
 * Six of these map onto SEO columns the `documents` table has carried since the
 * beginning (`meta_title`, `meta_description`, `canonical_path`, `noindex` +
 * `nofollow`, `include_in_sitemap`, `og_image_uuid`). Five of those six had no
 * UI at all — they were in the schema, in `DocumentWriteInput` and in the write
 * route's zod body, and nothing on any screen could set them. Reusing them is
 * what keeps this change free of a migration AND free of a second copy of the
 * meta title that could drift from the one the frontend reads.
 *
 * The remaining nine are new, and live in the document's `data` JSON under
 * `data.seo.<key>` — compiled into an ordinary `Field` group exactly the way
 * custom fields are, so the zod validator, the admin form and the version
 * snapshot all pick them up with no further work.
 *
 * `storage` is the discriminator, and the SEO panel is the only place that has
 * to care: a `column` field gets a bespoke control bound to the form's document
 * state, a `data` field goes through the normal `FieldInput` registry.
 *
 * ## Localization
 *
 * The group is compiled WITHOUT `shared: true` — the opposite of the custom
 * group. `documents` holds one row per locale, so `data` is already per-locale,
 * and SEO copy is exactly the kind of thing that must differ between languages.
 * (The custom group is shared because product specs are structural data.)
 *
 * Plain data + pure functions, no `server-only`: the admin client and the write
 * validator have to agree about what a field is, and the only way to guarantee
 * that is for both to read this file.
 */
import { f, type Field } from '../../config';

/** Which tab of the editor's SEO panel a field appears under. */
export const SEO_TABS = [
  { key: 'general', label: 'General' },
  { key: 'social', label: 'Social' },
  { key: 'aeo', label: 'AEO' },
  { key: 'advanced', label: 'Advanced' },
] as const;

export type SeoTab = (typeof SEO_TABS)[number]['key'];

export const SEO_TAB_KEYS: readonly SeoTab[] = SEO_TABS.map((t) => t.key);

/** Where a field's value actually lives. See the module header. */
export type SeoStorage = 'column' | 'data';

/**
 * The document-level target of a `column` field.
 *
 * `robots` is the odd one: it is a single select in front of the `noindex` and
 * `nofollow` booleans, because those two are never usefully thought about
 * separately and a pair of checkboxes invites the nonsense combinations.
 */
export type SeoColumn =
  | 'metaTitle'
  | 'metaDescription'
  | 'robots'
  | 'includeInSitemap'
  | 'ogImageUuid';

/**
 * A soft length target, shown as a character counter that goes amber outside
 * the range.
 *
 * Deliberately NOT validation. The reference implementation this set comes from
 * enforces `min: 50` on the meta description at the schema level; doing that
 * here would make every existing document unsaveable until someone rewrote its
 * description, which is a migration disguised as a rule. The hard caps stay at
 * the column widths; this carries the advice.
 */
export interface SeoCounter {
  min?: number;
  max: number;
}

export interface SeoFieldDef {
  /** Key under `data.seo` (for `data`) or identity of the control (for `column`). */
  key: string;
  tab: SeoTab;
  storage: SeoStorage;
  /** Set iff `storage === 'column'`. */
  column?: SeoColumn;
  /** The core descriptor: label, kind, options, limits. */
  field: Field;
  counter?: SeoCounter;
  /** Display order within the whole set. Gaps left for admin reordering. */
  order: number;
  /** True for the 15 declared here; false for admin-added extras. */
  builtIn: boolean;
}

// ── The robots codec ─────────────────────────────────────────────────────────

/** The four combinations, in the reference implementation's exact vocabulary. */
export const ROBOTS_OPTIONS = [
  { value: 'index, follow', label: 'Index, follow (default)' },
  { value: 'noindex, follow', label: 'No index, follow' },
  { value: 'index, nofollow', label: 'Index, no follow' },
  { value: 'noindex, nofollow', label: 'No index, no follow' },
] as const;

export const ROBOTS_DEFAULT = 'index, follow';

/** The two booleans → the select's value. */
export function robotsValue(noindex: boolean, nofollow: boolean): string {
  return `${noindex ? 'noindex' : 'index'}, ${nofollow ? 'nofollow' : 'follow'}`;
}

/** The select's value → the two booleans. Anything unrecognised reads as the
 *  permissive default, so a hand-edited value can never quietly de-index a page. */
export function robotsColumns(value: unknown): { noindex: boolean; nofollow: boolean } {
  const known = ROBOTS_OPTIONS.some((o) => o.value === value);
  if (!known) return { noindex: false, nofollow: false };
  const v = value as string;
  return { noindex: v.startsWith('noindex'), nofollow: v.includes('nofollow') };
}

// ── The built-ins ────────────────────────────────────────────────────────────

const column = (
  key: string,
  col: SeoColumn,
  tab: SeoTab,
  order: number,
  field: Field,
  counter?: SeoCounter
): SeoFieldDef => ({
  key,
  tab,
  storage: 'column',
  column: col,
  field,
  counter,
  order,
  builtIn: true,
});

const data = (
  key: string,
  tab: SeoTab,
  order: number,
  field: Field,
  counter?: SeoCounter
): SeoFieldDef => ({ key, tab, storage: 'data', field, counter, order, builtIn: true });

/**
 * The 15 built-in fields, in default display order.
 *
 * Orders are spaced by 10 so an admin reordering one field does not have to
 * renumber the rest.
 */
export const SEO_FIELD_DEFS: readonly SeoFieldDef[] = [
  // ── General ────────────────────────────────────────────────────────────────
  column(
    'seoTitle',
    'metaTitle',
    'general',
    10,
    f.text('seoTitle', {
      label: 'SEO title',
      // The cap is the column width; the counter carries the advice. Saying both
      // numbers would only raise the question of which one matters.
      maxLength: 255,
      description:
        'The clickable headline in search results. Around 60 characters is what Google shows before it cuts the rest off. Leave empty to use the page title.',
    }),
    { min: 10, max: 60 }
  ),
  column(
    'metaDescription',
    'metaDescription',
    'general',
    20,
    f.textarea('metaDescription', {
      label: 'Meta description',
      maxLength: 320,
      rows: 3,
      description:
        'The grey summary under the title in search results. Aim for 50–160 characters — longer gets truncated, and the cut-off words are wasted.',
    }),
    { min: 50, max: 160 }
  ),
  data(
    'focusKeywords',
    'general',
    30,
    f.repeater(
      'focusKeywords',
      [f.text('keyword', { label: 'Keyword', maxLength: 80, required: true })],
      {
        label: 'Focus keywords',
        itemLabel: 'Keyword',
        max: 10,
        description:
          'The searches this page is meant to win. Used for your own tracking — not published as a meta tag.',
      }
    )
  ),

  // ── Social ─────────────────────────────────────────────────────────────────
  data(
    'ogTitle',
    'social',
    40,
    f.text('ogTitle', {
      label: 'Social title',
      maxLength: 90,
      description:
        'The title shown when the page is shared on Facebook, LinkedIn or WhatsApp. Empty falls back to the SEO title.',
    }),
    { max: 90 }
  ),
  data(
    'ogDescription',
    'social',
    50,
    f.textarea('ogDescription', {
      label: 'Social description',
      maxLength: 200,
      rows: 3,
      description: 'The summary under the shared link. Empty falls back to the meta description.',
    }),
    { max: 200 }
  ),
  column(
    'ogImage',
    'ogImageUuid',
    'social',
    60,
    f.image('ogImage', {
      label: 'Social image',
      description:
        'The picture shown when the page is shared. 1200×630 is the size every network crops to.',
    })
  ),
  data(
    'twitterCard',
    'social',
    70,
    f.select('twitterCard', {
      label: 'Twitter card',
      options: [
        { value: 'summary_large_image', label: 'Large image' },
        { value: 'summary', label: 'Small thumbnail' },
      ],
      description: 'How the link unfurls on X/Twitter. Large image is the usual choice.',
    })
  ),

  // ── AEO (answer-engine optimization) ───────────────────────────────────────
  data(
    'faqs',
    'aeo',
    80,
    f.repeater(
      'faqs',
      [
        f.text('question', { label: 'Question', maxLength: 400, required: true }),
        f.textarea('answer', {
          label: 'Answer',
          maxLength: 5000,
          rows: 4,
          required: true,
          description:
            'Plain text. This is the wording Google and AI assistants may quote verbatim.',
        }),
      ],
      {
        label: 'FAQs',
        itemLabel: 'Question',
        max: 20,
        description:
          'Published as an FAQ block search engines can read. Answer the question in the first sentence.',
      }
    )
  ),
  data(
    'keyFacts',
    'aeo',
    90,
    f.repeater(
      'keyFacts',
      [
        /*
         * A textarea, and a generous cap.
         *
         * It was a 200-character single-line input, on the theory that a "key
         * fact" is a short statement. Real imported articles disagree: a fact
         * with its qualification ("Open 9–5 on weekdays, except in August, when
         * …") runs past 200 easily, and the import failed the whole document
         * over it rather than storing a sentence.
         *
         * The remaining cap is not advice about length — it is the bound that
         * keeps a single field from being an unbounded write into the document
         * JSON. It matches the FAQ answer beside it, which is the same kind of
         * prose.
         */
        f.textarea('fact', { label: 'Fact', maxLength: 5000, rows: 2, required: true }),
      ],
      {
        label: 'Key facts',
        itemLabel: 'Fact',
        max: 12,
        description:
          'Short, checkable statements about this page. Stored for AI enrichment — not yet shown on the page.',
      }
    )
  ),
  data(
    'answerSummary',
    'aeo',
    100,
    f.textarea('answerSummary', {
      label: 'Answer summary',
      maxLength: 800,
      rows: 4,
      description:
        'The whole page in a paragraph, written so an assistant could read it aloud as the answer.',
    }),
    { max: 800 }
  ),
  data(
    'prosCons',
    'aeo',
    110,
    f.repeater(
      'prosCons',
      [
        f.text('pro', { label: 'Pro', maxLength: 200 }),
        f.text('con', { label: 'Con', maxLength: 200 }),
      ],
      {
        label: 'Pros and cons',
        itemLabel: 'Pair',
        max: 10,
        description:
          'One pro and one con per row. Stored for AI enrichment — not yet shown on the page.',
      }
    )
  ),

  // ── Advanced ───────────────────────────────────────────────────────────────
  /*
   * NOT the `canonical_path` column, despite the obvious name match.
   *
   * That column carries `unique('uniq_documents_canonical_path')` because it is
   * the routing index every path→document lookup goes through. A canonical
   * override is the opposite thing: its entire purpose is to point a duplicate
   * page at the address of the original, so two documents naming one URL is the
   * normal case — and the unique index would refuse the second one with a
   * database error at save time. It is also derived from the slug, so an editor
   * clearing this box would have to be given back a value they never typed.
   *
   * So the override lives in `data.seo` and the column stays what it has always
   * been. `documentSeo` reads this one; `localizedMetadata` prefers it over the
   * computed path.
   */
  data(
    'canonicalUrl',
    'advanced',
    120,
    f.text('canonicalUrl', {
      label: 'Canonical URL',
      maxLength: 512,
      description:
        'Only fill this in if this page duplicates another one — put the original’s address here. Empty means this page is its own original, which is almost always right.',
    })
  ),
  column(
    'robots',
    'robots',
    'advanced',
    130,
    f.select('robots', {
      label: 'Search engine visibility',
      options: ROBOTS_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
      default: ROBOTS_DEFAULT,
      description:
        'No index takes the page out of search results. Links on it are still followed unless you say otherwise.',
    })
  ),
  column(
    'includeInSitemap',
    'includeInSitemap',
    'advanced',
    140,
    f.boolean('includeInSitemap', {
      label: 'List in the sitemap',
      default: true,
      description: 'Uncheck to keep the page out of sitemap.xml. It stays reachable and indexable.',
    })
  ),
  data(
    'schemaOverride',
    'advanced',
    150,
    f.code('schemaOverride', {
      label: 'Structured data override',
      language: 'json',
      rows: 8,
      description:
        'Advanced. Valid JSON-LD pasted here REPLACES everything this page would otherwise tell search engines. Leave empty unless you know you need it.',
    })
  ),
];

/** Fast lookup by key. */
export const SEO_FIELD_BY_KEY: ReadonlyMap<string, SeoFieldDef> = new Map(
  SEO_FIELD_DEFS.map((d) => [d.key, d])
);

/** The `data` key the JSON-backed SEO values nest under. */
export const SEO_FIELDS_DATA_KEY = 'seo';

/** Built-in keys, for the admin manager and for rejecting collisions. */
export const SEO_BUILTIN_KEYS: readonly string[] = SEO_FIELD_DEFS.map((d) => d.key);
