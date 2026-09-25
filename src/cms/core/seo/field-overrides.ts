/**
 * The admin's edits to the built-in SEO/AEO field set.
 *
 * Stored in `site_settings` under `cms.seoFields` as a set of DELTAS, never as
 * a materialised copy of the field list. That distinction is the whole design:
 * the built-ins come from `fields.ts` in code, so a site with no row here — a
 * fresh install, a database restored from before this feature — still gets all
 * fifteen. Nothing has to be seeded, and nothing can be lost by not seeding it.
 *
 * What an admin may change: the label (per locale), the help text, the order,
 * which tab it sits on, whether it appears at all, and — for the JSON-backed
 * ones — whether it is required. What they may not change: the key, the kind,
 * or where the value is stored. Those three are contracts with the frontend and
 * the database, not presentation.
 *
 * ## Why `required` is only offered on `data` fields
 *
 * A `data` field's `required` flag is enforced by the generated zod schema, on
 * the same merged collection the editor renders from — so the form and the
 * validator cannot disagree about it. A `column` field is validated by the
 * write route's own zod body, which knows nothing about these overrides; making
 * it "required" there would either be enforced in the form only (a rule a
 * scripted write walks straight past) or need a second enforcement point that
 * could drift from the first. This codebase has been bitten by exactly that
 * shape before, so the toggle is simply not offered.
 *
 * ## Disabling keeps the value
 *
 * A disabled field is removed from the editor and from the compiled group, but
 * the stored value stays on the document — the group is `strict: false`, so a
 * later save of an untouched document does not fail, and re-enabling the field
 * brings the old value back into view.
 *
 * Plain data + pure functions, no `server-only` (same reason as `fields.ts`).
 */
import { f, type Field, type GroupField } from '../../config';
import {
  compileOne,
  sanitizeFields,
  type CustomFieldDef,
  type LocalizedLabel,
} from '../fields/definitions';
import {
  SEO_FIELD_DEFS,
  SEO_FIELDS_DATA_KEY,
  SEO_TAB_KEYS,
  type SeoFieldDef,
  type SeoTab,
} from './fields';
import {
  categoriesForCollection,
  SCHEMA_TYPE_FIELD_KEY,
  SCHEMA_TYPE_INHERIT,
} from '../structured-data/policy';

export interface SeoFieldOverrides {
  /** Built-in keys turned off site-wide. */
  disabled: string[];
  /** Built-in key → per-locale label replacing the shipped one. */
  labels: Record<string, LocalizedLabel>;
  /** Built-in key → help text replacing the shipped one. */
  descriptions: Record<string, string>;
  /** Key → display order (built-ins and extras alike). */
  order: Record<string, number>;
  /** Key → the tab it appears under. */
  tab: Record<string, SeoTab>;
  /** `data`-backed key → required on publish. See the module header. */
  required: Record<string, boolean>;
  /** Admin-added SEO fields. Always stored under `data.seo.<key>`. */
  extra: CustomFieldDef[];
  /** Per-collection narrowing: extra keys switched off for one collection only. */
  perCollection: Record<string, { disabled: string[] }>;
}

/** A fresh, fully-populated blank. A factory rather than a shared constant so
 *  the admin editor can mutate what it is handed without reaching back into
 *  module state that every other caller is also reading. */
export function emptySeoOverrides(): SeoFieldOverrides {
  return {
    disabled: [],
    labels: {},
    descriptions: {},
    order: {},
    tab: {},
    required: {},
    extra: [],
    perCollection: {},
  };
}

/** @deprecated Prefer `emptySeoOverrides()`; kept for readability at call
 *  sites that only read. Never mutate it. */
export const EMPTY_SEO_OVERRIDES: SeoFieldOverrides = Object.freeze(emptySeoOverrides());

// ── Sanitising ───────────────────────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// `schemaType` is built in too, though only collections with a structured-data
// category carry it (see `schemaTypeDef`).
const BUILTIN_KEYS = new Set([...SEO_FIELD_DEFS.map((d) => d.key), SCHEMA_TYPE_FIELD_KEY]);
const DATA_BUILTIN_KEYS = new Set(
  SEO_FIELD_DEFS.filter((d) => d.storage === 'data').map((d) => d.key),
);
const TABS = new Set<string>(SEO_TAB_KEYS);

/** String list, deduped, empties dropped. */
function strings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((x): x is string => typeof x === 'string' && x.trim() !== ''))];
}

