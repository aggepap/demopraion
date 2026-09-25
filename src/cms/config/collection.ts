/**
 * Collection definitions — a "content type" in CMS terms.
 *
 * A collection maps a `key` (stored in `documents.type`) to its field set,
 * routing, and behaviour flags. Taxonomies (topic, author, …) are ordinary
 * collections; there are no special-cased types in the core.
 */
import type { Field, FieldLabel } from './fields';
import type { PmDocumentPageType, PmWritableKey } from './pm-types';
import type { IconName } from '../admin/ui/icon-names';

export interface CollectionRouting {
  /**
   * Public path template with `{slug}` (and optionally other field
   * placeholders) interpolated at read time, e.g. `/insights/{slug}`.
   * Omit for collections that are never rendered as standalone pages
   * (taxonomies, settings-like singletons).
   */
  pathTemplate?: string;
  /**
   * Slugs a document of this collection may not take, because a static route
   * under the same prefix already answers at that URL. A post collection with a
   * category overview at `/blog/categories` reserves `categories`: a post slugged
   * that way would be saved, listed, and never reachable.
   */
  reservedSlugs?: string[];
}

/**
 * Where a post's URL should send visitors once the post is no longer live.
 *
 * Without it, a draft or archived post's URL falls through to the page-not-found
 * screen, dropping both the visitor and whatever the URL had earned in search.
 * With it, taking the post down writes a redirect (302 for a draft, 301 for an
 * archive) to the first live term in `taxonomyField`, or to `fallbackPath` —
 * the collection's category overview — when there is none. Putting the post live
 * again removes the rule. See `core/seo/unpublish-redirect.ts`.
 */
export interface UnpublishRedirectDefinition {
  /** Top-level relation field holding the post's categories, in order. */
  taxonomyField: string;
  /** Locale-free internal path, e.g. `/blog/categories`. Prefixed per locale. */
  fallbackPath: string;
  /**
   * Where a term sends visitors, when not its own page: `/booking?category={slug}`
   * for terms that are filters on a listing rather than pages. Defaults to the
   * term collection's `routing.pathTemplate`.
   */
  termPathTemplate?: string;
}

/**
 * The listing a `/prefix/{slug}` detail route sits under (`/shop/{slug}` → `/shop`),
 * or null when the template has no such shape. Used to derive a module
 * collection's unpublish fallback from whatever path the site gave it.
 */
