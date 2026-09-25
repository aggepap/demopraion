/**
 * The `.md` template an author fills in, generated from the collection itself.
 *
 * Generated rather than hand-written because a hand-written template is a second
 * copy of `site.config.ts` that nothing keeps honest: add a field and the
 * template silently stops mentioning it, so nobody fills it in and nobody knows
 * why the page looks wrong. Here the field tree IS the template, and the labels
 * and descriptions an editor already reads in the admin form become the comments
 * they read in the file.
 *
 * The checked-in copies under `docs/templates/` are snapshots of this output;
 * `test/cms/import-template.test.ts` fails when they drift.
 */
import type { Field, FieldLabel, ResolvedCollection } from '../../config';
import { compileSeoGroup, EMPTY_SEO_OVERRIDES, resolveSeoFields } from '../seo/field-overrides';
import { SEO_FIELDS_DATA_KEY } from '../seo/fields';
import { allowedComponentsFor, mdxBodyField, RESERVED_KEYS } from './parse';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function labelOf(label: FieldLabel | undefined, fallback: string): string {
  if (typeof label === 'string' && label.trim() !== '') return label;
  if (isRecord(label)) {
    const first = Object.keys(label)
      .sort()
      .map((k) => label[k])
      .find((v) => typeof v === 'string' && v.trim() !== '');
    if (typeof first === 'string') return first;
  }
  return fallback;
}

/** Double-quoted YAML — the one quoting style that needs no thought about the content. */
const quote = (value: string): string => JSON.stringify(value);

interface Line {
  text: string;
  /** Rendered behind a `# `, so it documents the shape without setting anything. */
  commented: boolean;
}

class Buffer {
  readonly lines: Line[] = [];

  push(text: string, commented: boolean, indent = 0): void {
    this.lines.push({ text: `${'  '.repeat(indent)}${text}`, commented });
  }

  comment(text: string, indent = 0): void {
    this.lines.push({ text: `${'  '.repeat(indent)}${text}`, commented: true });
  }

  render(): string {
    return this.lines
      .map((line) => (line.commented ? (line.text.trim() === '' ? '#' : `# ${line.text}`) : line.text))
      .join('\n');
  }
}

/** A one-line `# Label — description (required)` header for a field. */
function annotate(field: Field, buffer: Buffer, indent: number): void {
  const name = labelOf(field.label, field.key);
  const parts = [name];
  if (field.required) parts.push('(required)');
  buffer.comment(`${parts.join(' ')}${field.description ? ` — ${field.description}` : ''}`, indent);
}

/**
 * Kinds that hold a database identity and so cannot be written in a file.
 * Documented in place instead of omitted: an author who cannot find `author:`
 * in the template will otherwise assume the template is out of date.
 */
const NOT_IN_FILE: Partial<Record<Field['kind'], string>> = {
  image: 'chosen from the media library, in the form',
  relation: 'chosen in the form after importing',
  variations: 'edited in the form',
};

function emitField(
  field: Field,
  buffer: Buffer,
  indent: number,
  commented: boolean,
  /**
   * Emit live even though this field is optional, because the block it sits in
   * is required.
   *
   * Without it a required group whose own children are all optional rendered as
   * a bare `h1:` with every part commented out — which YAML reads as `null`, so
   * the required group arrived MISSING and the author was told "expected object,
   * received null" about a heading they could plainly see in the file. A block
   * you must fill in should come with its blanks already in place.
   */
  force = false,
): void {
  const unavailable = NOT_IN_FILE[field.kind];
  if (unavailable) {
    buffer.comment(`${field.key}: — ${labelOf(field.label, field.key)} is ${unavailable}.`, indent);
    return;
  }

  annotate(field, buffer, indent);

  // An optional field is offered as a commented-out example: the template then
  // imports cleanly as-is, and an author enables exactly what they want rather
  // than deleting the placeholders they do not.
  const off = force ? false : commented || !field.required;

  switch (field.kind) {
    case 'text':
    case 'textarea':
      buffer.push(`${field.key}: ${off ? quote('…') : '""'}`, off, indent);
      break;

    case 'richText':
      buffer.comment(`${field.key}: — rich text is edited in the form.`, indent);
      break;

    case 'number':
      buffer.push(`${field.key}: ${field.min ?? 0}`, off, indent);
      break;

    case 'boolean':
      buffer.push(`${field.key}: ${field.default ?? false}`, off, indent);
      break;

    case 'select': {
      const values = field.options.map((o) => o.value);
      buffer.comment(`Allowed: ${values.join(', ')}`, indent);
      if (field.multiple) {
        buffer.push(`${field.key}: [${values.slice(0, 2).map(quote).join(', ')}]`, off, indent);
      } else {
        buffer.push(`${field.key}: ${quote(values[0] ?? '')}`, off, indent);
      }
      break;
    }

    case 'date':
      buffer.push(`${field.key}: ${field.withTime ? quote('2026-01-31T09:00:00Z') : '2026-01-31'}`, off, indent);
      break;

    case 'monthDay':
      buffer.push(`${field.key}: ${quote(field.default ?? '06-15')}`, off, indent);
      break;

    case 'color':
      buffer.push(`${field.key}: ${quote(field.default ?? '#1a2b3c')}`, off, indent);
      break;

    case 'group':
      buffer.push(`${field.key}:`, off, indent);
      // A live group carries its children live, so the object actually exists.
      for (const child of field.fields) emitField(child, buffer, indent + 1, off, !off);
      break;

    case 'repeater': {
      buffer.push(`${field.key}:`, off, indent);
      // One example row. The list shape is the part authors get wrong, and one
      // filled-in row shows the `- ` and the indentation better than prose can.
      const [first, ...rest] = field.fields;
      if (first) {
        const head = new Buffer();
        emitField(first, head, 0, off, !off);
        head.lines.forEach((line, index) => {
          const prefix = index === head.lines.length - 1 ? '- ' : '  ';
          buffer.lines.push({
            text: `${'  '.repeat(indent + 1)}${prefix}${line.text}`,
            commented: line.commented || off,
          });
        });
      }
      for (const child of rest) emitField(child, buffer, indent + 2, off, !off);
      break;
    }

    default:
      break;
  }
}

