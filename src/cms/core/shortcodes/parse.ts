/**
 * The `[name attr="value"]` grammar.
 *
 * ## Why only a whole paragraph counts
 *
 * Square brackets appear in ordinary prose — "[see below]", "[sic]", a Greek
 * citation — and a body that reinterpreted them would rewrite content that was
 * typed years before this feature existed. So a shortcode is recognised only
 * when a paragraph consists of exactly one, and `[[name]]` escapes to a literal
 * `[name]` for an author writing about shortcodes.
 *
 * ## What this file does NOT decide
 *
 * Whether the shortcode exists, whether its module is on, and whether its
 * attributes are acceptable. That is `registry.ts`, and it is where the
 * validation that matters lives: this only recognises the shape.
 */

export interface ParsedShortcode {
  name: string;
  attrs: Record<string, string>;
}

/** Bounds, so a pathological body cannot turn into pathological work. */
const MAX_INPUT = 2000;
const MAX_NAME = 40;
const MAX_VALUE = 500;

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** `key="value"`, where a value may contain escaped quotes. */
const ATTR = /([a-zA-Z][a-zA-Z0-9_-]*)\s*=\s*"((?:[^"\\]|\\.)*)"/g;

/**
 * One shortcode, or `null`.
 *
 * `null` covers everything that is not exactly one: surrounding text, two in a
 * row, an unknown shape, an escaped one, and anything too long to be a
 * reasonable shortcode.
 */
export function parseShortcode(raw: string): ParsedShortcode | null {
  const text = raw.trim();
  if (text.length === 0 || text.length > MAX_INPUT) return null;
  // Escaped: `[[name]]` is how an author writes a literal `[name]`.
  if (text.startsWith('[[')) return null;
  if (!text.startsWith('[') || !text.endsWith(']')) return null;

  const inner = text.slice(1, -1);
  // A bracket in an ATTRIBUTE VALUE is fine; one outside a value would mean
  // this is not a single shortcode.
  const withoutValues = inner.replace(ATTR, '');
  if (withoutValues.includes('[') || withoutValues.includes(']')) return null;

  const nameMatch = /^\s*([^\s\]]+)/.exec(inner);
  if (!nameMatch) return null;
  const name = nameMatch[1];
  if (name.length > MAX_NAME || !NAME.test(name)) return null;

  const rest = inner.slice(nameMatch[0].length);
  const attrs: Record<string, string> = {};
  ATTR.lastIndex = 0;
  let consumed = '';
  for (let match = ATTR.exec(rest); match !== null; match = ATTR.exec(rest)) {
    const [whole, key, value] = match;
    if (value.length > MAX_VALUE) return null;
    consumed += whole;
    // First wins: two values for one attribute is a mistake, and silently
    // preferring the last would be a coin toss.
    if (!(key in attrs)) attrs[key] = value.replace(/\\(["\\])/g, '$1');
  }
  // Anything left over that is not whitespace means the shape was not this.
  if (rest.replace(ATTR, '').trim().length > 0 && consumed.length === 0) return null;
  if (rest.replace(ATTR, '').trim().length > 0) return null;

  return { name, attrs };
}

/** The same, for a paragraph's plain text. Named for what the caller has. */
export function shortcodeFromParagraph(text: string): ParsedShortcode | null {
  return parseShortcode(text);
}

/** `[[name]]` → `[name]`, applied when a paragraph is rendered as text. */
export function unescapeShortcode(text: string): string {
  return text.replace(/^\s*\[\[(.+)\]\]\s*$/, '[$1]');
}

/** Write one out, for the insert dialog and the "copy shortcode" buttons. */
export function serializeShortcode(name: string, attrs: Record<string, string>): string {
  const parts = Object.entries(attrs)
    .filter(([, value]) => value !== '' && value !== undefined && value !== null)
    .map(([key, value]) => `${key}="${String(value).replace(/(["\\])/g, '\\$1')}"`);
  return parts.length ? `[${name} ${parts.join(' ')}]` : `[${name}]`;
}
