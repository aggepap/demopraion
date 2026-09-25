/**
 * Admin-defined custom fields ("ACF-style").
 *
 * A collection's field set is normally fixed in code (`site.config.ts`). This
 * module lets an editor define *extra* fields at runtime — stored as JSON in
 * `site_settings` under `cms.customFields` — and compiles them into ordinary
 * `Field` objects. Because everything downstream (the zod validator, the admin
 * form, the read layer) is derived from a collection's `fields` array, nothing
 * else has to know these fields came from the database.
 *
 * Plain data + pure functions (no `server-only`), so the admin client and the
 * write path validate against exactly the same descriptor — the same split
 * `core/settings/schema.ts` uses.
 *
 * ## Storage shape
 * Values live flat under `data.custom.<key>`, compiled as ONE group:
 *
 *     f.group('custom', [...], { shared: true, strict: false })
 *
 * - `shared: true` — the admin form only honours `shared` on top-level fields,
 *   so a single group keeps `data.custom` identical across every locale row.
 * - A field marked `perLanguage` compiles with `localized: true`, storing a
 *   `{ [locale]: value }` map inside that shared group — the same arrangement
 *   the product `attributes` repeater already uses.
 * - `strict: false` — deleting a definition must not break saves of documents
 *   that still carry its value; the orphan is stripped instead.
 */
import { f, type Field, type ResolvedCollection } from '../../config';

/** Field kinds an editor may pick. A subset of the core `FieldKind` union —
 *  `code`/`variations` are authoring primitives, not custom-field material. */
export const CUSTOM_FIELD_KINDS = [
  'text',
  'textarea',
  'richText',
  'number',
  'select',
  'multiselect',
  'boolean',
  'date',
  'color',
  'image',
  'relation',
  'repeater',
] as const;

export type CustomFieldKind = (typeof CUSTOM_FIELD_KINDS)[number];

/** How a group's fields surface on the public product page. */
export const CUSTOM_GROUP_RENDER = ['specs', 'tab', 'hidden'] as const;
export type CustomGroupRender = (typeof CUSTOM_GROUP_RENDER)[number];

/** A per-locale label map, e.g. `{ el: 'Υλικό', en: 'Material' }`. */
export type LocalizedLabel = Record<string, string>;

export interface CustomFieldOption {
  value: string;
  label?: LocalizedLabel;
}

export interface CustomFieldDef {
  /** Stable id, assigned once. Survives key/label renames. */
  id: string;
  /** Object key under `data.custom`. */
  key: string;
  kind: CustomFieldKind;
  label: LocalizedLabel;
  description?: string;
  /** `CustomFieldGroup.key` this field belongs to. */
  group?: string;
  /** Translate the value per language (compiles to `localized: true`). */
  perLanguage?: boolean;
  required?: boolean;
  /** `select` / `multiselect` choices. */
  options?: CustomFieldOption[];
  // `number` constraints.
  min?: number;
  max?: number;
  integer?: boolean;
  /** Display-only unit appended to the admin description, e.g. `cm`, `°C`. */
  unit?: string;
  /** `relation` target collection key. */
  relationTo?: string;
  /** `repeater` children (one level deep — no repeaters inside repeaters). */
  subFields?: CustomFieldDef[];
  /** Render on the public product page. Default true. */
  showOnPdp?: boolean;
  /**
   * Conditional visibility: document ids of the categories this field applies
   * to. Empty/absent means "every document in the collection".
   */
  categoryIds?: number[];
}

export interface CustomFieldGroup {
  key: string;
  label: LocalizedLabel;
  renderAs: CustomGroupRender;
  order: number;
}

export interface CustomFieldsConfig {
  groups: CustomFieldGroup[];
  fields: CustomFieldDef[];
}

/** The `data` key every custom value nests under. */
export const CUSTOM_FIELDS_DATA_KEY = 'custom';

/** Valid field/group key — matches the core's own field-key rule. */
export const CUSTOM_KEY_PATTERN = /^[a-z][a-zA-Z0-9_]*$/;

export const EMPTY_CUSTOM_FIELDS: CustomFieldsConfig = { groups: [], fields: [] };

