/**
 * Field definitions and the `f.*` builder API.
 *
 * A collection's `fields` array is the single declaration from which the core
 * derives everything site-specific: the zod validator (see `zod.ts`), the
 * admin edit-form UI (a field-kind → editor-component registry), and the
 * typed shape of a document's `data` JSON.
 *
 * Fields are plain data (a discriminated union on `kind`) so the whole config
 * stays serialisable and inspectable — no functions or class instances leak
 * into it. The `f.*` helpers are thin constructors that fill defaults.
 */

/** A label shown in the admin UI. Either a single string or a per-locale map;
 *  the admin resolves it against the editor's locale, falling back to the key. */
export type FieldLabel = string | Record<string, string>;

/**
 * Show a field only when a SIBLING field (same object level) holds one of
 * `equals`.
 *
 * Deliberately narrow: one sibling, equality only, no expressions. A condition
 * language in the config would need an evaluator on both the client and the
 * server and the two would eventually disagree — and the price of disagreeing
 * is a field the editor never saw being enforced as required on publish.
 */
export interface ShowIfCondition {
  /** Sibling field key at the same level. Not a dotted path. */
  field: string;
  /** Visible when the sibling equals this, or any of these. */
  equals: string | string[];
}

/** One condition, or several that must ALL hold — "stay AND extras enabled". */
export type ShowIf = ShowIfCondition | ShowIfCondition[];

/** `showIf` as a list, so callers never branch on the single-vs-many shape. */
export function showIfConditions(field: Field): ShowIfCondition[] {
  const c = field.showIf;
  if (!c) return [];
  return Array.isArray(c) ? c : [c];
}

export type FieldKind =
  | 'text'
  | 'textarea'
  | 'richText'
  | 'code'
  | 'number'
  | 'boolean'
  | 'select'
  | 'date'
  | 'monthDay'
  | 'color'
  | 'image'
  | 'relation'
  | 'repeater'
  | 'group'
  | 'variations';

interface BaseField {
  kind: FieldKind;
  /** Object key under the document's `data` JSON. Must be unique per level. */
  key: string;
  label?: FieldLabel;
  /** When true, an empty/absent value fails validation. Default false. */
  required?: boolean;
  /** Per-locale value. When true the stored value is a `{ [locale]: value }`
   *  map rather than a bare value. Default false (shared across locales). */
  localized?: boolean;
  /** Optional admin help text under the input. */
  description?: string;
  /**
   * Optional admin form section this field belongs to (e.g. 'Content',
   * 'Schema & AEO'). When any field in a collection sets this, the edit form
   * groups fields into these named sections in declared order; otherwise the
   * form auto-derives sections from the field structure. Purely a UI hint —
   * it does not affect storage or validation.
   */
  section?: string;
  /**
   * Shared across a document's translation group: the value is kept identical
   * in every locale row (the admin edits one shared value and propagates it on
   * save). Use for non-translatable structural data — price, stock, dimensions,
   * the variation matrix — so it can't drift between languages. Translatable
   * text inside a shared field is still per-locale via `localized`.
   */
  shared?: boolean;
  /**
   * Hidden from the admin form UI but still stored/validated. Used for machine
   * fields like auto-generated stable ids (see repeater `autoId`).
   */
  hidden?: boolean;
  /**
   * Show this field only when a sibling's value matches — e.g. the vessel and
   * departure fields of a booking, which apply to a transport experience and
   * mean nothing for a stay.
   *
   * A field hidden this way is still STORED, and is never `required`. Both
   * halves matter: switching an experience from transport to stay and back must
   * return its transport pricing untouched, and publishing must not be blocked
   * by a required field the editor was never shown. See `isFieldVisible`.
   */
  showIf?: ShowIf;
}

export interface TextField extends BaseField {
  kind: 'text';
  minLength?: number;
  maxLength?: number;
  /** Regex source string (portable across the config boundary). */
  pattern?: string;
  default?: string;
}

export interface TextareaField extends BaseField {
  kind: 'textarea';
  minLength?: number;
  maxLength?: number;
  rows?: number;
  default?: string;
}

/** Rich text stored as a TipTap JSON document (a `{ type: 'doc', content }` tree). */
export interface RichTextField extends BaseField {
  kind: 'richText';
}