function labelMap(v: unknown): Record<string, LocalizedLabel> {
  if (!isRecord(v)) return {};
  const out: Record<string, LocalizedLabel> = {};
  for (const [key, raw] of Object.entries(v)) {
    if (!isRecord(raw)) continue;
    const label: LocalizedLabel = {};
    for (const [locale, text] of Object.entries(raw)) {
      if (typeof text === 'string' && text.trim()) label[locale] = text;
    }
    if (Object.keys(label).length) out[key] = label;
  }
  return out;
}

function stringMap(v: unknown): Record<string, string> {
  if (!isRecord(v)) return {};
  const out: Record<string, string> = {};
  for (const [key, text] of Object.entries(v)) {
    if (typeof text === 'string' && text.trim()) out[key] = text.trim();
  }
  return out;
}

function numberMap(v: unknown): Record<string, number> {
  if (!isRecord(v)) return {};
  const out: Record<string, number> = {};
  for (const [key, n] of Object.entries(v)) {
    if (typeof n === 'number' && Number.isFinite(n)) out[key] = n;
  }
  return out;
}

function tabMap(v: unknown): Record<string, SeoTab> {
  if (!isRecord(v)) return {};
  const out: Record<string, SeoTab> = {};
  for (const [key, tab] of Object.entries(v)) {
    if (typeof tab === 'string' && TABS.has(tab)) out[key] = tab as SeoTab;
  }
  return out;
}

/** Only `data`-backed built-ins and extras can be made required — see header. */
function requiredMap(v: unknown, extraKeys: ReadonlySet<string>): Record<string, boolean> {
  if (!isRecord(v)) return {};
  const out: Record<string, boolean> = {};
  for (const [key, on] of Object.entries(v)) {
    if (typeof on !== 'boolean') continue;
    if (!DATA_BUILTIN_KEYS.has(key) && !extraKeys.has(key)) continue;
    out[key] = on;
  }
  return out;
}

function perCollectionMap(v: unknown): Record<string, { disabled: string[] }> {
  if (!isRecord(v)) return {};
  const out: Record<string, { disabled: string[] }> = {};
  for (const [collection, raw] of Object.entries(v)) {
    if (!isRecord(raw)) continue;
    const disabled = strings(raw.disabled);
    if (disabled.length) out[collection] = { disabled };
  }
  return out;
}

/**
 * Coerce a stored blob into usable overrides. Malformed entries are dropped
 * rather than thrown: a bad settings value must not take the editor down, and
 * the failure mode here is "you get the shipped field back", which is safe.
 */
export function sanitizeSeoFieldOverrides(raw: unknown): SeoFieldOverrides {
  if (!isRecord(raw)) return emptySeoOverrides();

  // An extra may not squat on a built-in key — the built-in would win at compile
  // time and the admin would be editing a definition that does nothing.
  const extra = sanitizeFields(raw.extra, 0).filter((d) => !BUILTIN_KEYS.has(d.key));
  const extraKeys = new Set(extra.map((d) => d.key));

  return {
    disabled: strings(raw.disabled).filter((k) => BUILTIN_KEYS.has(k)),
    labels: labelMap(raw.labels),
    descriptions: stringMap(raw.descriptions),
    order: numberMap(raw.order),
    tab: tabMap(raw.tab),
    required: requiredMap(raw.required, extraKeys),
    extra,
    perCollection: perCollectionMap(raw.perCollection),
  };
}

// ── Resolving ────────────────────────────────────────────────────────────────

/** Apply the label/description/required overrides to a core descriptor. */
function applyFieldOverrides(
  field: Field,
  key: string,
  o: SeoFieldOverrides,
  allowRequired: boolean,
): Field {
  const label = o.labels[key];
  const description = o.descriptions[key];
  const required = allowRequired ? o.required[key] : undefined;
  if (!label && !description && required === undefined) return field;
  return {
    ...field,
    ...(label ? { label } : {}),
    ...(description ? { description } : {}),
    ...(required !== undefined ? { required } : {}),
  };
}

