/**
 * A `.md` file → the document an editor is about to save.
 *
 * Nothing here writes. The result is handed back to the admin form, which
 * pre-fills itself and lets a person look at it before pressing Save — so a
 * malformed file costs a message, not a row that somebody has to find and
 * delete later. The real write still goes through `createDocument`, which stays
 * the one place validation, the MDX guard, relations and versioning happen.
 *
 * Pure apart from two dynamic imports (the MDX parser and the heading slugger),
 * both of which are ESM-only and must be reached this way to survive the `tsx`
 * CLI — see the long note in `core/fields/mdx-validate.ts`.
 */
import { buildDataSchema, walkFields, type Field, type ResolvedCollection } from '../../config';
import { documentStatusValues } from '../../db/adapters/mysql/schema/documents';
import { findMdxFieldErrors } from '../fields/mdx-validate';
import { slugify } from '../slug';
import { coerceFields, ProblemCollector, type ImportProblem } from './coerce';
import { FrontmatterError, parseFrontmatterBlock, splitFrontmatter } from './frontmatter';

export type { ImportProblem } from './coerce';

/**
 * Frontmatter keys that address the `documents` row rather than its `data` JSON.
 *
 * A collection may not declare a field with one of these keys — `assertNoReservedFieldKeys`
 * refuses at parse time rather than letting the collision decide silently which
 * of the two meanings wins. None collide today; the template test keeps it that way.
 */
export const RESERVED_KEYS = [
  'collection',
  'slug',
  'locale',
  'status',
  'metaTitle',
  'metaDescription',
  'noindex',
  'nofollow',
  'includeInSitemap',
  'publishedAt',
  'modifiedAt',
  'scheduledFor',
] as const;

/**
 * Keys that look like they belong but deliberately do not, each with the reason.
 *
 * Without these an author who writes `canonicalPath:` gets "there is no setting
 * called canonicalPath", which is true and useless — the interesting part is
 * that the concept exists under a different name.
 */
const REFUSED_KEYS: Record<string, string> = {
  canonicalPath:
    'the public path is derived from the slug and cannot be set by hand. For a cross-page canonical, use the `seo` block\'s `canonicalUrl`.',
  ogImageUuid: 'social images are chosen from the media library, in the form.',
  translationGroup:
    'translations are linked by the form: open the existing document and import this file into its other language tab.',
  translationGroupId:
    'translations are linked by the form: open the existing document and import this file into its other language tab.',
  id: 'the document id is assigned when you save.',
  type: 'the collection is decided by the screen you import from. Use `collection:` if you want the file to assert which one it is.',
};

/** The shape the admin form pre-fills itself from. Mirrors one language tab. */
export interface ImportedDocument {
  /** What the file claims it is, when it said so. Asserted by the caller. */
  collection: string | null;
  slug: string;
  /** `null` when the file did not say — the form keeps its current tab. */
  locale: string | null;
  status: string;
  data: Record<string, unknown>;
  metaTitle: string;
  metaDescription: string;
  /** `null` means "not stated" — the form keeps whatever it already had. */
  noindex: boolean | null;
  nofollow: boolean | null;
  includeInSitemap: boolean | null;
  /** `YYYY-MM-DD`, or `''` when absent. Matches the form's date inputs. */
  publishedAt: string;
  modifiedAt: string;
  scheduledFor: string;
}

export interface ParsedImport {
  document: ImportedDocument;
  /** Things that must be fixed in the file. A non-empty list means do not apply. */
  errors: ImportProblem[];
  /** Things worth knowing: derived values, tolerated coercions, missing required fields. */
  warnings: ImportProblem[];
}

