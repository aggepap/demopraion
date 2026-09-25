/**
 * Render a small, fixed subset of inline HTML as React nodes.
 *
 * ## Why this exists
 *
 * `faq.questionHtml` used to go straight into `dangerouslySetInnerHTML`. The
 * field is a plain `f.text` in `site.config.ts` — no allow-list, no sanitiser —
 * so anything with content-write access could put a `<script>` in an article's
 * FAQ question and have it execute for every visitor. `next.config.ts` sets
 * `script-src 'unsafe-inline'` (deliberately, for the site's inline JSON-LD), so
 * CSP does not catch it either.
 *
 * ## Why a parser rather than a sanitiser
 *
 * The field only ever needed to carry inline emphasis. It exists because the
 * static FAQ items were authored as JSX — `questionNode: <em className="italic
 * font-display">…</em>` in `src/content/approach.tsx` — and `src/seeds/articles.ts`
 * flattens those with `renderToStaticMarkup` so they can live in a JSON column.
 * So the requirement is one `<em>` with a class, not arbitrary markup.
 *
 * Given that, parsing into React elements beats sanitising a string: there is no
 * `dangerouslySetInnerHTML` left anywhere in the path, so a gap in the rules
 * yields escaped text on screen rather than live markup. Anything unrecognised —
 * a tag not on the list, an attribute not on the list, a comment, a stray `<` —
 * ends up as text, which is the safe direction to fail. No new dependency, and
 * it is pure, so `test/lib/inline-html.test.ts` covers it directly.
 */
import type { ReactNode } from 'react';

/**
 * Tags that may appear. Inline emphasis and a line break — nothing that can
 * carry a URL, load a resource or run a handler.
 */
const ALLOWED_TAGS = new Set(['em', 'strong', 'b', 'i', 'span', 'br']);

/** Void elements among the allowed tags (no closing tag, no children). */
const VOID_TAGS = new Set(['br']);

/**
 * `class` is the only attribute kept, because it is the only one the stored
 * content uses (`italic font-display`). Notably absent: `style` (a CSS injection
 * surface) and every `on*` handler.
 */
const ALLOWED_ATTRS = new Set(['class']);

/** `&amp;` → `&`, plus the numeric forms. Anything unrecognised is left as-is,
 *  so an unescaped `&` in authored text survives as an `&`. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
  nbsp: ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    const key = name.toLowerCase();
    if (key in NAMED_ENTITIES) return NAMED_ENTITIES[key];
    if (key.startsWith('#x')) {
      const code = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (key.startsWith('#')) {
      const code = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return whole;
  });
}

/** `class="a b"` / `class='a b'` / `class=ab` → `{ class: 'a b' }`. */
function parseAttrs(raw: string): { className?: string } {
  const out: { className?: string } = {};
  const attr = /([a-zA-Z-]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = attr.exec(raw)) !== null) {
    const name = match[1].toLowerCase();
    if (!ALLOWED_ATTRS.has(name)) continue;
    const value = match[3] ?? match[4] ?? match[5] ?? '';
    if (name === 'class') out.className = decodeEntities(value);
  }
  return out;
}

/** One open/close/self-closing tag, or nothing if this isn't a tag at all. */
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;

/**
 * Parse `html` into React nodes, keeping only `ALLOWED_TAGS` with
 * `ALLOWED_ATTRS`. Everything else becomes text.
 *
 * Returns a `ReactNode` suitable for use as a `questionNode` (or anywhere else a
 * short run of authored inline markup is rendered).
 */
export function renderInlineHtml(html: string): ReactNode {
  if (!html) return null;

  // A stack of open elements; the bottom frame collects the result.
  const stack: Array<{ tag: string; className?: string; children: ReactNode[] }> = [
    { tag: '', children: [] },
  ];
  let cursor = 0;
  let key = 0;

  const top = () => stack[stack.length - 1];
  const pushText = (text: string) => {
    if (text !== '') top().children.push(decodeEntities(text));
  };

  TAG.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG.exec(html)) !== null) {
    const [whole, closing, rawName, rawAttrs, selfClosing] = match;
    const tag = rawName.toLowerCase();

    // Text before this tag.
    pushText(html.slice(cursor, match.index));
    cursor = match.index + whole.length;

    if (!ALLOWED_TAGS.has(tag)) {
      // Not a tag we render: emit the source text so it is *visible*, escaped by
      // React, rather than silently dropped. A disallowed tag is authoring
      // feedback; a vanished one is a mystery.
      pushText(whole);
      continue;
    }

    if (closing === '/') {
      // Close the nearest matching open element. An unmatched close is ignored
      // (there is nothing sensible to close), which keeps malformed input from
      // unwinding past the root.
      const index = stack.findIndex((frame) => frame.tag === tag);
      if (index > 0) {
        // Closing `</em>` while `<strong>` is still open closes both, innermost
        // first — the same recovery a browser performs on crossed tags.
        while (stack.length > index) {
          const frame = stack.pop()!;
          top().children.push(elementFor(frame.tag, frame.className, frame.children, key++));
        }
      }
      continue;
    }

    if (VOID_TAGS.has(tag) || selfClosing === '/') {
      top().children.push(<br key={key++} />);
      continue;
    }

    stack.push({ tag, className: parseAttrs(rawAttrs).className, children: [] });
  }

  pushText(html.slice(cursor));

  // Any element left open at the end is closed here, so unbalanced markup still
  // renders its text.
  while (stack.length > 1) {
    const frame = stack.pop()!;
    top().children.push(elementFor(frame.tag, frame.className, frame.children, key++));
  }

  const children = stack[0].children;
  return children.length === 1 ? children[0] : <>{children}</>;
}

/** Build the actual element for a closed frame. Kept separate so the tag→element
 *  mapping is stated once and is obviously exhaustive over `ALLOWED_TAGS`. */
function elementFor(
  tag: string,
  className: string | undefined,
  children: ReactNode[],
  key: number,
): ReactNode {
  switch (tag) {
    case 'em':
      return (
        <em key={key} className={className}>
          {children}
        </em>
      );
    case 'strong':
      return (
        <strong key={key} className={className}>
          {children}
        </strong>
      );
    case 'b':
      return (
        <b key={key} className={className}>
          {children}
        </b>
      );
    case 'i':
      return (
        <i key={key} className={className}>
          {children}
        </i>
      );
    default:
      return (
        <span key={key} className={className}>
          {children}
        </span>
      );
  }
}