export function listingPathOf(pathTemplate: string): string | null {
  const m = /^(\/[^{}?#]*?)\/\{slug\}$/.exec(pathTemplate);
  return m ? m[1] : null;
}

/**
 * How one form section presents itself, keyed by the `section` its fields name.
 *
 * Sections were nothing but a repeated string on each field: every card came out
 * the same weight, expanded, in declaration order, and a booking experience
 * opened as fourteen of them stacked to the horizon. Nothing led, and the four
 * an operator always fills sat among ten they usually do not.
 *
 * Declaring sections is opt-in and changes two things for the collection that
 * does it: the listed cards can start collapsed, and a repeater that names a
 * section joins that section's card instead of becoming a card of its own — so
 * "Pricing" and "Seasonal prices" read as one idea rather than two.
 */
export interface SectionDefinition {
  /** Matches a field's `section`, verbatim. */
  title: string;
  /** Start folded. Optional setup should; anything needed to publish should not. */
  collapsed?: boolean;
  /** One line under the heading, for a group whose purpose is not self-evident. */
  description?: string;
}

export interface CollectionDefinition {
  /** Stable machine key — becomes `documents.type`. Lowercase, no spaces. */
  key: string;
  /** Human label for the admin (single string or per-locale map). */
  label?: FieldLabel;
  /** Plural label for list screens; defaults to `label`. */
  labelPlural?: FieldLabel;
  /** Admin sidebar/list icon — one of the names `<Icon>` draws (`ICON_NAMES`). */
  icon?: IconName;
  fields: Field[];
  /**
   * Dot path to the field that holds the title a person would call this document by.
   *
   * Without it the admin guessed, looking for a top-level `title`, `name`, `question` or
   * `label` — and the editorial collections have none of those: their headline lives in
   * a group (`header.h1`, `headline`). So the list column and the search box fell back
   * to the SEO meta title or the slug, and an editor who renamed an article could not
   * find it by its new name and did not see the change in the list. Nothing had gone
   * wrong; the list was simply describing a different field.
   *
   * The path may point at a string or at a group of string parts — an accent headline is
   * `{ before, accent, after }` — in which case the parts are joined in field order,
   * which is how a reader sees them.
   */
  titlePath?: string;
  routing?: CollectionRouting;
  /** Redirect a post's URL to its category when it is unpublished. */
  unpublishRedirect?: UnpublishRedirectDefinition;
  /** Emit the shared SEO field block (meta title/description, canonical, …). Default true. */
  seo?: boolean;
  /** Keep version snapshots + draft-of-published workflow. Default true. */
  drafts?: boolean;
  /**
   * Singleton collections hold exactly one document per locale (home page,
   * global settings). The admin edits the single row directly rather than
   * showing a list. Default false.
   */
  singleton?: boolean;
  /**
   * Hide from the admin sidebar and dashboard (still API-addressable). Default false.
   *
   * This is about the ADMIN only. Whether a collection has a public page is
   * `routing.pathTemplate` (and the site's sitemap list); a collection an editor
   * writes but visitors never open on its own — testimonials, brand logos,
   * popups — leaves `routing` out and stays visible here.
   */
  hidden?: boolean;
  /**
   * Associate this collection with a module (e.g. `commerce`). When set, the
   * collection is only shown/active while that module flag is enabled — the
   * admin Modules toggle can reveal or hide it without a code change.
   */
  module?: string;

  /**
   * Names a client-side check that reports cross-field problems the field DSL
   * cannot express, keyed into the admin's advisory registry
   * (`src/cms/admin/advisories.ts`).
   *
   * ADVISORY, not a gate: the messages appear beside the fields they concern
   * while the editor types, and the document still saves. A draft is allowed to
   * be incoherent — the alternative is refusing to save a half-built config,
   * which is how a booking's pricing rules used to trap their own editor.
   *
   * A string rather than a function because the resolved collection is
   * serialised to reach the form, exactly as with `noOverlap` and `picker`.
   */
  advisories?: string;

  /**
   * Presentation for this collection's form sections, in the order given. See
   * `SectionDefinition` — omit it and the form renders exactly as it always has.
   *
   * Order here is documentation, not layout: the fields' own declaration order
   * still decides what appears when, because that is the order `buildBlocks`
   * walks. Keeping the two in step is what the collection's own tests check.
   */
  sections?: SectionDefinition[];

  /**
   * The Product Manager page-type vocabulary this collection presents as.
   *
   * **Omit to hide the collection from the PM bridge entirely.** That is the
   * safe default: a collection with no public route (a taxonomy, a size chart)
   * has nothing for PM to score, and exposing it would only invite pushes that
   * praion would have to refuse.
   *
   * Several collections may share one type — identity on the wire is the
   * document id, not the type, and the bridge asserts the resolved document's
   * collection actually declares the requested type before writing.
   */
  pmPageType?: PmDocumentPageType;

  /**
   * PM field key → dot path inside `data`. Only the listed keys are writable.
   *
   * Needed where the obvious target is wrong or absent. Two cases in practice:
   * a title that is a *group* rather than a string (an accent headline is
   * `{before, accent, after}`, and flattening PM's one string into it destroys
   * the styling), and a `short_description` that lives under a different name.
   *
   * Every path here is checked against the real field tree by `defineConfig` —
   * a typo would otherwise be a silent no-op on every push, forever.
   */
  pmFieldMap?: Partial<Record<PmWritableKey, string>>;

  /**
   * Section heading for this collection on Product Manager's Content types page.
   *
   * Shown verbatim — PM does not translate it, because inventing an English name
   * for a grouping praion defined would be a second vocabulary to keep in sync.
   * Ungrouped entries are listed last.
   */
  pmGroup?: string;

  /** One line telling a PM user what this type is for. Optional. */
  pmDescription?: string;
}

/** Normalised collection with defaults applied — what the core consumes. */
export interface ResolvedCollection extends CollectionDefinition {
  label: FieldLabel;
  labelPlural: FieldLabel;
  seo: boolean;
  drafts: boolean;
  singleton: boolean;
  hidden: boolean;
  routing: CollectionRouting;
}

/**
 * Declare a collection. Validation of uniqueness/relations happens later in
 * `defineConfig`, where the full collection set is known.
 */
export function defineCollection(def: CollectionDefinition): CollectionDefinition {
  return def;
}

export function resolveCollection(def: CollectionDefinition): ResolvedCollection {
  return {
    ...def,
    label: def.label ?? def.key,
    labelPlural: def.labelPlural ?? def.label ?? def.key,
    seo: def.seo ?? true,
    drafts: def.drafts ?? true,
    singleton: def.singleton ?? false,
    hidden: def.hidden ?? false,
    routing: def.routing ?? {},
  };
}

/** Would `slug` land on a URL a static route of this collection already owns? */
export function isReservedSlug(collection: Pick<CollectionDefinition, 'routing'>, slug: string): boolean {
  const wanted = slug.trim().toLowerCase();
  return (collection.routing?.reservedSlugs ?? []).some((s) => s.toLowerCase() === wanted);
}