export interface ParseOptions {
  collection: ResolvedCollection;
  source: string;
  /** Original filename, used to derive the slug and the locale. */
  filename?: string;
  /** Site locales, so a stated `locale:` can be checked and localized fields typed. */
  locales: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Refuse a collection whose field keys shadow the document-level settings.
 *
 * Exported so the template generator and its test can assert it for every
 * collection in the config, which is where such a collision would be introduced.
 */
export function reservedFieldKeyCollisions(fields: Field[]): string[] {
  const reserved = new Set<string>(RESERVED_KEYS);
  return fields.filter((f) => reserved.has(f.key)).map((f) => f.key);
}

/** The collection's body field: a top-level `f.mdx`. */
export function mdxBodyField(fields: Field[]): Field | null {
  const bodies = fields.filter((f) => f.kind === 'code' && f.language === 'mdx');
  return bodies.length === 1 ? bodies[0] : null;
}

/**
 * A `toc`-shaped repeater: a list of `{ id, label }`.
 *
 * Matched on shape rather than on the name `toc` so the derivation follows the
 * field set instead of a convention — a collection that renames it still gets
 * its contents filled in, and one that happens to have a `toc` of some other
 * shape is left alone.
 */
function tocField(fields: Field[]): Extract<Field, { kind: 'repeater' }> | null {
  for (const field of fields) {
    if (field.kind !== 'repeater') continue;
    const keys = new Set(field.fields.map((f) => f.key));
    if (keys.has('id') && keys.has('label')) return field;
  }
  return null;
}

/** Fence-aware `##` heading extraction — a heading inside a code block is a code sample. */
export function extractHeadings(body: string): string[] {
  const out: string[] = [];
  let fence: string | null = null;

  for (const line of body.split('\n')) {
    const fenceMatch = /^\s*(```+|~~~+)/.exec(line);
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1][0];
      else if (fenceMatch[1][0] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;

    const heading = /^##[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line);
    if (heading) out.push(heading[1]);
  }
  return out;
}

/**
 * Heading source → the text the page actually renders.
 *
 * The ids have to match what `src/mdx-components.tsx` produces at render time,
 * and that slugs the *flattened text* of the heading node. So the inline markup
 * has to come off first: `## Why **this** matters` renders as "Why this
 * matters", and slugging the raw line would embed the asterisks in the anchor
 * and break every jump-link in the contents box.
 */
export function headingText(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, '')            // inline JSX/HTML tags
    .replace(/`([^`]*)`/g, '$1')        // inline code
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // links and images → their text
    .replace(/[*_]{1,3}(?=\S)([^*_]*)[*_]{1,3}/g, '$1') // emphasis / strong
    .replace(/\s+/g, ' ')
    .trim();
}

/** `YYYY-MM-DD` for the form's date inputs; `''` when there is nothing usable. */
function toDateInput(value: unknown, key: string, collector: ProblemCollector): string {
  if (value === null || value === undefined || value === '') return '';
  const text = value instanceof Date ? value.toISOString() : String(value).trim();
  const ms = Date.parse(text);
  if (Number.isNaN(ms)) {
    collector.error(`"${key}" is not a date we can read: "${text}". Use 2026-08-24.`);
    return '';
  }
  return new Date(ms).toISOString().slice(0, 10);
}

function toOptionalBoolean(value: unknown, key: string, collector: ProblemCollector): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 'false') return value === 'true';
  collector.error(`"${key}" must be true or false.`);
  return null;
}

function toText(value: unknown, key: string, collector: ProblemCollector): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  collector.error(`"${key}" must be text.`);
  return '';
}

/**
 * `my-post.el.md` → `{ slug: 'my-post', locale: 'el' }`.
 *
 * The locale suffix is the convention the static content already uses
 * (`src/content/insights/articles/<slug>.<locale>.mdx`), so an author moving
 * between the two does not learn a second naming rule.
 */
export function slugFromFilename(
  filename: string,
  locales: string[],
): { slug: string; locale: string | null } {
  const base = filename.replace(/^.*[/\\]/, '').replace(/\.(md|mdx|markdown)$/i, '');
  const match = /^(.*)\.([A-Za-z-]{2,8})$/.exec(base);
  if (match && locales.includes(match[2])) return { slug: slugify(match[1]), locale: match[2] };
  return { slug: slugify(base), locale: null };
}

/** The document's title as a reader sees it, for deriving a slug. Pure. */
function titleFromData(collection: ResolvedCollection, data: Record<string, unknown>): string {
  const path = collection.titlePath;
  const candidates = path ? [path] : ['title', 'name', 'question', 'label', 'headline'];

  for (const candidate of candidates) {
    let node: unknown = data;
    for (const part of candidate.split('.')) {
      node = isRecord(node) ? node[part] : undefined;
    }
    if (typeof node === 'string' && node.trim() !== '') return node;
    if (isRecord(node)) {
      // An accent headline is a group of parts; a reader sees them joined in the
      // order the field set declares, which is the order the object was built in.
      const joined = Object.values(node).filter((v) => typeof v === 'string').join('');
      if (joined.trim() !== '') return joined;
    }
  }
  return '';
}

export async function parseDocumentMarkdown(opts: ParseOptions): Promise<ParsedImport> {
  const { collection, source, filename, locales } = opts;
  const collector = new ProblemCollector();

  const empty: ImportedDocument = {
    collection: null, slug: '', locale: null, status: 'draft', data: {},
    metaTitle: '', metaDescription: '',
    noindex: null, nofollow: null, includeInSitemap: null,
    publishedAt: '', modifiedAt: '', scheduledFor: '',
  };

  const collisions = reservedFieldKeyCollisions(collection.fields);
  if (collisions.length > 0) {
    collector.error(
      `This collection declares ${collisions.map((c) => `"${c}"`).join(', ')}, which clashes with a document setting of the same name. Import cannot tell the two apart.`,
    );
    return { document: empty, errors: collector.errors, warnings: collector.warnings };
  }

  let front: Record<string, unknown>;
  let body: string;
  try {
    const split = splitFrontmatter(source);
    body = split.body;
    front = split.raw === null ? {} : parseFrontmatterBlock(split.raw);
    if (split.raw === null) {
      collector.warn('This file has no settings block, so only the body was imported. Start the file with `---` to set the title and the rest.');
    }
  } catch (err) {
    if (err instanceof FrontmatterError) {
      collector.error(err.line ? `Line ${err.line}: ${err.message}` : err.message);
      return { document: empty, errors: collector.errors, warnings: collector.warnings };
    }
    throw err;
  }

  for (const [key, reason] of Object.entries(REFUSED_KEYS)) {
    if (key in front) collector.error(`"${key}" cannot be set from a file: ${reason}`);
  }

  // ── Split the frontmatter into document settings and field data ────────────
  const reserved = new Set<string>(RESERVED_KEYS);
  const fieldInput: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(front)) {
    if (reserved.has(key) || key in REFUSED_KEYS) continue;
    fieldInput[key] = value;
  }

  const data = coerceFields(collection.fields, fieldInput, '', collector, { strict: true });

  // ── The body becomes the MDX field ─────────────────────────────────────────
  const bodyField = mdxBodyField(collection.fields);
  let bodyText = body.trim() === '' ? '' : body;

  if (bodyText !== '') {
    /*
     * A leading `# Title` is the single most common thing a markdown author
     * writes and the single most wrong thing for this site: `mdx-components.tsx`
     * gives ids to h2/h3 only, so an h1 in the body is an unstyled, unanchored
     * duplicate of the real headline and the contents box cannot link to it.
     * See the same reasoning in `admin/fields/mdx/markdown-actions.ts`, which is
     * why the editor offers no H1 button either.
     */
    // `[^\n]+?` with an explicit end-of-line anchor: a lazy `.+?` followed by
    // optional trailers matches as little as one character, which silently ate
    // "# T" and left the rest of the title as the first line of the body.
    const stripped = bodyText.replace(/^[ \t]*#[ \t]+([^\n]+?)[ \t]*#*[ \t]*(?:\n|$)/, (_m, title: string) => {
      collector.warn(`The body started with the heading "${title}". It was removed — the title belongs in the settings block, and an H1 in the body has no anchor for the contents box to link to.`);
      return '';
    });
    bodyText = stripped.replace(/^\n+/, '');
  }

