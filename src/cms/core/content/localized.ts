/**
 * Reading a `localized` field for display.
 *
 * A field declared `localized: true` is stored as `{ el: …, en: … }`, and every
 * place that shows one has to pick a language. Popups and testimonials did not:
 * they ran the map through `String()` and showed visitors "[object Object]".
 *
 * The order is the current locale, then the site's default locale, then any
 * language that has something — an untranslated field is better shown in the
 * main language than left blank. A value saved before the field was localized
 * is a bare value and is returned as it is.
 *
 * Plain functions with no imports, so site components, module read layers and
 * the admin can all share them.
 */

type Present = (value: unknown) => boolean;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pick(
  map: Record<string, unknown>,
  locale: string,
  defaultLocale: string,
  present: Present,
): unknown {
  if (present(map[locale])) return map[locale];
  if (present(map[defaultLocale])) return map[defaultLocale];
  return Object.values(map).find(present);
}

const hasText: Present = (v) => typeof v === 'string' && v.trim() !== '';

/** A localized (or plain) text field as display text; `''` when there is none. */
export function localizedText(value: unknown, locale: string, defaultLocale: string): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (!isPlainObject(value)) return '';
  const chosen = pick(value, locale, defaultLocale, hasText);
  return typeof chosen === 'string' ? chosen.trim() : '';
}

/** A TipTap document with at least one node — what `RichText` would render. */
function isNonEmptyDoc(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    value.type === 'doc' &&
    Array.isArray(value.content) &&
    value.content.length > 0
  );
}

/**
 * A localized (or plain) rich-text field: the document for the locale, or null.
 *
 * A TipTap document is itself an object, so it is recognised by its
 * `type: 'doc'` before the value is treated as a per-locale map.
 */
export function localizedValue(value: unknown, locale: string, defaultLocale: string): unknown {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value) || value.type === 'doc') return value;
  return pick(value, locale, defaultLocale, isNonEmptyDoc) ?? null;
}
