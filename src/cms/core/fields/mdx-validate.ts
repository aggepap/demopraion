/**
 * Write-path enforcement of the MDX guard.
 *
 * Split from `mdx-guard.ts` because that module is pure and this one needs the
 * MDX parser: the guard judges a *tree*, and getting a tree from a source string
 * means parsing it.
 *
 * It runs from `core/documents/service.ts` rather than from inside the zod
 * schema for two reasons. `config/zod.ts` is re-exported through the
 * `@/cms/config` barrel that admin *client* components import, and pulling the
 * MDX compiler (acorn and all) into that graph would put a parser in the browser
 * bundle to no purpose. And `createDocument`/`updateDocument` are the single
 * chokepoint every write passes through — the admin form, the generic collection
 * CRUD, the seed CLIs and the PM bridge all land there — so one call covers
 * every principal that can author a body.
 *
 * ## Why the parser is imported dynamically
 *
 * `@mdx-js/mdx` depends on `estree-walker`, which publishes an `import`-only
 * export map. The `tsx` CLI compiles to CJS, so a static import turns into a
 * `require()` and throws `ERR_PACKAGE_PATH_NOT_EXPORTED` — which would break
 * `npm test` and, worse, every `db:seed-*` CLI, since those go through
 * `createDocument` too. A dynamic `import()` stays an import in both worlds.
 * That is also why the exported functions are async.
 */
import { walkFields, type Field } from '../../config';
import { invalidInput } from '../errors';
import { findMdxViolations } from './mdx-guard';

type Processor = { parse(source: string): unknown };

/**
 * One processor, reused. `createProcessor()` configures acorn and assembles the
 * micromark extensions each time it is called, which is real work to repeat per
 * document save when the result is identical.
 */
let processorPromise: Promise<Processor> | null = null;

function getProcessor(): Promise<Processor> {
  processorPromise ??= import('@mdx-js/mdx').then(({ createProcessor }) => createProcessor());
  return processorPromise;
}

/** Every reason `source` may not be stored. Empty means it is safe. */
export async function validateMdxSource(
  source: string,
  allowed: readonly string[],
): Promise<string[]> {
  if (source.trim() === '') return [];

  let tree: unknown;
  try {
    tree = (await getProcessor()).parse(source);
  } catch (err) {
    // Unparseable MDX would fail at render anyway, and it fails here with a
    // line number the editor can use instead of a blank page later.
    const message = err instanceof Error ? err.message : String(err);
    return [`This is not valid MDX: ${message}`];
  }

  return findMdxViolations(tree, allowed);
}

/** A field's stored value, or values — a localized field holds one per locale. */
function stringValues(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  // Localized: a `{ [locale]: string }` map.
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return Object.values(value as Record<string, unknown>).filter(
      (v): v is string => typeof v === 'string',
    );
  }
  return [];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Check every MDX field in `data` against its declared allow-list.
 *
 * Returns `path → messages`, matching the `pathErrors` shape the admin form
 * already reads, so a refused body surfaces under the body control rather than
 * as a bare "Validation failed".
 *
 * Fields are found by walking the field tree rather than by hard-coding
 * `bodyMdx`: `f.mdx` is a public builder, and a body nested in a group or a
 * repeater must be checked the same way as a top-level one.
 */
export async function findMdxFieldErrors(
  fields: Field[],
  data: Record<string, unknown>,
): Promise<Record<string, string[]>> {
  // Most collections have no MDX at all (a product, a category, a size chart),
  // and this runs on every write — so establish there is something to do before
  // loading a compiler.
  if (!hasMdxField(fields)) return {};

  const errors: Record<string, string[]> = {};

  const check = async (
    fieldList: Field[],
    value: Record<string, unknown>,
    prefix: string[],
  ): Promise<void> => {
    for (const field of fieldList) {
      const path = [...prefix, field.key];
      const own = value[field.key];

      if (isMdxField(field)) {
        for (const source of stringValues(own)) {
          // `allowedFor` is [] when the field declares no list — an MDX body with
          // no allow-list may contain prose, and nothing else.
          const violations = await validateMdxSource(source, allowedFor(field));
          if (violations.length > 0) {
            (errors[path.join('.')] ??= []).push(...violations);
          }
        }
        continue;
      }

      if (field.kind === 'group' && isRecord(own)) {
        await check(field.fields, own, path);
        continue;
      }

      if (field.kind === 'repeater' && Array.isArray(own)) {
        for (const [index, row] of own.entries()) {
          if (isRecord(row)) await check(field.fields, row, [...path, String(index)]);
        }
      }
    }
  };

  await check(fields, data, []);
  return errors;
}

/**
 * Whether a field set declares any MDX at all — so the common case (a
 * collection with no body, e.g. a product or a category) skips the walk.
 */
export function hasMdxField(fields: Field[]): boolean {
  let found = false;
  walkFields(fields, (field) => {
    if (isMdxField(field)) found = true;
  });
  return found;
}

/**
 * An MDX body field, whether or not it declares an allow-list.
 *
 * The predicate used to be `language === 'mdx' && field.allowedComponents`,
 * which made the *absence* of an allow-list mean "nothing to check" rather than
 * "nothing is allowed". A field declared as `f.mdx('body')` with the option
 * forgotten was therefore invisible to the whole walk: not refused, not
 * reported, simply never parsed — and its body is executed server-side at render
 * time. The one field set most in need of the guard was the one that skipped it.
 *
 * Every current call site in `site.config.ts` does pass `MDX_ALLOWED_COMPONENTS`,
 * so this closes the gap before it is stepped in rather than after.
 */
function isMdxField(field: Field): field is Extract<Field, { kind: 'code' }> {
  return field.kind === 'code' && field.language === 'mdx';
}

/** The allow-list a field declares, defaulting to "no components at all". */
function allowedFor(field: Extract<Field, { kind: 'code' }>): readonly string[] {
  return field.allowedComponents ?? [];
}

/**
 * Throw the standard `invalid_input` error when any MDX field in `data` is
 * unsafe. Shaped like the zod failure `validateData` throws — `pathErrors` keyed
 * by field path — so the admin form puts the message under the body control it
 * belongs to rather than showing a bare "Validation failed".
 */
export async function assertMdxSafe(
  fields: Field[],
  data: Record<string, unknown>,
): Promise<void> {
  const pathErrors = await findMdxFieldErrors(fields, data);
  const paths = Object.keys(pathErrors);
  if (paths.length === 0) return;

  const fieldErrors: Record<string, string[]> = {};
  for (const path of paths) {
    // The form groups by top-level key; the full path stays in `pathErrors`.
    (fieldErrors[path.split('.')[0]] ??= []).push(...pathErrors[path]);
  }
  throw invalidInput({ formErrors: [], fieldErrors, pathErrors });
}
