/**
 * Frontmatter values → the shapes the field DSL declares.
 *
 * YAML gives us strings, numbers, booleans, arrays and plain objects. The field
 * tree says what each key is supposed to be. This module walks the two together
 * and reports, per path, everywhere they disagree.
 *
 * It is deliberately stricter than `config/zod.ts` about *unknown* keys and more
 * forgiving about *missing* ones. Both directions are the same judgement: an
 * import is someone typing a file by hand, so a key they misspelled must be
 * named back to them (zod's `.strict()` would say only "unrecognized key"),
 * while a key they left out is just an unfinished draft, which the CMS has
 * always allowed.
 */
import { MONTH_DAY_PATTERN, type Field, type FieldLabel } from '../../config';

export interface ImportProblem {
  /** Dotted path into `data`, e.g. `faq.items.0.question`. Absent for file-level problems. */
  path?: string;
  message: string;
}

/** Accumulates problems while the walk proceeds, so one pass reports everything. */
export class ProblemCollector {
  readonly errors: ImportProblem[] = [];
  readonly warnings: ImportProblem[] = [];

  error(message: string, path?: string): void {
    this.errors.push(path ? { path, message } : { message });
  }

  warn(message: string, path?: string): void {
    this.warnings.push(path ? { path, message } : { message });
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * A field's human name for a message.
 *
 * Falls back to the key rather than to a locale lookup: this text is read by
 * whoever wrote the file, next to the key they actually typed, so the key is
 * never the wrong answer. Core cannot reach the admin's `labelText` anyway —
 * `src/cms/**` may not import `@/cms/admin`'s site-facing helpers.
 */
function labelOf(label: FieldLabel | undefined, fallback: string): string {
  if (typeof label === 'string' && label.trim() !== '') return label;
  if (isRecord(label)) {
    const first = Object.keys(label).sort().map((k) => label[k as keyof typeof label]).find((v) => typeof v === 'string' && v.trim() !== '');
    if (typeof first === 'string') return first;
  }
  return fallback;
}

const describe = (value: unknown): string => {
  if (value === null) return 'nothing';
  if (Array.isArray(value)) return 'a list';
  if (isRecord(value)) return 'a block of sub-settings';
  return `a ${typeof value}`;
};

/**
 * Kinds a markdown file cannot carry, and the reason each one is refused.
 *
 * These all store a database identity — a `media_files` uuid, a `documents.id` —
 * which a text file has no way to know and this module has no way to look up
 * (it is pure; resolving a slug to an id is I/O). Refusing loudly beats
 * accepting a plausible-looking string that would fail the foreign key at save
 * time, or worse, point at whatever row happens to hold that id.
 */
const UNSUPPORTED_KINDS: Partial<Record<Field['kind'], string>> = {
  image: 'images are chosen from the media library — set this in the form after importing',
  relation: 'links to other documents are chosen in the form after importing',
  variations: 'product variations cannot be written in a markdown file',
};

/**
 * Coerce one field's frontmatter value. Returns `undefined` when the value is
 * absent or unusable, in which case the key is left out of `data` entirely
 * rather than stored as an empty shell.
 */
function coerceField(
  field: Field,
  value: unknown,
  path: string,
  collector: ProblemCollector,
): unknown {
  const name = labelOf(field.label, field.key);

  const unsupported = UNSUPPORTED_KINDS[field.kind];
  if (unsupported) {
    collector.error(`"${field.key}" (${name}) cannot be imported: ${unsupported}.`, path);
    return undefined;
  }

  // An explicit `null` is how YAML spells "I left this blank". Treat it as
  // absent rather than as a value, so a template shipped with empty keys imports
  // cleanly instead of failing on every one of them.
  if (value === null || value === undefined) return undefined;

  switch (field.kind) {
    case 'text':
    case 'textarea':
    case 'code': {
      if (typeof value === 'string') return value;
      /*
       * A bare `eyebrow: 2026` or `accent: true` is YAML doing its job, not the
       * author asking for a type change — so it converts, with a warning, rather
       * than failing a whole import over a missing pair of quotes.
       */
      if (typeof value === 'number' || typeof value === 'boolean') {
        collector.warn(`"${field.key}" (${name}) was read as ${describe(value)} and stored as text. Wrap it in quotes to be explicit.`, path);
        return String(value);
      }
      collector.error(`"${field.key}" (${name}) must be text, but it is ${describe(value)}.`, path);
      return undefined;
    }

    case 'richText': {
      // TipTap JSON. Nothing produces it from markdown, but a value copied out
      // of an existing document is valid and should pass through to zod.
      if (isRecord(value)) return value;
      collector.error(`"${field.key}" (${name}) is a rich-text field and cannot be written as markdown — edit it in the form after importing.`, path);
      return undefined;
    }

    case 'number': {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
        return Number(value);
      }
      collector.error(`"${field.key}" (${name}) must be a number, but it is ${describe(value)}.`, path);
      return undefined;
    }

    case 'boolean': {
      if (typeof value === 'boolean') return value;
      if (value === 'true' || value === 'false') return value === 'true';
      collector.error(`"${field.key}" (${name}) must be true or false, but it is ${describe(value)}.`, path);
      return undefined;
    }

    case 'select': {
      const allowed = new Set(field.options.map((o) => o.value));
      const listValues = (v: unknown): string[] | null => {
        if (typeof v === 'string') return [v];
        if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v as string[];
        return null;
      };
      const values = listValues(value);
      if (!values) {
        collector.error(`"${field.key}" (${name}) must be ${field.multiple ? 'a list of values' : 'a single value'}.`, path);
        return undefined;
      }
      const bad = values.filter((v) => !allowed.has(v));
      if (bad.length > 0) {
        // Naming the options is the whole point: a tag vocabulary of 25 values is
        // not something an author can be expected to recall, and "invalid enum
        // value" sends them to the source to find out what was allowed.
        collector.error(
          `"${field.key}" (${name}) does not accept ${bad.map((b) => `"${b}"`).join(', ')}. Allowed: ${[...allowed].join(', ')}.`,
          path,
        );
        return undefined;
      }
      if (!field.multiple && values.length > 1) {
        collector.error(`"${field.key}" (${name}) takes a single value, not a list.`, path);
        return undefined;
      }
      return field.multiple ? values : values[0];
    }

    case 'date': {
      const text = typeof value === 'string' ? value.trim() : value instanceof Date ? value.toISOString() : null;
      if (text === null) {
        collector.error(`"${field.key}" (${name}) must be a date like 2026-08-24.`, path);
        return undefined;
      }
      if (Number.isNaN(Date.parse(text))) {
        collector.error(`"${field.key}" (${name}): "${text}" is not a date we can read. Use 2026-08-24.`, path);
        return undefined;
      }
      return text;
    }

    case 'monthDay': {
      if (typeof value !== 'string' || !new RegExp(MONTH_DAY_PATTERN).test(value.trim())) {
        collector.error(`"${field.key}" (${name}) must be a month and day like 06-15.`, path);
        return undefined;
      }
      return value.trim();
    }

    case 'color': {
      if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value.trim())) {
        collector.error(`"${field.key}" (${name}) must be a colour like #1a2b3c.`, path);
        return undefined;
      }
      return value.trim().toLowerCase();
    }