/**
 * Raw source stored as a string, edited in a monospace/code area — used for
 * MDX bodies whose custom React components TipTap JSON can't represent. The
 * frontend renders it through its existing MDX pipeline.
 */
export interface CodeField extends BaseField {
  kind: 'code';
  /** Informational language hint for the editor (e.g. `mdx`, `markdown`, `html`). */
  language?: string;
  rows?: number;
  default?: string;
  /**
   * Component names an MDX body may use. Only meaningful with
   * `language: 'mdx'`, where the write path refuses any body containing an
   * element outside this list, an `import`/`export`, or an expression that is
   * anything other than a literal value.
   *
   * It has to arrive through the config because the check runs in `src/cms/**`,
   * which cannot see the site's component map — see
   * `src/cms/core/fields/mdx-guard.ts` for why the check exists, and
   * `src/lib/cms/mdx-allowlist.ts` for this site's list.
   *
   * Absent means unchecked, so a `code` field holding something other than MDX
   * (or a site with no components to allow) behaves as before.
   */
  allowedComponents?: readonly string[];
  /**
   * Cosmetic metadata for the admin's "Insert component" palette. Purely a UI
   * affordance: it says how to *offer* a component, never what is permitted.
   * `allowedComponents` remains the only security input — the editor
   * intersects the two, so a palette entry naming a component outside the
   * allow-list degrades to a missing button rather than to a body the server
   * refuses.
   *
   * Serialisable plain data by necessity: a collection's fields cross the
   * server→client boundary as a prop (see `src/cms/admin/shared.ts`), so no
   * functions and no React nodes. Like `allowedComponents`, it arrives through
   * the config because the editor lives in `src/cms/**` and cannot see the
   * site's component map — this site's specs are in `src/lib/cms/mdx-palette.ts`.
   */
  componentPalette?: readonly MdxComponentSpec[];
}

/** How a component prop is collected in the insert dialog, and how it is emitted. */
export type MdxPropType =
  | 'text' // name="value"
  | 'longText' // name="value", multiline input
  | 'url'
  | 'number' // name={12}
  | 'boolean' // name, or omitted entirely
  | 'stringList' // name={['a', 'b']}
  | 'stringGrid'; // name={[['a', 'b'], ['c', 'd']]}

export interface MdxPropSpec {
  /** The JSX attribute name. */
  name: string;
  label: string;
  type: MdxPropType;
  required?: boolean;
  default?: string;
  placeholder?: string;
  /** Shown under the control in the dialog. */
  help?: string;
  /** For `stringGrid`: the sibling `stringList` prop that fixes the column count. */
  columnsFrom?: string;
}

export interface MdxChildrenSpec {
  label: string;
  placeholder?: string;
  /** `markdown` = blank-line-separated prose; `inline` = a single line. */
  kind: 'markdown' | 'inline';
}

/** A component whose body is a run of child components (`Pillars` → `Pillar`). */
export interface MdxRepeatSpec {
  /** The item component's tag name. Must also be allow-listed. */
  child: string;
  itemLabel: string;
  min: number;
  max: number;
  initial: number;
  props?: readonly MdxPropSpec[];
  children?: MdxChildrenSpec;
  /** Fill a per-item prop with its 1-based index. */
  autoNumber?: { prop: string; format: 'padded' | 'plain' };
}

export interface MdxComponentSpec {
  /** The JSX tag, e.g. `Pillars`. */
  name: string;
  label: string;
  /** Groups the chooser list, e.g. 'Callouts' | 'Structure' | 'Tables'. */
  group?: string;
  summary?: string;
  props?: readonly MdxPropSpec[];
  /** A direct body slot. Mutually exclusive with `repeat`. */
  children?: MdxChildrenSpec;
  repeat?: MdxRepeatSpec;
}

export interface NumberField extends BaseField {
  kind: 'number';
  min?: number;
  max?: number;
  /** Reject non-integers when true. */
  integer?: boolean;
  default?: number;
  /**
   * Another field on the same document whose words this number counts.
   *
   * Word count was a number an editor had to work out and type by hand on every single
   * article, from the body text sitting right there in the same form. With this set the
   * editor gets a button that does it, and an empty field fills itself once there is
   * something to count — it is never overwritten silently, because a number someone
   * chose deliberately must not be replaced by one a machine preferred.
   */
  countWordsFrom?: string;
  /**
   * Take the bounds from other fields on the DOCUMENT, by key, instead of (or
   * as well as) the static `min`/`max`. A literal `min`/`max` still wins.
   *
   * Document-level rather than sibling-level on purpose: what constrains a price
   * band is the experience's own party-size range, and a band lives inside a
   * repeater row that cannot see it. The bound is an aid at the input, not the
   * enforcement — a typed number can still land outside it, so whatever cares
   * must validate too.
   */
  boundsFrom?: { min?: string; max?: string };
}