// ── Sanitising ───────────────────────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const numOrUndefined = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Keep only `{ [locale]: string }` entries. */
function sanitizeLabel(v: unknown): LocalizedLabel {
  if (!isRecord(v)) return {};
  const out: LocalizedLabel = {};
  for (const [locale, value] of Object.entries(v)) {
    if (typeof value === 'string' && value.trim()) out[locale] = value;
  }
  return out;
}

function sanitizeOptions(v: unknown): CustomFieldOption[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: CustomFieldOption[] = [];
  const seen = new Set<string>();
  for (const raw of v) {
    if (!isRecord(raw)) continue;
    const value = str(raw.value).trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    const label = sanitizeLabel(raw.label);
    out.push(Object.keys(label).length ? { value, label } : { value });
  }
  return out.length ? out : undefined;
}

function sanitizeField(v: unknown, depth: number): CustomFieldDef | null {
  if (!isRecord(v)) return null;
  const key = str(v.key).trim();
  const kind = str(v.kind) as CustomFieldKind;
  if (!CUSTOM_KEY_PATTERN.test(key)) return null;
  if (!CUSTOM_FIELD_KINDS.includes(kind)) return null;

  const def: CustomFieldDef = {
    id: str(v.id) || key,
    key,
    kind,
    label: sanitizeLabel(v.label),
  };

  const description = str(v.description).trim();
  if (description) def.description = description;
  const group = str(v.group).trim();
  if (group) def.group = group;
  if (v.perLanguage === true) def.perLanguage = true;
  if (v.required === true) def.required = true;
  if (v.showOnPdp === false) def.showOnPdp = false;

  if (kind === 'select' || kind === 'multiselect') {
    const options = sanitizeOptions(v.options);
    // A choice field with no choices can't be edited or validated — drop it.
    if (!options) return null;
    def.options = options;
  }
  if (kind === 'number') {
    const min = numOrUndefined(v.min);
    const max = numOrUndefined(v.max);
    if (min !== undefined) def.min = min;
    if (max !== undefined) def.max = max;
    if (v.integer === true) def.integer = true;
    const unit = str(v.unit).trim();
    if (unit) def.unit = unit;
  }
  if (kind === 'relation') {
    const to = str(v.relationTo).trim();
    if (!to) return null;
    def.relationTo = to;
  }
  if (kind === 'repeater') {
    // One level only: a repeater inside a repeater has no admin control.
    const subFields = depth === 0 ? sanitizeFields(v.subFields, depth + 1) : [];
    if (!subFields.length) return null;
    def.subFields = subFields;
  }

  const categoryIds = Array.isArray(v.categoryIds)
    ? v.categoryIds.filter((n): n is number => Number.isInteger(n) && (n as number) > 0)
    : [];
  if (categoryIds.length) def.categoryIds = categoryIds;

  return def;
}

/**
 * Sanitise a list of raw field definitions. Exported so the SEO field set can
 * validate its admin-added extras with the same rules rather than a parallel
 * copy of them (see `core/seo/field-overrides.ts`).
 */
export function sanitizeFields(v: unknown, depth: number): CustomFieldDef[] {
  if (!Array.isArray(v)) return [];
  const out: CustomFieldDef[] = [];
  const seen = new Set<string>();
  for (const raw of v) {
    const def = sanitizeField(raw, depth);
    if (!def || seen.has(def.key)) continue;
    seen.add(def.key);
    out.push(def);
  }
  return out;
}

function sanitizeGroups(v: unknown): CustomFieldGroup[] {
  if (!Array.isArray(v)) return [];
  const out: CustomFieldGroup[] = [];
  const seen = new Set<string>();
  for (const raw of v) {
    if (!isRecord(raw)) continue;
    const key = str(raw.key).trim();
    if (!CUSTOM_KEY_PATTERN.test(key) || seen.has(key)) continue;
    seen.add(key);
    const renderAs = str(raw.renderAs) as CustomGroupRender;
    out.push({
      key,
      label: sanitizeLabel(raw.label),
      renderAs: CUSTOM_GROUP_RENDER.includes(renderAs) ? renderAs : 'specs',
      order: numOrUndefined(raw.order) ?? out.length,
    });
  }
  return out.sort((a, b) => a.order - b.order);
}

