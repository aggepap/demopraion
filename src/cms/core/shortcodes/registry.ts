/**
 * What a shortcode is allowed to be.
 *
 * A module declares its shortcodes here: the name, the attributes, and the
 * shape of each attribute. Two things follow from one declaration — the zod
 * schema that validates what an editor typed, and the form the insert dialog
 * draws. They cannot drift apart, because there is only one of them.
 *
 * Client-safe: metadata only, no server imports, so the admin dialog can render
 * the same list the server validates against.
 */
import { z } from 'zod';

export type AttrSpec =
  | { kind: 'text'; maxLength?: number; pattern?: RegExp; default?: string }
  | { kind: 'select'; options: readonly string[]; default?: string }
  | { kind: 'int'; min?: number; max?: number; default?: number }
  | { kind: 'boolean'; default?: boolean };

export interface ShortcodeDef {
  name: string;
  label: string;
  description?: string;
  /** The module that must be on for this to render. Absent = always available. */
  module?: string;
  attrs: Record<string, AttrSpec>;
  /** PascalCase, for the MDX allowlist and the component map. */
  componentName: string;
}

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** `google-reviews` → `GoogleReviews`. */
export function componentNameFor(name: string): string {
  return name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

export function defineShortcode(def: Omit<ShortcodeDef, 'componentName'>): ShortcodeDef {
  if (!NAME.test(def.name)) {
    throw new Error(
      `Shortcode name "${def.name}" must be lowercase kebab-case — it is typed by hand into a page body.`
    );
  }
  return { ...def, componentName: componentNameFor(def.name) };
}

const TEXT_MAX = 500;

/** The schema for one shortcode's attributes. Strict: an undeclared attribute
 *  is refused rather than forwarded to a component. */
export function attrsToZod(attrs: Record<string, AttrSpec>) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, spec] of Object.entries(attrs)) {
    switch (spec.kind) {
      case 'text': {
        let field = z.string().max(spec.maxLength ?? TEXT_MAX);
        if (spec.pattern) field = field.regex(spec.pattern);
        shape[key] = field.default(spec.default ?? '');
        break;
      }
      case 'select':
        shape[key] = z
          .enum([...spec.options] as [string, ...string[]])
          .default(spec.default ?? spec.options[0]);
        break;
      case 'int':
        // Coerced: everything arrives as text from a page body.
        shape[key] = z.coerce
          .number()
          .int()
          .min(spec.min ?? 0)
          .max(spec.max ?? 1000)
          .default(spec.default ?? spec.min ?? 0);
        break;
      case 'boolean':
        // The words an author would actually type.
        shape[key] = z
          .union([z.boolean(), z.enum(['true', 'false', 'yes', 'no', '1', '0'])])
          .transform((value) =>
            typeof value === 'boolean' ? value : ['true', 'yes', '1'].includes(value)
          )
          .default(spec.default ?? false);
        break;
    }
  }
  return z.object(shape).strict();
}

export type ShortcodeRegistry = Record<string, ShortcodeDef>;

export type ShortcodeResolution =
  | { kind: 'ok'; def: ShortcodeDef; attrs: Record<string, unknown> }
  /** No such shortcode — a typo, or one a site does not have. */
  | { kind: 'unknown' }
  /** Real, but its module is switched off. */
  | { kind: 'disabled'; def: ShortcodeDef }
  /** Real and enabled, but the attributes do not pass. */
  | { kind: 'invalid'; def: ShortcodeDef; message: string };

/**
 * Decide what a parsed shortcode should do.
 *
 * The public site renders nothing for anything but `ok`; the editor shows a
 * different warning for each case, because "you have not switched this on" and
 * "this does not exist" need different fixes.
 */
export function resolveShortcode(
  registry: ShortcodeRegistry,
  parsed: { name: string; attrs: Record<string, string> },
  moduleFlags: Readonly<Record<string, boolean>>
): ShortcodeResolution {
  if (!Object.hasOwn(registry, parsed.name)) return { kind: 'unknown' };
  const def = registry[parsed.name];
  if (def.module && moduleFlags[def.module] !== true) return { kind: 'disabled', def };

  const result = attrsToZod(def.attrs).safeParse(parsed.attrs);
  if (!result.success) {
    const issue = result.error.issues[0];
    return {
      kind: 'invalid',
      def,
      message: issue
        ? `${issue.path.join('.') || 'attribute'}: ${issue.message}`
        : 'Invalid attributes.',
    };
  }
  return { kind: 'ok', def, attrs: result.data };
}

/** Every allowed component name, for the MDX allowlist. */
export function shortcodeComponentNames(registry: ShortcodeRegistry): string[] {
  return Object.values(registry)
    .map((def) => def.componentName)
    .sort();
}