export interface BooleanField extends BaseField {
  kind: 'boolean';
  default?: boolean;
}

export interface SelectOption {
  value: string;
  label?: FieldLabel;
}

export interface SelectField extends BaseField {
  kind: 'select';
  options: SelectOption[];
  /** Allow selecting several options (stored as an array). Default false. */
  multiple?: boolean;
  default?: string | string[];
}

/** ISO date/datetime string (`YYYY-MM-DD` or full ISO 8601). */
export interface DateField extends BaseField {
  kind: 'date';
  /** Store a full timestamp rather than a bare calendar date. Default false. */
  withTime?: boolean;
  default?: string;
}

/**
 * Regex source for `MM-DD` (zero-padded month, hyphen, zero-padded day).
 * Day is 01-31 for every month: the exact day count for the chosen month is a
 * runtime concern (`core/fields/month-day` accepts `02-29` on purpose), and
 * the admin picker cannot emit an out-of-range day anyway.
 */
export const MONTH_DAY_PATTERN = '^(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$';

/**
 * `MM-DD` — a calendar day with no year, rendered as a month + day pair.
 * Deliberately yearless: it names a boundary of a season that recurs every
 * year, so pinning a year to it would be wrong the following January.
 */
export interface MonthDayField extends BaseField {
  kind: 'monthDay';
  default?: string;
}

/** A single colour, stored as a `#rrggbb` hex string. Rendered as a native
 *  colour swatch + hex input in the admin. Used for product swatches. */
export interface ColorField extends BaseField {
  kind: 'color';
  default?: string;
}

/** Reference to a `media_files` row by uuid. */
export interface ImageField extends BaseField {
  kind: 'image';
}

/** Reference(s) to other documents by id, materialised into `document_relations`. */
export interface RelationField extends BaseField {
  kind: 'relation';
  /** Target collection key. */
  to: string;
  /** Allow multiple targets (ordered). Default false. */
  many?: boolean;
  /**
   * Admin control variant. `categoryTree` renders a hierarchical picker with a
   * "Manage" modal (create/rename/delete + tree select) for self-nesting
   * taxonomies; `termList` is the same modal without the nesting, for a flat
   * vocabulary whose collection has no `parent` field. Defaults to the typeahead
   * relation picker.
   *
   * The distinction is not cosmetic: the tree variant posts `data.parent` on
   * create, and a collection without that field rejects the unknown key — every
   * "create" from the drawer would answer 400.
   */
  picker?: 'default' | 'categoryTree' | 'termList';
  /**
   * Noun the managed picker names itself with ("Manage vessel types", "New
   * vessel type"). Declarative rather than derived from the target collection:
   * the resolved collection crosses the server→client boundary as plain data,
   * and the picker is only ever handed the field. Defaults to "category".
   */
  pickerNoun?: { singular: string; plural: string };
}

/** An ordered list of sub-records, each shaped by `fields`. */
export interface RepeaterField extends BaseField {
  kind: 'repeater';
  fields: Field[];
  min?: number;
  max?: number;
  /** Singular noun for one row (e.g. `Image`), used for the "Add …" button and
   *  the row summary fallback. Defaults to the field label. */
  itemLabel?: string;
  /** Auto-assign a stable `id` (uuid) to each new/duplicated row. Requires a
   *  hidden `id` text field in `fields`. Used so translating labels never
   *  breaks references (e.g. variation → attribute value). */
  autoId?: boolean;
  /**
   * Names two `monthDay` sub-fields that form a range, declaring that no two
   * rows may cover the same calendar day. The admin then flags a clash as it
   * is created rather than letting it reach a save.
   *
   * Declarative rather than a callback because the resolved collection crosses
   * the server→client boundary to reach the form, where a function could not
   * be serialised.
   */
  noOverlap?: { from: string; to: string };
  /**
   * Title for a COLLAPSED row, as a template over its own sub-field keys:
   * `'{min}–{max} · {total}'`. Used when a row has no text field for the summary
   * to pick up, and ignored when every referenced value is empty.
   *
   * A price band is three numbers, so every collapsed row read "Price band 1",
   * "Price band 2" — the editor had to open each one to see which party size it
   * covered. Same reason as `itemLabel`: a list is only useful if a closed row
   * still says what it holds. A template rather than a list of keys because the
   * punctuation between them is what makes `5–10` read as a range.
   */
  summaryTemplate?: string;
  /**
   * Lay an open row's fields out across the row rather than stacked down it.
   *
   * For a row of two or three short values — a range and its price — stacking
   * turns one fact into a column of separate-looking questions, and a table of
   * them scrolls out of sight. Wraps back to a stack on narrow screens.
   */
  inlineFields?: boolean;
}

