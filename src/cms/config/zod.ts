/**
 * Build a zod validator for a collection's `data` JSON from its field set.
 *
 * This is the single validation authority: the write path (route factory,
 * `core/documents`) parses incoming `data` through the schema produced here,
 * so a document can never be stored in a shape the config doesn't describe.
 */
import { z } from 'zod';

import { isFieldVisible, MONTH_DAY_PATTERN, type Field } from './fields';

/**
 * Ceiling for any array a document field can hold.
 *
 * Nothing in the admin produces lists near this size; it exists so a crafted
 * request cannot post an arbitrarily long array into the `data` JSON column.
 * Field-level `max` still wins where the config declares one.
 */
const MAX_ARRAY_ITEMS = 500;

/** Apply optional `min`/`max` bounds to an array schema. */
function bounded(schema: z.ZodArray<z.ZodTypeAny>, min?: number, max?: number): z.ZodType {
  let s = schema;
  if (min !== undefined) s = s.min(min);
  if (max !== undefined) s = s.max(max);
  return s;
}

/** A minimal TipTap document node. We validate the top-level shape only —
 *  the editor guarantees the inner tree, and over-validating rich text here
 *  would couple the core to a specific extension set. The node count is capped
 *  even so: "we don't inspect the tree" is not a reason to accept any size. */
const tiptapDocSchema: z.ZodType = z.object({
  type: z.literal('doc'),
  content: z.array(z.unknown()).max(MAX_ARRAY_ITEMS * 20).optional(),
});

function scalarSchema(field: Field, locales: string[], enforceRequired = false): z.ZodType {
  switch (field.kind) {
    case 'text':
    case 'textarea': {
      let s = z.string();
      if (field.minLength !== undefined) s = s.min(field.minLength);
      if (field.maxLength !== undefined) s = s.max(field.maxLength);
      if (field.kind === 'text' && field.pattern) s = s.regex(new RegExp(field.pattern));
      return s;
    }
    case 'richText':
      return tiptapDocSchema;
    case 'code':
      return z.string();
    case 'number': {
      let s = field.integer ? z.number().int() : z.number();
      if (field.min !== undefined) s = s.min(field.min);
      if (field.max !== undefined) s = s.max(field.max);
      return s;
    }
    case 'boolean':
      return z.boolean();
    case 'select': {
      const values = field.options.map((o) => o.value);
      const one =
        values.length > 0
          ? z.enum(values as [string, ...string[]])
          : z.string();
      // A multi-select cannot hold more distinct values than it offers.
      return field.multiple ? bounded(z.array(one), undefined, values.length || MAX_ARRAY_ITEMS) : one;
    }
    case 'date':
      // Bare calendar date or full ISO — the admin normalises before submit.
      return z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'invalid date');
    case 'monthDay':
      /*
       * A bare `MM-DD`, or empty.
       *
       * Empty must pass: `required` means "must be there to go live", not "must
       * be there to save" (see `applyModifiers`), and `.optional()` tolerates an
       * absent key, not an empty value — so a draft with a half-filled season row
       * has to be able to carry `''`. Same reason the booking slug pattern
       * carries `^$|`.
       *
       * Kept as a plain `ZodString` rather than a `.refine()` so the publish-time
       * non-empty check in `applyModifiers` — which is gated on
       * `instanceof z.ZodString` — actually fires on a required season boundary.
       * The `date` kind above returns a ZodEffects and silently skips it.
       */
      return z.string().regex(new RegExp(`^$|${MONTH_DAY_PATTERN}`), 'expected mm-dd');
    case 'color':
      // `#rrggbb` hex — the admin's colour swatch always emits this shape.
      return z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected a #rrggbb hex colour');
    case 'image': {
      /*
       * A media_files uuid (v7, 36 chars) — or an empty string, which is how a
       * cleared form field arrives.
       *
       * `.optional()` tolerates an absent key, not an empty value, so `''` failed
       * `.uuid()`. The picker's "Clear" button sent exactly that and the form
       * always PATCHes the whole `data` object, so clearing any image anywhere in
       * the admin — an author's avatar, a page hero, a gallery entry — was refused
       * with "Invalid UUID" every time. The control worked, looked like it had
       * done something, and could never be saved.
       *
       * Accepting it here rather than only fixing the picker means it holds for
       * anything else talking to this API. But only where clearing is allowed: a
       * required image on a document going live must still be refused, and the
       * first version of this fix let one through, because a transform that
       * yields `undefined` satisfies a key the object schema merely requires to be
       * present. So the empty form is accepted exactly when `required` is not
       * being enforced — which is also what keeps a draft saveable while
       * half-finished, the rule the rest of this file follows.
       */
      const uuid = z.string().uuid();
      if (field.required && enforceRequired) return uuid;
      return z.union([uuid, z.literal('')]).transform((v) => (v === '' ? undefined : v));
    }
    case 'relation':
      return field.many
        ? bounded(z.array(z.number().int().positive()), undefined, MAX_ARRAY_ITEMS)
        : z.number().int().positive();
    case 'repeater':
      // Thread `locales` so localized fields nested in a repeater validate
      // against the real site locales (not the `['*']` placeholder).
      //
      // `min`/`max` were declared on RepeaterField and honoured by the admin UI
      // (which disables Add/Remove at the limits) but never by the validator —
      // so the API accepted any number of rows, and the config's own limits were
      // a suggestion. They are enforced here now.
      return bounded(
        z.array(objectSchema(field.fields, locales, true, enforceRequired)),
        field.min,
        field.max ?? MAX_ARRAY_ITEMS,
      );
    case 'group':
      return objectSchema(field.fields, locales, field.strict, enforceRequired);
    case 'variations':
      // One generated combination per row. `options` maps attribute name →
      // selected value label; the rest are per-variation overrides.
      return z.array(
        z
          .object({
            id: z.string(),
            options: z.record(z.string(), z.string()),
            sku: z.string().optional(),
            price: z.number().min(0).optional(),
            stock: z.number().int().min(0).optional(),
            image: z.string().uuid().optional(),
            enabled: z.boolean().optional(),
            weight: z.number().min(0).optional(),
          })
          .strict(),
      );
  }
}