/**
 * Coerce a stored (user-editable) JSON blob into a usable config. Anything
 * malformed is dropped rather than thrown — a bad settings value must not take
 * the admin or the storefront down.
 */
export function sanitizeCustomFieldsConfig(raw: unknown): CustomFieldsConfig {
  if (!isRecord(raw)) return EMPTY_CUSTOM_FIELDS;
  return { groups: sanitizeGroups(raw.groups), fields: sanitizeFields(raw.fields, 0) };
}

/** Pull one collection's config out of the `Record<collectionKey, …>` blob. */
export function customFieldsForCollection(raw: unknown, collectionKey: string): CustomFieldsConfig {
  if (!isRecord(raw)) return EMPTY_CUSTOM_FIELDS;
  return sanitizeCustomFieldsConfig(raw[collectionKey]);
}

// ── Visibility ───────────────────────────────────────────────────────────────

/**
 * The fields that apply to a document in `categoryIds` — the single authority
 * the admin form, the write validator and the product page all call, so they
 * can never disagree about what an editor was shown.
 *
 * A definition with no category scope applies everywhere; otherwise it applies
 * when the document sits in at least one of its categories.
 */
export function visibleCustomFields(
  config: CustomFieldsConfig,
  categoryIds: readonly number[] = [],
): CustomFieldDef[] {
  return config.fields.filter((def) => {
    if (!def.categoryIds?.length) return true;
    return def.categoryIds.some((id) => categoryIds.includes(id));
  });
}

/** Read a document's `categories` relation as ids (the conditional-visibility axis). */
export function documentCategoryIds(data: unknown): number[] {
  if (!isRecord(data)) return [];
  const raw = data.categories;
  if (!Array.isArray(raw)) return [];
  return raw.filter((n): n is number => Number.isInteger(n) && (n as number) > 0);
}

// ── Compiling to core `Field`s ───────────────────────────────────────────────

export interface CompileOptions {
  /**
   * Ids of the definitions currently visible for this document. Only these get
   * `required` enforced. Fields outside the set stay in the schema (optional)
   * so re-categorising a document never silently discards stored values.
   * Omit to treat every field as visible.
   */
  visibleIds?: ReadonlySet<string>;
  /** Collection keys that exist — `relation` fields pointing elsewhere are dropped. */
  knownCollections?: ReadonlySet<string>;
}