/** A fixed nested object shaped by `fields`. */
export interface GroupField extends BaseField {
  kind: 'group';
  fields: Field[];
  /**
   * Reject unknown keys inside this group. Default true, matching the rest of
   * the schema (config drift should surface immediately). Set false for groups
   * whose shape is admin-defined at runtime (see `core/fields`): a definition
   * deleted in the admin would otherwise make every later save of a document
   * that still carries its value fail. Unknown keys are stripped instead.
   */
  strict?: boolean;
}

/**
 * WooCommerce-style product variation matrix. Derives its axes from a sibling
 * `attributes` field (an `attributes` repeater of `{ name, swatchType, values[] }`)
 * and stores the generated combinations. Rendered by a bespoke `VariationsEditor`
 * (the generic repeater can't auto-generate the cartesian product).
 *
 * Stored value: an array of
 *   `{ id, options: { [attrName]: valueLabel }, sku?, price?, stock?, image?, enabled?, weight? }`.
 */
export interface VariationsField extends BaseField {
  kind: 'variations';
  /** Key of the sibling `attributes` field the matrix derives axes from. */
  attributesKey: string;
}

export type Field =
  | TextField
  | TextareaField
  | RichTextField
  | CodeField
  | NumberField
  | BooleanField
  | SelectField
  | DateField
  | MonthDayField
  | ColorField
  | ImageField
  | RelationField
  | RepeaterField
  | GroupField
  | VariationsField;

/** Options accepted by a builder = the field minus the fixed `kind`/`key`. */
type Opts<T extends Field> = Omit<T, 'kind' | 'key'>;

/**
 * The `f.*` field builders. Each returns a plain `Field` object; the only
 * job here is to stamp `kind` and merge the caller's options.
 */
export const f = {
  text: (key: string, opts: Opts<TextField> = {}): TextField => ({ kind: 'text', key, ...opts }),
  textarea: (key: string, opts: Opts<TextareaField> = {}): TextareaField => ({
    kind: 'textarea',
    key,
    ...opts,
  }),
  richText: (key: string, opts: Opts<RichTextField> = {}): RichTextField => ({
    kind: 'richText',
    key,
    ...opts,
  }),
  code: (key: string, opts: Opts<CodeField> = {}): CodeField => ({ kind: 'code', key, ...opts }),
  /** Convenience: a `code` field preset to MDX — used for editorial bodies. */
  mdx: (key: string, opts: Omit<Opts<CodeField>, 'language'> = {}): CodeField => ({
    kind: 'code',
    key,
    language: 'mdx',
    ...opts,
  }),
  number: (key: string, opts: Opts<NumberField> = {}): NumberField => ({
    kind: 'number',
    key,
    ...opts,
  }),
  boolean: (key: string, opts: Opts<BooleanField> = {}): BooleanField => ({
    kind: 'boolean',
    key,
    ...opts,
  }),
  select: (key: string, opts: Opts<SelectField>): SelectField => ({
    kind: 'select',
    key,
    ...opts,
  }),
  date: (key: string, opts: Opts<DateField> = {}): DateField => ({ kind: 'date', key, ...opts }),
  monthDay: (key: string, opts: Opts<MonthDayField> = {}): MonthDayField => ({
    kind: 'monthDay',
    key,
    ...opts,
  }),
  color: (key: string, opts: Opts<ColorField> = {}): ColorField => ({ kind: 'color', key, ...opts }),
  image: (key: string, opts: Opts<ImageField> = {}): ImageField => ({ kind: 'image', key, ...opts }),
  relation: (key: string, opts: Opts<RelationField>): RelationField => ({
    kind: 'relation',
    key,
    ...opts,
  }),
  repeater: (key: string, fields: Field[], opts: Omit<Opts<RepeaterField>, 'fields'> = {}): RepeaterField => ({
    kind: 'repeater',
    key,
    fields,
    ...opts,
  }),
  group: (key: string, fields: Field[], opts: Omit<Opts<GroupField>, 'fields'> = {}): GroupField => ({
    kind: 'group',
    key,
    fields,
    ...opts,
  }),
  variations: (
    key: string,
    opts: Partial<Opts<VariationsField>> & { attributesKey?: string } = {},
  ): VariationsField => ({
    kind: 'variations',
    key,
    attributesKey: opts.attributesKey ?? 'attributes',
    ...opts,
  }),
} as const;