/** An admin-added extra → the same shape as a built-in. */
function extraToDef(def: CustomFieldDef, o: SeoFieldOverrides, index: number): SeoFieldDef | null {
  // `group` doubles as the tab for an extra, so the manager can reuse the
  // custom-field editor wholesale instead of growing a parallel concept.
  const tab = o.tab[def.key] ?? (def.group && TABS.has(def.group) ? (def.group as SeoTab) : 'general');
  const compiled = compileOne({ ...def, group: undefined }, {}, false);
  if (!compiled) return null;
  return {
    key: def.key,
    tab,
    storage: 'data',
    field: applyFieldOverrides(compiled, def.key, o, true),
    // Extras trail the built-ins unless the admin has said otherwise. 1000 is
    // clear of the built-in range (10–150) with room to interleave by hand.
    order: o.order[def.key] ?? 1000 + index * 10,
    builtIn: false,
  };
}

/**
 * The per-document schema type: "use the category setting", or one of the types
 * the collection's category allows (Settings → Structured data). Bookings list
 * both kinds' types together — the SEO group cannot see the document's `kind` —
 * and the resolver ignores a type that does not fit the document's kind.
 */
function schemaTypeDef(o: SeoFieldOverrides, collectionKey: string): SeoFieldDef | null {
  const categories = categoriesForCollection(collectionKey);
  if (categories.length === 0) return null;

  const options: { value: string; label: string }[] = [
    { value: SCHEMA_TYPE_INHERIT, label: 'Site default (Settings → Structured data)' },
  ];
  for (const c of categories) {
    for (const type of c.types) {
      if (options.some((opt) => opt.value === type)) continue;
      const shared = categories.every((other) => other.types.includes(type));
      options.push({ value: type, label: shared ? type : `${c.label}: ${type}` });
    }
  }

  const key = SCHEMA_TYPE_FIELD_KEY;
  return {
    key,
    tab: o.tab[key] ?? 'advanced',
    storage: 'data',
    field: applyFieldOverrides(
      f.select(key, {
        label: 'Schema type',
        options,
        default: SCHEMA_TYPE_INHERIT,
        description:
          'What this page tells search engines it is. Leave on the site default unless this one differs, such as the Contact page.',
      }),
      key,
      o,
      false,
    ),
    // Just before the raw override (150), which replaces whatever this picks.
    order: o.order[key] ?? 145,
    builtIn: true,
  };
}

/**
 * The SEO fields for one collection, in display order — the single authority
 * the editor, the compiled group and the admin manager all read, so they cannot
 * disagree about which fields exist.
 */
export function resolveSeoFields(
  o: SeoFieldOverrides,
  collectionKey?: string,
): SeoFieldDef[] {
  const offHere = new Set([
    ...o.disabled,
    ...(collectionKey ? (o.perCollection[collectionKey]?.disabled ?? []) : []),
  ]);

  const builtIns = SEO_FIELD_DEFS.filter((d) => !offHere.has(d.key)).map((d) => ({
    ...d,
    tab: o.tab[d.key] ?? d.tab,
    order: o.order[d.key] ?? d.order,
    field: applyFieldOverrides(d.field, d.key, o, d.storage === 'data'),
  }));

  const extras = o.extra
    .filter((d) => !offHere.has(d.key))
    .map((d, i) => extraToDef(d, o, i))
    .filter((d): d is SeoFieldDef => d !== null);

  const schemaType =
    collectionKey && !offHere.has(SCHEMA_TYPE_FIELD_KEY) ? schemaTypeDef(o, collectionKey) : null;

  return [...builtIns, ...(schemaType ? [schemaType] : []), ...extras].sort((a, b) => a.order - b.order);
}

/** Group the resolved fields by tab, dropping tabs that ended up empty. */
export function seoFieldsByTab(defs: SeoFieldDef[]): { tab: SeoTab; fields: SeoFieldDef[] }[] {
  return SEO_TAB_KEYS.map((tab) => ({ tab, fields: defs.filter((d) => d.tab === tab) })).filter(
    (t) => t.fields.length > 0,
  );
}

// ── Compiling ────────────────────────────────────────────────────────────────

/**
 * The `data`-backed fields as the single `seo` group appended to a collection.
 * Returns null when every one of them is disabled.
 *
 * `strict: false` for the same reason the custom group uses it: a field
 * disabled today must not make tomorrow's save of a document that still carries
 * its value fail. The orphan is stripped instead.
 *
 * Deliberately NOT `shared` — see the note in `fields.ts`.
 */
export function compileSeoGroup(defs: SeoFieldDef[]): GroupField | null {
  const fields = defs.filter((d) => d.storage === 'data').map((d) => d.field);
  if (!fields.length) return null;
  return f.group(SEO_FIELDS_DATA_KEY, fields, { label: 'SEO & AEO', strict: false });
}