    case 'group': {
      if (!isRecord(value)) {
        collector.error(`"${field.key}" (${name}) must be a block of sub-settings, but it is ${describe(value)}.`, path);
        return undefined;
      }
      return coerceFields(field.fields, value, path, collector, { strict: field.strict !== false });
    }

    case 'repeater': {
      if (!Array.isArray(value)) {
        collector.error(`"${field.key}" (${name}) must be a list, but it is ${describe(value)}.`, path);
        return undefined;
      }
      const rows: Record<string, unknown>[] = [];
      value.forEach((row, index) => {
        const rowPath = `${path}.${index}`;
        if (!isRecord(row)) {
          collector.error(`Item ${index + 1} of "${field.key}" (${name}) must be a block of sub-settings, but it is ${describe(row)}.`, rowPath);
          return;
        }
        rows.push(coerceFields(field.fields, row, rowPath, collector, { strict: true }));
      });
      return rows;
    }

    default:
      return value;
  }
}

/**
 * Coerce a whole level of the field tree.
 *
 * `strict` mirrors `GroupField.strict`: unknown keys are an error where the
 * schema would reject them, and dropped with a warning where the schema would
 * strip them (a group whose shape is admin-defined at runtime).
 */
export function coerceFields(
  fields: Field[],
  input: Record<string, unknown>,
  prefix: string,
  collector: ProblemCollector,
  opts: { strict: boolean },
): Record<string, unknown> {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const out: Record<string, unknown> = {};

  for (const [key, raw] of Object.entries(input)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    const field = byKey.get(key);

    if (!field) {
      const known = fields.map((f) => f.key).join(', ');
      const message = `There is no setting called "${key}" here.${known ? ` Expected one of: ${known}.` : ''}`;
      if (opts.strict) collector.error(message, path);
      else collector.warn(`${message} It was ignored.`, path);
      continue;
    }

    const coerced = coerceField(field, raw, path, collector);
    if (coerced !== undefined) out[key] = coerced;
  }

  return out;
}
