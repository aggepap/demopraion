/**
 * Site configuration — the one file each site owns (`cms.config.ts`).
 *
 * `defineConfig` validates the whole collection set (unique keys, valid
 * relation targets, sane locales) at module-load time so a misconfigured
 * site fails fast and loudly rather than at the first bad query.
 */
import type { BrandDefaults } from '../core/brand/policy';
import { resolveCollection, type CollectionDefinition, type ResolvedCollection } from './collection';
import { walkFields, type Field, type FieldLabel } from './fields';
import {
  isPmArchiveType,
  isPmDocumentPageType,
  PM_WRITABLE_KEYS,
  type PmArchiveType,
} from './pm-types';

/** Optional module toggles. A site enables only what it uses. */
export interface ModuleFlags {
  commerce?: boolean;
  booking?: boolean;
  forms?: boolean;
  seo?: boolean;
  newsletter?: boolean;
  /** Shop accounts (register at checkout, order history). Needs `commerce`. */
  customers?: boolean;
  /** Google reviews + testimonials, placed with a shortcode. */
  googleReviews?: boolean;
  /** Popups over the page, targeted per path. */
  popups?: boolean;
  media?: boolean;
  /** The Product Manager bridge (`/api/cms/pm/v1`). Off unless a site opts in. */
  pm?: boolean;
}

/** A virtual archive PM can address: a Next route with no document behind it. */
export interface PmArchiveDefinition {
  /** Public path, e.g. `/insights`. Must start with `/`. */
  path: string;
  /** Optional human label for PM's page list; defaults to the path. */
  label?: string;
}

/** Site-level settings for the PM bridge. */
export interface PmConfig {
  /**
   * Home, blog index, shop index and 404 are routes, not documents, so they
   * cannot hang off a collection. They read and write per-path SEO overrides
   * only — there is no body and no slug to change.
   */
  archives?: Partial<Record<PmArchiveType, PmArchiveDefinition>>;
}

/**
 * A last-moment adjustment to a collection's fields, made per request against
 * whatever the site's settings currently say.
 *
 * The field set in a `defineCollection` call is fixed at module load; settings
 * live in the database. This is the seam between the two — a module can hide a
 * field, change a default, or narrow a select based on how the site is
 * configured today, without the core knowing what any of it means.
 *
 * It runs inside `mergeCustomFields`, which is the single funnel BOTH the
 * editor and the validator go through. That is the whole point: a resolver
 * applied in one and not the other would produce a document the form cannot
 * satisfy and the API will not accept.
 *
 * `ctx.data` is the document being edited or written, so a resolver can decline
 * to hide a field the document already depends on.
 */
export type FieldResolver = (
  fields: Field[],
  ctx: { data?: Record<string, unknown> },
) => Field[] | Promise<Field[]>;

export interface CmsConfigInput {
  /** Site display name, shown in the admin chrome. */
  name?: string;
  locales: string[];
  defaultLocale: string;
  modules?: ModuleFlags;
  collections: CollectionDefinition[];
  /** Per-collection field resolvers, keyed by collection key. */
  fieldResolvers?: Record<string, FieldResolver>;
  /** Product Manager bridge settings. Only meaningful when `modules.pm` is on. */
  pm?: PmConfig;
  /**
   * Prefix for everything the site stores in a visitor's browser
   * (`<prefix>-cart`, `<prefix>-cookie-consent`, …), and so for the names the
   * cookie declaration publishes. Lowercase letters and digits, dash-separated.
   * Defaults to `site`. Changing it on a live site empties returning visitors'
   * carts and re-asks their consent.
   */
  storagePrefix?: string;
  /**
   * The origin that IS production, e.g. `https://example.com`. Staging shares
   * `NEXT_PUBLIC_SITE_URL`'s role, so this is the only way to tell the live
   * deploy apart (robots.txt, the PM bridge). Omit it and no deploy is treated
   * as production.
   */
  productionOrigin?: string;
  /**
   * The brand's code defaults (usually `src/site.brand.ts`). The live brand is
   * edited in Admin → Settings → Branding and stored in the database; these are
   * only what a fresh or unreachable database falls back to.
   */
  brand?: BrandDefaults;
}