  if (bodyField) {
    if (bodyText !== '') data[bodyField.key] = bodyText;
  } else if (bodyText !== '') {
    collector.error(
      collection.fields.filter((f) => f.kind === 'code' && f.language === 'mdx').length > 1
        ? 'This collection has more than one markdown body, so there is no way to tell which one the text below the settings belongs to. Set them by name in the settings block instead.'
        : 'This collection has no markdown body, so the text below the settings block has nowhere to go.',
    );
  }

  // ── Derive the contents list from the body's own H2s ───────────────────────
  const toc = tocField(collection.fields);
  // An EMPTY list counts as absent. The generated template ships the contents
  // list commented out, but an author who uncomments it and leaves it empty
  // means "work it out for me", not "this piece has no contents box".
  const tocGiven = Array.isArray(data[toc?.key ?? '']) && (data[toc?.key ?? ''] as unknown[]).length > 0;
  if (toc && bodyText !== '' && !tocGiven) {
    const headings = extractHeadings(bodyText);
    if (headings.length > 0) {
      // The same slugger `src/mdx-components.tsx` runs at render time, so the
      // derived anchors match the real heading ids by construction rather than
      // by an author retyping them and getting one wrong.
      const { slug: ghSlug } = await import('github-slugger');
      data[toc.key] = headings.map((raw) => {
        const text = headingText(raw);
        return { label: text, id: ghSlug(text) };
      });
      collector.warn(`The contents list was filled in from the ${headings.length} "##" heading${headings.length === 1 ? '' : 's'} in the body. Check the wording, or set "${toc.key}" yourself to override it.`);
    }
  }

  // ── Document-level settings ────────────────────────────────────────────────
  const fromFilename = filename ? slugFromFilename(filename, locales) : { slug: '', locale: null };