/** Wrap a scalar with `.optional()`/`.default()` and locale-map handling
 *  according to the field's `required`/`localized` flags. */
function applyModifiers(
  field: Field,
  base: z.ZodType,
  locales: string[],
  enforceRequired = false,
): z.ZodType {
  let schema = base;

  // A conditional field is never required by the STATIC shape — whether it is
  // visible depends on a sibling value the shape cannot see. `objectSchema`
  // re-checks it afterwards, where the whole object is in hand.
  const conditional = field.showIf !== undefined;

  // `required` normally means only "the key is present", which let a published
  // document carry empty strings for every field it declares as required. When
  // the document is going live, an empty string is not a value.
  if (enforceRequired && field.required && !conditional && schema instanceof z.ZodString) {
    // Name the field the way the form names it. Saying "eyebrow is required"
    // to someone looking at a box labelled "Kicker" is a riddle.
    const name = typeof field.label === 'string' ? field.label : field.key;
    schema = schema.min(1, `${name} is required`);
  }

  if (field.localized) {
    // A `{ [locale]: value }` map, PARTIAL: any locale may be missing.
    //
    // `z.record(z.enum(locales), …)` is exhaustive under zod v4 — every enum
    // key must be present — so adding a locale to the site made every stored
    // document unsaveable until someone filled the new language into every
    // localized field. Present locales are still validated, and unknown ones
    // still refused.
    //
    // A required localized field must carry the DEFAULT locale (non-empty) to
    // go live; `buildDataSchema` puts the default first in `locales`.
    const map = z.partialRecord(z.enum(locales as [string, ...string[]]), base);
    const primary = locales[0];
    schema =
      enforceRequired && field.required && !conditional
        ? map.refine(
            (v) => {
              const own = (v as Record<string, unknown>)[primary];
              return own !== undefined && own !== null && own !== '';
            },
            `${typeof field.label === 'string' ? field.label : field.key} is required (${primary})`,
          )
        : map;
  }

  const hasDefault =
    'default' in field && (field as { default?: unknown }).default !== undefined;

  // `required` means "must be there to go live", not "must be there to save".
  // A draft is unfinished by definition — an author saving a half-written
  // article must not be blocked — so nothing is required until the document is
  // published or scheduled, and then everything declared required must be
  // present AND non-empty.
  //
  // Note a group is required only when the group itself says so. Inferring it
  // from a required child is wrong: "optional section, but fill it in properly
  // if you use it" is exactly how an answer's `howTo` is meant to work. Groups
  // the page cannot render without carry `required: true` in the config.
  if (!field.required || !enforceRequired || conditional) {
    schema = schema.optional();
  }
  if (hasDefault && !field.localized) {
    schema = schema.default((field as { default: unknown }).default);
  }
  return schema;
}