export interface CmsConfig {
  name: string;
  /** See `CmsConfigInput.brand`. Always carries a name — `name` when not given. */
  brand: BrandDefaults & { name: string };
  /** See `CmsConfigInput.storagePrefix`. Always set; `site` when not declared. */
  storagePrefix: string;
  /** See `CmsConfigInput.productionOrigin`. No trailing slash; null when not declared. */
  productionOrigin: string | null;
  locales: string[];
  defaultLocale: string;
  modules: Required<ModuleFlags>;
  collections: ResolvedCollection[];
  /** Fast lookup by collection key. */
  collectionByKey: Map<string, ResolvedCollection>;
  /**
   * URL segments that are not a collection key but clearly mean one — the
   * plural the admin's own labels put in front of the user, and the plural of
   * the key itself. Maps to the canonical key so a route can redirect instead
   * of 404ing.
   *
   * The `page` collection is labelled "Pages" everywhere in the admin, so
   * `/admin/pages` is the URL anyone types or half-remembers, and it used to be
   * a dead end. Never contains a real key, and never an alias two collections
   * both claim — an ambiguous guess is worse than a 404.
   */
  collectionKeyByAlias: Map<string, string>;
  /** See `FieldResolver`. Empty when the site declares none. */
  fieldResolvers: Record<string, FieldResolver>;
  /** See `PmConfig`. Always present; `archives` is `{}` when none are declared. */
  pm: Required<PmConfig>;
}

const DEFAULT_MODULES: Required<ModuleFlags> = {
  commerce: false,
  booking: false,
  forms: true,
  seo: true,
  newsletter: false,
  customers: false,
  googleReviews: false,
  popups: false,
  media: true,
  // Clones inherit the bridge code and switch it on deliberately: it grants an
  // external system write access to every published page, which is not a thing
  // to acquire by default.
  pm: false,
};

class ConfigError extends Error {
  constructor(message: string) {
    super(`cms.config: ${message}`);
    this.name = 'ConfigError';
  }
}

export function defineConfig(input: CmsConfigInput): CmsConfig {
  if (input.locales.length === 0) {
    throw new ConfigError('`locales` must list at least one locale.');
  }
  if (!input.locales.includes(input.defaultLocale)) {
    throw new ConfigError(
      `\`defaultLocale\` "${input.defaultLocale}" is not in \`locales\` [${input.locales.join(', ')}].`,
    );
  }
  if (input.collections.length === 0) {
    throw new ConfigError('at least one collection is required.');
  }

  const resolved = input.collections.map(resolveCollection);
  const byKey = new Map<string, ResolvedCollection>();

  for (const c of resolved) {
    if (!/^[a-z][a-z0-9_]*$/.test(c.key)) {
      throw new ConfigError(
        `collection key "${c.key}" must be lowercase alphanumeric/underscore and start with a letter.`,
      );
    }
    if (byKey.has(c.key)) {
      throw new ConfigError(`duplicate collection key "${c.key}".`);
    }
    byKey.set(c.key, c);
  }

  // Second pass: validate field keys (unique per level) and relation targets.
  for (const c of resolved) {
    walkFields(c.fields, (field, path) => {
      if (!/^[a-z][a-zA-Z0-9_]*$/.test(field.key)) {
        throw new ConfigError(
          `collection "${c.key}" field "${path.join('.')}" has an invalid key.`,
        );
      }
      if (field.kind === 'relation' && !byKey.has(field.to)) {
        throw new ConfigError(
          `collection "${c.key}" relation "${path.join('.')}" targets unknown collection "${field.to}".`,
        );
      }
    });

    // Sibling key uniqueness at each level.
    assertUniqueSiblings(c.key, c.fields);

    assertPmCollection(c);
    assertUnpublishRedirect(c);
  }

  assertPmArchives(input.pm);

  return {
    name: input.name ?? 'CMS',
    brand: { ...input.brand, name: input.brand?.name || input.name || 'CMS' },
    storagePrefix: resolveStoragePrefix(input.storagePrefix),
    productionOrigin: resolveProductionOrigin(input.productionOrigin),
    locales: input.locales,
    defaultLocale: input.defaultLocale,
    modules: { ...DEFAULT_MODULES, ...input.modules },
    collections: resolved,
    collectionByKey: byKey,
    collectionKeyByAlias: buildAliases(resolved, byKey),
    fieldResolvers: input.fieldResolvers ?? {},
    pm: { archives: input.pm?.archives ?? {} },
  };
}