  // An empty `slug:` is the template's own placeholder, i.e. "work it out for
  // me" — only a slug that was actually typed and produced nothing is a mistake.
  const statedSlug = typeof front.slug === 'string' ? front.slug.trim() : '';
  let slug = slugify(statedSlug);
  if (slug === '' && statedSlug !== '') {
    collector.error(`"slug" has nothing usable in it: "${statedSlug}".`);
  }
  if (slug === '') {
    slug = fromFilename.slug;
    if (slug !== '') collector.warn(`The address was taken from the file name: "${slug}".`);
  }
  if (slug === '') {
    slug = slugify(titleFromData(collection, data));
    if (slug !== '') collector.warn(`The address was made from the title: "${slug}".`);
  }
  if (slug === '') collector.warn('No address could be worked out — set "slug" in the file, or fill it in on the form.');

  let locale: string | null = null;
  if (front.locale !== undefined && front.locale !== null) {
    const stated = String(front.locale);
    if (!locales.includes(stated)) {
      collector.error(`"locale" is "${stated}", which this site does not have. Available: ${locales.join(', ')}.`);
    } else {
      locale = stated;
    }
  } else if (fromFilename.locale) {
    locale = fromFilename.locale;
    collector.warn(`The language was taken from the file name: "${locale}".`);
  }

  let status = 'draft';
  if (front.status !== undefined && front.status !== null) {
    const stated = String(front.status);
    if (!(documentStatusValues as readonly string[]).includes(stated)) {
      collector.error(`"status" is "${stated}". Use one of: ${documentStatusValues.join(', ')}.`);
    } else {
      status = stated;
    }
  }

  const document: ImportedDocument = {
    collection: front.collection === undefined || front.collection === null ? null : String(front.collection),
    slug,
    locale,
    status,
    data,
    metaTitle: toText(front.metaTitle, 'metaTitle', collector),
    metaDescription: toText(front.metaDescription, 'metaDescription', collector),
    noindex: toOptionalBoolean(front.noindex, 'noindex', collector),
    nofollow: toOptionalBoolean(front.nofollow, 'nofollow', collector),
    includeInSitemap: toOptionalBoolean(front.includeInSitemap, 'includeInSitemap', collector),
    publishedAt: toDateInput(front.publishedAt, 'publishedAt', collector),
    modifiedAt: toDateInput(front.modifiedAt, 'modifiedAt', collector),
    scheduledFor: toDateInput(front.scheduledFor, 'scheduledFor', collector),
  };

  if (status === 'scheduled' && document.scheduledFor === '') {
    // The same rule `collections.ts` enforces on write, said here so the author
    // learns it while looking at the file rather than after filling in a form.
    collector.error('A scheduled document needs a publish date — set "scheduledFor", or set "status" back to draft.');
  }

  await addSchemaProblems(collection, data, locales, collector);
  return { document, errors: collector.errors, warnings: collector.warnings };
}

/**
 * Run the real schema over the coerced data, twice, for two different questions.
 *
 * Without `enforceRequired` the schema says what would stop this saving *at all*
 * — a genuine shape violation, which is an error. With it, the extra complaints
 * are exactly the fields that must be filled in before the piece can go live,
 * which is a warning: the CMS has always let a draft be incomplete
 * (`goesLive(status)` in `documents/service.ts`), and an importer that refused
 * half-written work would be stricter than the form it feeds.
 */
async function addSchemaProblems(
  collection: ResolvedCollection,
  data: Record<string, unknown>,
  locales: string[],
  collector: ProblemCollector,
): Promise<void> {
  const mdxErrors = await findMdxFieldErrors(collection.fields, data);
  for (const [path, messages] of Object.entries(mdxErrors)) {
    for (const message of messages) collector.error(message, path);
  }

  const shape = buildDataSchema(collection.fields, locales, { enforceRequired: false }).safeParse(data);
  const blocking = new Set<string>();
  if (!shape.success) {
    for (const issue of shape.error.issues) {
      const path = issue.path.join('.');
      blocking.add(path);
      collector.error(issue.message, path || undefined);
    }
  }

  const live = buildDataSchema(collection.fields, locales, { enforceRequired: true }).safeParse(data);
  if (!live.success) {
    for (const issue of live.error.issues) {
      const path = issue.path.join('.');
      if (blocking.has(path)) continue;
      collector.warn(`Needed before this can be published: ${issue.message}`, path || undefined);
    }
  }
}

/** Every MDX component this collection's body may use, for the template's cheat-sheet. */
export function allowedComponentsFor(fields: Field[]): string[] {
  const names = new Set<string>();
  walkFields(fields, (field) => {
    if (field.kind === 'code' && field.language === 'mdx') {
      for (const name of field.allowedComponents ?? []) names.add(name);
    }
  });
  return [...names].sort();
}