function objectSchema(
  fields: Field[],
  locales: string[] = ['*'],
  strict = true,
  enforceRequired = false,
): z.ZodType {
  const shape: Record<string, z.ZodType> = {};
  for (const field of fields) {
    shape[field.key] = applyModifiers(
      field,
      scalarSchema(field, locales, enforceRequired),
      locales,
      enforceRequired,
    );
  }
  // Reject unknown keys so config drift surfaces immediately — except for
  // groups that opt out (`strict: false`), where unknown keys are stripped.
  const object = strict ? z.object(shape).strict() : z.object(shape);

  /*
   * `showIf` fields are enforced here rather than in the shape, because
   * visibility depends on a sibling value only the parsed object knows.
   *
   * A hidden field is skipped entirely — not merely un-required. Turning a
   * booking from transport to stay leaves its transport pricing in `data` on
   * purpose, so switching back loses nothing; validating that leftover against
   * rules the editor cannot currently see would make the document unpublishable
   * with no field on screen to fix.
   */
  const conditionals = fields.filter((field) => field.showIf && field.required);
  if (conditionals.length === 0 || !enforceRequired) return object;

  return object.superRefine((value, ctx) => {
    const obj = (value ?? {}) as Record<string, unknown>;
    for (const field of conditionals) {
      if (!isFieldVisible(field, obj, fields)) continue;
      const own = obj[field.key];
      const empty =
        own === undefined ||
        own === null ||
        own === '' ||
        (Array.isArray(own) && own.length === 0) ||
        // A localized value is a `{ [locale]: value }` map; it is empty when
        // every locale is.
        (field.localized &&
          typeof own === 'object' &&
          !Array.isArray(own) &&
          Object.values(own as Record<string, unknown>).every((v) => v === undefined || v === ''));
      if (!empty) continue;
      const name = typeof field.label === 'string' ? field.label : field.key;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field.key],
        message: `${name} is required`,
      });
    }
  });
}

/**
 * The validator for a collection's `data` payload.
 *
 * @param fields  the collection's field set
 * @param locales the site locales, used to type localised-field maps
 * @param opts.defaultLocale
 *   The locale a required localized field must carry to go live. Defaults to
 *   `locales[0]`.
 * @param opts.enforceRequired
 *   Hold the payload to what `required` actually promises: required strings must
 *   be non-empty, and a group holding required fields may not be omitted.
 *   Applied when a document goes live (`published`/`scheduled`), NOT on drafts —
 *   authors save half-finished work all the time, and a draft cannot break the
 *   public site.
 */
export function buildDataSchema(
  fields: Field[],
  locales: string[],
  opts: { enforceRequired?: boolean; defaultLocale?: string } = {},
): z.ZodType {
  // The default locale goes first: a required localized field is checked on
  // `locales[0]` (see `applyModifiers`). Without `defaultLocale` the caller's
  // order stands.
  const { defaultLocale } = opts;
  const ordered =
    defaultLocale && locales.includes(defaultLocale)
      ? [defaultLocale, ...locales.filter((l) => l !== defaultLocale)]
      : locales;
  return objectSchema(fields, ordered, true, opts.enforceRequired ?? false);
}