/** Body starters, so the template shows the components this collection may use. */
function bodyExample(collection: ResolvedCollection): string[] {
  const allowed = new Set(allowedComponentsFor(collection.fields));
  const lines: string[] = [];

  if (allowed.has('QuickAnswer')) {
    lines.push(
      '<QuickAnswer eyebrow="QUICK ANSWER">',
      'Answer the question in two or three sentences.',
      '</QuickAnswer>',
      '',
    );
  }
  lines.push(
    '## First section',
    '',
    'Write the body here in ordinary markdown. Every "##" heading becomes a link in the',
    'contents box automatically, so there is no need to fill the list in by hand.',
    '',
    '## Second section',
    '',
    'More prose.',
  );
  return lines;
}

export interface TemplateOptions {
  /** Site locales, so the header can say which are available. */
  locales: string[];
  defaultLocale: string;
}

export function buildImportTemplate(collection: ResolvedCollection, opts: TemplateOptions): string {
  const buffer = new Buffer();
  const name = labelOf(collection.label, collection.key);
  const body = mdxBodyField(collection.fields);
  const components = allowedComponentsFor(collection.fields);

  buffer.comment(`${name} — import template`);
  buffer.comment('');
  buffer.comment('Fill this in, save it as <address>.<language>.md (for example');
  buffer.comment(`my-post.${opts.defaultLocale}.md), then use "Import .md" on the ${name} screen.`);
  buffer.comment('Nothing is saved by the import itself: the form fills itself in and you');
  buffer.comment('check it over before pressing Save.');
  buffer.comment('');
  buffer.comment('Lines starting with # are comments. Uncomment the settings you want.');
  buffer.comment('One file holds ONE language. To add the second, open the document you');
  buffer.comment('already saved, switch to the other language tab, and import there.');

  const lines: string[] = ['---'];
  lines.push(buffer.render());
  lines.push('');

  // ── Document settings ──────────────────────────────────────────────────────
  const head = new Buffer();
  head.comment('─── Document settings ───');
  head.comment('Which collection this file is for. The import refuses a mismatch.');
  head.push(`collection: ${collection.key}`, false);
  head.comment(`Language. Available: ${opts.locales.join(', ')}.`);
  head.push(`locale: ${opts.defaultLocale}`, false);
  head.comment('The address. Taken from the file name when left out.');
  head.push('slug: ""', false);
  head.comment('draft, published, scheduled or archived. Leave as draft and publish from the form.');
  head.push('status: draft', false);
  head.comment('');
  head.comment('What search engines show. Not shown on the page itself.');
  head.push('metaTitle: ""', false);
  head.push('metaDescription: ""', false);
  head.comment('');
  head.comment('Dates, as YYYY-MM-DD. Leave out to use today when you publish.');
  head.comment('publishedAt: 2026-01-31');
  head.comment('modifiedAt: 2026-01-31');
  lines.push(head.render());
  lines.push('');

  // ── Content fields ─────────────────────────────────────────────────────────
  const fields = new Buffer();
  fields.comment(`─── ${name} content ───`);
  lines.push(fields.render());

  for (const field of collection.fields) {
    // The body is not a setting — it is everything below the closing `---`.
    if (body && field.key === body.key) continue;
    const chunk = new Buffer();
    chunk.comment('');
    emitField(field, chunk, 0, false);
    lines.push(chunk.render());
  }

  lines.push('---');
  lines.push('');

  if (components.length > 0) {
    /*
     * `{/* … *\/}` and not `<!-- … -->`: MDX has no HTML comments, and an
     * `<!--` is a parse error the guard reports as "not valid MDX" — so a
     * template that commented itself the obvious way refused to import.
     */
    lines.push(`{/* Components you can use in the body: ${components.join(', ')} */}`);
    lines.push('{/* Do NOT start the body with a "# " heading — the title is set above. */}');
    lines.push('');
  }
  lines.push(...bodyExample(collection));
  lines.push('');

  return lines.join('\n');
}

/**
 * The collection plus the SEO group the CMS ships, with no stored overrides.
 *
 * The import route resolves its collection through
 * `resolveCollectionWithCustomFields`, which appends the SEO group and any
 * admin-defined custom fields — so the downloaded template has a `seo:` block.
 * A snapshot built from the raw config alone would silently be missing that
 * whole section.
 *
 * Deliberately built from EMPTY overrides rather than by reading the database,
 * so the checked-in copies stay a property of the code: identical on every
 * machine and in CI, which is what lets the drift test compare them byte for
 * byte. An install whose admin has renamed or disabled an SEO field sees that in
 * the *downloaded* template — the copy that describes that install — while these
 * files describe what the repo ships.
 */
export function withShippedSeoGroup(collection: ResolvedCollection): ResolvedCollection {
  if (!collection.seo) return collection;
  if (collection.fields.some((field) => field.key === SEO_FIELDS_DATA_KEY)) return collection;
  const group = compileSeoGroup(resolveSeoFields(EMPTY_SEO_OVERRIDES, collection.key));
  return group ? { ...collection, fields: [...collection.fields, group] } : collection;
}

/** Guard used by the template test: no collection may shadow a document setting. */
export const RESERVED_SETTING_KEYS: readonly string[] = RESERVED_KEYS;