/** Admin help text: the author's description, with the unit appended. */
function describe(def: CustomFieldDef): string | undefined {
  const parts = [def.description, def.unit ? `Unit: ${def.unit}` : undefined].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

/**
 * One definition → one core `Field`, or null when it cannot be rendered.
 * Exported for the same reason as `sanitizeFields`.
 */
export function compileOne(def: CustomFieldDef, opts: CompileOptions, nested: boolean): Field | null {
  const required = Boolean(def.required) && (!opts.visibleIds || opts.visibleIds.has(def.id));
  // `section` drives the admin form's sub-headings; `shared` is meaningless on
  // a nested field (the whole `custom` group is shared as a unit).
  const base = {
    label: Object.keys(def.label).length ? def.label : undefined,
    description: describe(def),
    required,
    localized: def.perLanguage || undefined,
    section: nested ? undefined : (def.group || undefined),
  };

  switch (def.kind) {
    case 'text':
      return f.text(def.key, { ...base, maxLength: 500 });
    case 'textarea':
      return f.textarea(def.key, { ...base, rows: 4 });
    case 'richText':
      return f.richText(def.key, base);
    case 'number':
      return f.number(def.key, { ...base, min: def.min, max: def.max, integer: def.integer });
    case 'select':
      return f.select(def.key, { ...base, options: def.options ?? [] });
    case 'multiselect':
      return f.select(def.key, { ...base, options: def.options ?? [], multiple: true });
    case 'boolean':
      return f.boolean(def.key, base);
    case 'date':
      return f.date(def.key, base);
    case 'color':
      return f.color(def.key, base);
    case 'image':
      return f.image(def.key, base);
    case 'relation': {
      const to = def.relationTo ?? '';
      // A dangling target would break the relation picker and the write path.
      if (opts.knownCollections && !opts.knownCollections.has(to)) return null;
      return f.relation(def.key, { ...base, to, many: true });
    }
    case 'repeater': {
      const children = (def.subFields ?? [])
        .map((sub) => compileOne(sub, opts, true))
        .filter((x): x is Field => x !== null);
      if (!children.length) return null;
      return f.repeater(def.key, children, base);
    }
  }
}

/**
 * Definitions → the single `custom` group appended to a collection's fields.
 * Returns null when there is nothing to add.
 */
export function compileCustomFields(
  config: CustomFieldsConfig,
  opts: CompileOptions = {},
): Field | null {
  const fields = config.fields
    .map((def) => compileOne(def, opts, false))
    .filter((x): x is Field => x !== null);
  if (!fields.length) return null;
  return f.group(CUSTOM_FIELDS_DATA_KEY, fields, {
    label: 'Custom fields',
    shared: true,
    strict: false,
  });
}

/**
 * A copy of `collection` with the compiled custom group appended. Returns the
 * input untouched when there are no definitions, so collections that don't use
 * the feature pay nothing.
 */
export function withCustomFields(
  collection: ResolvedCollection,
  config: CustomFieldsConfig,
  opts: CompileOptions = {},
): ResolvedCollection {
  const group = compileCustomFields(config, opts);
  if (!group) return collection;
  // Guard against a definition shadowing a code-defined field: the built-in
  // schema always wins.
  if (collection.fields.some((field) => field.key === CUSTOM_FIELDS_DATA_KEY)) return collection;
  return { ...collection, fields: [...collection.fields, group] };
}

// ── Public-page projection ───────────────────────────────────────────────────

/** One group of resolved values, ready to render as a tab or a spec table. */
export interface CustomFieldGroupValues {
  key: string;
  label: LocalizedLabel;
  renderAs: CustomGroupRender;
  fields: { key: string; label: LocalizedLabel; kind: CustomFieldKind; value: unknown }[];
}

/**
 * Project a document's `data.custom` into per-group, display-ordered values —
 * visible definitions only, `showOnPdp` respected, empties dropped. Values are
 * returned raw (a localized field is still a `{ [locale]: value }` map); the
 * render layer resolves them, since only it knows the request locale.
 *
 * Fields whose `group` doesn't match a defined group fall into a synthetic
 * group keyed `''` that renders with the specs.
 */
export function groupCustomFieldValues(
  config: CustomFieldsConfig,
  data: Record<string, unknown> | undefined,
  categoryIds: readonly number[] = [],
): CustomFieldGroupValues[] {
  const values = isRecord(data?.[CUSTOM_FIELDS_DATA_KEY])
    ? (data[CUSTOM_FIELDS_DATA_KEY] as Record<string, unknown>)
    : {};
  const visible = visibleCustomFields(config, categoryIds).filter((d) => d.showOnPdp !== false);

  const byKey = new Map<string, CustomFieldGroupValues>();
  const groupFor = (key: string): CustomFieldGroupValues => {
    const existing = byKey.get(key);
    if (existing) return existing;
    const defined = config.groups.find((g) => g.key === key);
    const created: CustomFieldGroupValues = {
      key,
      label: defined?.label ?? {},
      renderAs: defined?.renderAs ?? 'specs',
      fields: [],
    };
    byKey.set(key, created);
    return created;
  };

  for (const def of visible) {
    const value = values[def.key];
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    groupFor(def.group ?? '').fields.push({
      key: def.key,
      label: def.label,
      kind: def.kind,
      value,
    });
  }

  // Defined groups keep the editor's order; the ungrouped catch-all trails them.
  const order = new Map(config.groups.map((g, i) => [g.key, i]));
  const rank = (key: string) => order.get(key) ?? Number.MAX_SAFE_INTEGER;
  return [...byKey.values()]
    .filter((g) => g.fields.length > 0 && g.renderAs !== 'hidden')
    .sort((a, b) => rank(a.key) - rank(b.key));
}