/** Field kinds that produce document→document links in `document_relations`. */
export function isRelationKind(field: Field): field is RelationField {
  return field.kind === 'relation';
}

/**
 * Is `field` visible, given its siblings' current values?
 *
 * THE authority on `showIf`, called by the zod builder, the edit form and the
 * field renderer. One function because the three must agree: if the validator
 * thought a field was visible and the form did not, publishing would fail on a
 * required field that was never on screen, with no way to satisfy it.
 *
 * `peers` supplies the sibling field definitions so an unset discriminator can
 * fall back to its declared `default`. Without it, every document written
 * before the discriminator existed would read as `undefined` and hide the
 * fields that were the whole content of the document.
 */
export function isFieldVisible(
  field: Field,
  siblings: Record<string, unknown> | undefined,
  peers?: readonly Field[],
): boolean {
  // Several conditions are ANDed: a field carrying both "stay only" and "extras
  // are enabled" must satisfy both, since either alone is a reason to hide it.
  return showIfConditions(field).every((cond) => {
    let value = siblings?.[cond.field];
    if (value === undefined || value === null || value === '') {
      const peer = peers?.find((p) => p.key === cond.field);
      value = peer && 'default' in peer ? (peer as { default?: unknown }).default : undefined;
    }

    const wanted = Array.isArray(cond.equals) ? cond.equals : [cond.equals];
    // A multi-select sibling holds an array: visible when ANY selected value
    // matches, which is the reading that makes "show for these categories" work.
    if (Array.isArray(value)) return value.some((v) => wanted.includes(String(v)));
    if (value === undefined || value === null) return false;
    return wanted.includes(String(value));
  });
}

/** Drop the fields a `showIf` hides at this level. Shallow by design — nested
 *  levels are filtered by whoever renders/validates them, against their own
 *  siblings. */
export function visibleFields(fields: Field[], values: Record<string, unknown> | undefined): Field[] {
  return fields.filter((field) => isFieldVisible(field, values, fields));
}

/** The declared field at a dot path, or null if there is none. */
export function fieldAt(fields: Field[], path: string): Field | null {
  let found: Field | null = null;
  walkFields(fields, (field, fieldPath) => {
    if (fieldPath.join('.') === path) found = field;
  });
  return found;
}

/**
 * The keys of a group's parts, in the order the collection declares them.
 *
 * Needed because the *stored* order cannot be trusted. A group lands in the
 * `data` JSON column, and MySQL normalises JSON object keys — sorting them by
 * length, then lexicographically — so `{before, accent, after}` comes back out
 * as `{after, accent, before}`. Anything that reconstructed a title by iterating
 * the stored object therefore printed it backwards, and only for documents that
 * had been through the database. The declaration is the only surviving record of
 * the author's intended order.
 *
 * Returns null for a path that is not a group, which is the signal to fall back
 * to whatever order the value itself has.
 */
export function groupPartOrder(fields: Field[], path: string): string[] | null {
  const field = fieldAt(fields, path);
  if (!field || field.kind !== 'group') return null;
  return field.fields.map((f) => f.key);
}

/** Walk a field tree (descending into repeaters/groups), calling `visit` on
 *  every field. Path segments accumulate the nesting keys. */
export function walkFields(
  fields: Field[],
  visit: (field: Field, path: string[]) => void,
  parentPath: string[] = [],
): void {
  for (const field of fields) {
    const path = [...parentPath, field.key];
    visit(field, path);
    if (field.kind === 'repeater' || field.kind === 'group') {
      walkFields(field.fields, visit, path);
    }
  }
}