/**
 * An unpublish redirect writes a rule served on the live site, so a mistake here
 * is not cosmetic: a taxonomy field that is not an indexed relation would never
 * find a category, and a fallback like `//host` would be an off-site redirect.
 */
function assertUnpublishRedirect(c: ResolvedCollection): void {
  const spec = c.unpublishRedirect;
  if (!spec) return;
  const where = `collection "${c.key}" unpublishRedirect`;
  if (!c.routing.pathTemplate) {
    throw new ConfigError(`${where} needs a routing.pathTemplate — a collection with no public URL has nothing to redirect.`);
  }
  // Top level only: `document_relations` indexes top-level relation fields.
  const field = c.fields.find((x) => x.key === spec.taxonomyField);
  if (!field || field.kind !== 'relation') {
    throw new ConfigError(`${where}.taxonomyField "${spec.taxonomyField}" must be a top-level relation field.`);
  }
  if (!/^\/(?![/\\])/.test(spec.fallbackPath)) {
    throw new ConfigError(`${where}.fallbackPath "${spec.fallbackPath}" must be an internal path starting with a single "/".`);
  }
  if (spec.termPathTemplate !== undefined && !(/^\/(?![/\\])/.test(spec.termPathTemplate) && spec.termPathTemplate.includes('{slug}'))) {
    throw new ConfigError(
      `${where}.termPathTemplate "${spec.termPathTemplate}" must be an internal path starting with a single "/" and contain {slug}.`,
    );
  }
}

/** Lowercase letters and digits in dash-separated runs: `acme`, `acme-shop`. */
const STORAGE_PREFIX_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The prefix every browser key is named with. Neutral by default so no site
 * inherits another's name; restricted so it is safe inside a storage key, a
 * cookie name and a DOM event name alike.
 */
function resolveStoragePrefix(prefix: string | undefined): string {
  if (prefix === undefined) return 'site';
  if (!STORAGE_PREFIX_PATTERN.test(prefix)) {
    throw new ConfigError(
      `\`storagePrefix\` "${prefix}" must be lowercase letters and digits, dash-separated (e.g. "acme-shop").`,
    );
  }
  return prefix;
}

/**
 * A bare http(s) origin with no path, stored without a trailing slash so it
 * compares equal to `siteOrigin()`. Anything else is refused at load: a typo
 * here would silently mark production as staging and noindex the live site.
 */
function resolveProductionOrigin(origin: string | undefined): string | null {
  if (origin === undefined) return null;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new ConfigError(`\`productionOrigin\` "${origin}" is not a URL.`);
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.pathname !== '/' || url.search || url.hash) {
    throw new ConfigError(
      `\`productionOrigin\` "${origin}" must be a bare http(s) origin such as "https://example.com".`,
    );
  }
  return url.origin;
}

/**
 * Validate a collection's PM bridge declarations.
 *
 * Every check here exists because the failure it prevents is silent. A typo'd
 * `pmFieldMap` path resolves to nothing, so the push reports success and writes
 * nowhere — forever, on every sync, with no error anywhere. Failing at module
 * load instead costs one restart.
 */
