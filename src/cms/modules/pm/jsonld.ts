/**
 * Serialising JSON-LD safely into a `<script>` element.
 *
 * ## Why this is not `JSON.stringify`
 *
 * The payload is operator-supplied JSON going into `dangerouslySetInnerHTML`.
 * HTML parsing of a `<script>` block ends at the first `</script` sequence
 * *regardless of JSON quoting* — so a string value containing
 * `</script><img onerror=...>` closes the element early and executes as markup.
 * That is a full XSS on every page carrying the payload, and no amount of valid
 * JSON prevents it.
 *
 * Escaping `<`, `>` and `&` as `\uXXXX` keeps the output valid JSON — a parser
 * reads the escapes back as the original characters — while making the byte
 * sequence the HTML tokeniser looks for impossible to write.
 *
 * `U+2028` and `U+2029` are escaped for a different reason: they are legal
 * inside a JSON string but are line terminators in JavaScript, so an unescaped
 * one can break a script block that is parsed rather than fetched. They appear
 * below as escape sequences rather than literal characters — a literal one would
 * terminate the source line it sits on.
 *
 * Pure and dependency-free so the tests can call it directly.
 */

const ESCAPES: Record<string, string> = {
  '<': '\\u003c',
  '>': '\\u003e',
  '&': '\\u0026',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
};

const UNSAFE = /[<>&\u2028\u2029]/g;

/**
 * JSON for embedding in a script element.
 *
 * The replacement runs over the *serialised* string rather than over the values,
 * so it catches these characters wherever they appear — in a key, in a nested
 * value, or inside an array — without having to walk the structure.
 */
export function safeJsonLd(value: unknown): string {
  return JSON.stringify(value ?? null).replace(UNSAFE, (char) => ESCAPES[char] ?? char);
}
