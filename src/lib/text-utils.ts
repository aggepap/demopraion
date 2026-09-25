import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react';

/**
 * Thin space (U+2009, 1/5 em) — narrower than a regular space, used in
 * typography to insert breathing room without breaking visual flow.
 * Written as an explicit Unicode escape because the literal character
 * is indistinguishable from a regular space in some editor/transport
 * paths (it would silently collapse to U+0020 and HTML whitespace
 * handling would render it invisible at runtime).
 */
const THIN_SPACE = ' ';

/**
 * Match a non-whitespace, non-thin-space character immediately followed
 * by `;` or `?`. The capture group is the preceding character so the
 * replacement can keep it and slip the thin space between. Handles the
 * "inside a single string" case (e.g. `"What is AEO?"`).
 */
const QUESTION_PUNCTUATION_INLINE = /([^\s ])([;?])/g;

/**
 * Insert a thin space between the last letter and a `;` or `?` in a
 * plain string. Greek uses `;` as its question mark, English uses `?` —
 * both are covered. Idempotent: if a thin space (or any whitespace) is
 * already there, the regex skips it.
 */
export function addThinSpaceBeforeQuestionPunctuation(text: string): string {
  return text.replace(QUESTION_PUNCTUATION_INLINE, `$1${THIN_SPACE}$2`);
}

/**
 * Does this sibling end with something a `;` / `?` would visually crash
 * into? Strings ending in non-whitespace, numbers, and JSX elements all
 * count — only nullish / boolean / empty-trailing-whitespace strings
 * fail. Used to decide whether a leading-`;`/`?` text node needs a thin
 * space prepended because the preceding sibling brought a glyph close to
 * the punctuation.
 */
function endsWithRenderableGlyph(node: ReactNode): boolean {
  if (node === null || node === undefined || typeof node === 'boolean') return false;
  if (typeof node === 'string') return /\S$/.test(node);
  if (typeof node === 'number') return true;
  if (Array.isArray(node)) {
    for (let i = node.length - 1; i >= 0; i--) {
      const result = endsWithRenderableGlyph(node[i]);
      if (result || node[i] !== null) return result || isValidElement(node[i]);
    }
    return false;
  }
  if (isValidElement(node)) return true;
  return false;
}

/**
 * Recursively walk a `ReactNode` and apply the thin-space transform to
 * every string leaf. JSX elements are cloned with their children
 * transformed; non-string, non-element nodes (numbers, booleans, null,
 * undefined) pass through unchanged.
 *
 * Two passes when descending into an array of children:
 *   1. Each child is recursively transformed in isolation (handles
 *      strings like `"What is AEO?"` where the regex catches the
 *      `letter + ?` pair directly).
 *   2. After step 1, any child that starts with `;` or `?` AND whose
 *      previous sibling rendered a glyph (text or element) gets a thin
 *      space prepended — covers the JSX pattern
 *      `<>Why <em>Engine</em>?</>` where the `?` is a standalone text
 *      node right after the `</em>` boundary.
 *
 * Used by the shared `Accordion` primitive to gently space FAQ question
 * marks away from the preceding letter — fixes the optical cramming
 * that italic Fraunces produces with `;` / `?` in Greek + English FAQs.
 *
 * Safe to apply broadly: text without `;` / `?` is returned untouched,
 * so non-question accordion labels (e.g. mobile nav submenu titles)
 * are unaffected.
 */
export function padQuestionPunctuation(node: ReactNode): ReactNode {
  if (typeof node === 'string') {
    return addThinSpaceBeforeQuestionPunctuation(node);
  }
  if (
    typeof node === 'number' ||
    typeof node === 'boolean' ||
    node === null ||
    node === undefined
  ) {
    return node;
  }
  if (Array.isArray(node)) {
    // Pass 1: recurse into each child first.
    const recursed = node.map((child) => padQuestionPunctuation(child));
    // Pass 2: prepend thin space to strings that start with `;` / `?`
    // when the previous sibling rendered something visible.
    const padded = recursed.map((child, i) => {
      if (
        typeof child === 'string' &&
        (child.startsWith(';') || child.startsWith('?')) &&
        i > 0 &&
        endsWithRenderableGlyph(recursed[i - 1])
      ) {
        return THIN_SPACE + child;
      }
      return child;
    });
    // Explicitly assign a key to every element child via `cloneElement`
    // before returning, then wrap in `Children.toArray` as a second
    // safety net. Belt-and-braces: the toArray fix alone from PR #28
    // wasn't silencing the warning in React 19 when the array was
    // handed off via cloneElement to a Fragment — directly cloning
    // each element with a stable `pq-${i}` key guarantees React's
    // reconciler sees an explicit `.key` on every element.
    const keyed = padded.map((child, i) =>
      isValidElement(child) && child.key === null
        ? cloneElement(child, { key: `pq-${i}` })
        : child
    );
    return Children.toArray(keyed);
  }
  if (isValidElement(node)) {
    const element = node as ReactElement<{ children?: ReactNode }>;
    if (element.props.children === undefined) return element;
    return cloneElement(
      element,
      undefined,
      padQuestionPunctuation(element.props.children)
    );
  }
  return node;
}