function assertPmCollection(c: ResolvedCollection): void {
  if (c.pmPageType !== undefined && !isPmDocumentPageType(c.pmPageType)) {
    throw new ConfigError(
      `collection "${c.key}" has pmPageType "${c.pmPageType}", which is not a Product Manager ` +
        'document page type. Archives are declared under the top-level `pm.archives` block.',
    );
  }

  if (c.pmPageType !== undefined && !c.routing?.pathTemplate && !c.seo) {
    throw new ConfigError(
      `collection "${c.key}" declares pmPageType "${c.pmPageType}" but has neither ` +
        '`routing.pathTemplate` nor `seo` — Product Manager would have no way to address it.',
    );
  }

  if (!c.pmFieldMap) return;

  if (c.pmPageType === undefined) {
    throw new ConfigError(
      `collection "${c.key}" declares pmFieldMap but no pmPageType, so it is not exposed to ` +
        'Product Manager at all and the mapping can never apply.',
    );
  }

  // Collect every addressable dot path once, then check the map against it.
  const paths = new Set<string>();
  walkFields(c.fields, (_field, path) => {
    paths.add(path.join('.'));
  });

  for (const [key, path] of Object.entries(c.pmFieldMap)) {
    if (!(PM_WRITABLE_KEYS as readonly string[]).includes(key)) {
      throw new ConfigError(
        `collection "${c.key}" pmFieldMap has unknown key "${key}". ` +
          `Expected one of: ${PM_WRITABLE_KEYS.join(', ')}.`,
      );
    }
    if (typeof path !== 'string' || path === '') continue;
    // `slug` is a column on `documents`, not a path inside `data`, so remapping
    // it would point at something that does not exist.
    if (key === 'slug') {
      throw new ConfigError(
        `collection "${c.key}" pmFieldMap cannot remap "slug" — it is a document column, ` +
          'not a field inside `data`.',
      );
    }
    if (!paths.has(path)) {
      throw new ConfigError(
        `collection "${c.key}" pmFieldMap.${key} points at "${path}", which is not a field ` +
          'in this collection.',
      );
    }
  }
}

/** Archive paths are the only addressing PM has for a page with no document. */
function assertPmArchives(pm: PmConfig | undefined): void {
  if (!pm?.archives) return;
  for (const [type, def] of Object.entries(pm.archives)) {
    if (!isPmArchiveType(type)) {
      throw new ConfigError(`pm.archives has unknown archive type "${type}".`);
    }
    if (!def || typeof def.path !== 'string' || !def.path.startsWith('/')) {
      throw new ConfigError(`pm.archives.${type}.path must be a path starting with "/".`);
    }
  }
}

/**
 * The comparable form of a URL segment or a label: lowercased, with every run
 * of non-alphanumerics collapsed to a dash.
 *
 * Unicode-aware on purpose. Greek is this site's default locale, so the labels
 * a reader sees — and would type — are Greek ("Άρθρα"), and a Latin-only
 * character class silently reduced those to the empty string, producing no
 * alias at all. Both sides of the lookup go through this, so `/admin/Pages`
 * resolves for the same reason `/admin/pages` does.
 */
export function collectionAliasKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

/** Every spelling of a label: a plain string, or one per locale. */
function labelForms(label: FieldLabel | undefined): string[] {
  if (!label) return [];
  return typeof label === 'string' ? [label] : Object.values(label);
}

function buildAliases(
  collections: ResolvedCollection[],
  byKey: Map<string, ResolvedCollection>,
): Map<string, string> {
  const aliases = new Map<string, string>();
  const ambiguous = new Set<string>();

  for (const c of collections) {
    const candidates = [
      `${c.key}s`,
      ...labelForms(c.label).map(collectionAliasKey),
      ...labelForms(c.labelPlural).map(collectionAliasKey),
    ];
    for (const candidate of candidates) {
      // A real key always wins, and an empty slug is not an alias.
      if (!candidate || byKey.has(candidate)) continue;
      const claimed = aliases.get(candidate);
      if (claimed && claimed !== c.key) {
        ambiguous.add(candidate);
        continue;
      }
      aliases.set(candidate, c.key);
    }
  }

  for (const key of ambiguous) aliases.delete(key);
  return aliases;
}

function assertUniqueSiblings(
  collectionKey: string,
  fields: { key: string; kind: string; fields?: unknown }[],
): void {
  const seen = new Set<string>();
  for (const field of fields) {
    if (seen.has(field.key)) {
      throw new ConfigError(
        `collection "${collectionKey}" has duplicate sibling field key "${field.key}".`,
      );
    }
    seen.add(field.key);
    if ((field.kind === 'repeater' || field.kind === 'group') && Array.isArray(field.fields)) {
      assertUniqueSiblings(collectionKey, field.fields as { key: string; kind: string }[]);
    }
  }
}
