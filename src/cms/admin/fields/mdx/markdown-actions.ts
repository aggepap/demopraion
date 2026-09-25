/**
 * Markdown transforms for the body editor's toolbar.
 *
 * Pure by design — every function takes the textarea's value plus its selection
 * offsets and returns a description of the edit, so the whole toolbar is
 * unit-testable without a DOM (`test/cms/mdx-markdown-actions.test.ts`).
 * Applying the edit, and doing it in a way that preserves the browser's native
 * undo stack, is `apply-edit.ts`'s job.
 *
 * There is no H1 action, deliberately. The `<h1>` comes from the collection's
 * own title/header field and is rendered by the page
 * (`src/app/[locale]/insights/[article]/page.tsx`), and `src/mdx-components.tsx`
 * overrides only `h2`/`h3` — so a `#` in a body produces an unstyled second
 * `<h1>` with no anchor id, which also breaks the Contents field that indexes
 * those ids. `lint.ts` warns when one appears.
 */

export type MdAction =
  | 'bold'
  | 'italic'
  | 'code'
  | 'h2'
  | 'h3'
  | 'bullet'
  | 'ordered'
  | 'quote'
  | 'indent'
  | 'outdent';

export interface Sel {
  value: string;
  start: number;
  end: number;
}

/**
 * A splice into the original value, plus where the selection lands afterwards.
 * `from`/`to` are absolute offsets in the value the edit was computed from.
 */
export interface Edit {
  from: number;
  to: number;
  text: string;
  selStart: number;
  selEnd: number;
}

const INDENT = '  ';

/** Broad strip patterns: what a line prefix replaces when converting. */
const HEADING = /^#{1,6}\s+/;
const LIST = /^([-*+]|\d+\.)\s+/;

/** The whole-line span covering the selection. */
function lineBounds(value: string, start: number, end: number): { from: number; to: number } {
  const from = value.lastIndexOf('\n', start - 1) + 1;
  const nl = value.indexOf('\n', end);
  return { from, to: nl === -1 ? value.length : nl };
}

/**
 * Toggle a per-line prefix across every non-blank selected line.
 *
 * `strip` and `active` are deliberately different patterns. `strip` is broad —
 * it removes whatever competing marker is there, which is what makes H2 convert
 * an H3 line and "numbered list" convert a bulleted one. `active` is narrow: it
 * matches only the marker this button produces, so the toggle-off path fires
 * when the line is *already what the button makes* and not merely something
 * adjacent. Using `strip` for both is the bug where pressing H2 on an H3
 * silently deleted the heading.
 */
function linePrefix(sel: Sel, prefix: (index: number) => string, strip: RegExp, active: RegExp): Edit {
  const { from, to } = lineBounds(sel.value, sel.start, sel.end);
  const lines = sel.value.slice(from, to).split('\n');
  const meaningful = lines.filter((l) => l.trim() !== '');
  // Toggle off only when every meaningful line already carries the marker —
  // the same rule the TipTap toolbar uses, so the two editors feel alike.
  const allMarked = meaningful.length > 0 && meaningful.every((l) => active.test(l.trimStart()));

  let n = 0;
  const out = lines.map((line) => {
    if (line.trim() === '') return line;
    const indent = line.match(/^\s*/)![0];
    const bare = line.slice(indent.length).replace(strip, '');
    return allMarked ? indent + bare : indent + prefix(n++) + bare;
  });
  const text = out.join('\n');
  return { from, to, text, selStart: from, selEnd: from + text.length };
}

/**
 * Wrap or unwrap an inline marker.
 *
 * Unwrapping checks both inside the selection (`**bold**` selected whole) and
 * just outside it (`bold` selected, markers adjacent) — an author who
 * double-clicks a bolded word gets the second case, and without it the button
 * would nest markers instead of removing them.
 */
function inlineWrap(sel: Sel, marker: string): Edit {
  const { value, start, end } = sel;
  const selected = value.slice(start, end);
  const len = marker.length;

  if (selected.startsWith(marker) && selected.endsWith(marker) && selected.length >= len * 2) {
    const text = selected.slice(len, -len);
    return { from: start, to: end, text, selStart: start, selEnd: start + text.length };
  }

  const before = value.slice(Math.max(0, start - len), start);
  const after = value.slice(end, end + len);
  if (before === marker && after === marker) {
    return {
      from: start - len,
      to: end + len,
      text: selected,
      selStart: start - len,
      selEnd: start - len + selected.length,
    };
  }

  const text = `${marker}${selected}${marker}`;
  return {
    from: start,
    to: end,
    // An empty selection puts the caret between the markers, ready to type.
    text,
    selStart: start + len,
    selEnd: start + len + selected.length,
  };
}

/** A fenced block, for a multi-line or empty code selection. */
function fence(sel: Sel): Edit {
  const { from, to } = lineBounds(sel.value, sel.start, sel.end);
  const body = sel.value.slice(from, to);
  const text = `\`\`\`\n${body}\n\`\`\``;
  return { from, to, text, selStart: from + 4, selEnd: from + 4 + body.length };
}

export function applyAction(action: MdAction, sel: Sel): Edit {
  switch (action) {
    case 'bold':
      return inlineWrap(sel, '**');
    case 'italic':
      return inlineWrap(sel, '*');
    case 'code': {
      const selected = sel.value.slice(sel.start, sel.end);
      return selected.includes('\n') ? fence(sel) : inlineWrap(sel, '`');
    }
    case 'h2':
      return linePrefix(sel, () => '## ', HEADING, /^##\s+/);
    case 'h3':
      return linePrefix(sel, () => '### ', HEADING, /^###\s+/);
    case 'bullet':
      return linePrefix(sel, () => '- ', LIST, /^[-*+]\s+/);
    case 'ordered':
      return linePrefix(sel, (i) => `${i + 1}. `, LIST, /^\d+\.\s+/);
    case 'quote':
      return linePrefix(sel, () => '> ', /^>\s?/, /^>\s?/);
    case 'indent':
    case 'outdent':
      return shift(sel, action === 'indent');
  }
}

/** Block indent/outdent by one level, used by Tab inside a multi-line selection. */
function shift(sel: Sel, deeper: boolean): Edit {
  const { from, to } = lineBounds(sel.value, sel.start, sel.end);
  const lines = sel.value.slice(from, to).split('\n');
  const out = lines.map((line) => {
    if (deeper) return line.trim() === '' ? line : INDENT + line;
    return line.startsWith(INDENT) ? line.slice(INDENT.length) : line.replace(/^\s{1,2}/, '');
  });
  const text = out.join('\n');
  return { from, to, text, selStart: from, selEnd: from + text.length };
}

/** `[text](href)`, with the selection reused as the label when there is one. */
export function applyLink(sel: Sel, text: string, href: string): Edit {
  const md = `[${text}](${href})`;
  return {
    from: sel.start,
    to: sel.end,
    text: md,
    selStart: sel.start + md.length,
    selEnd: sel.start + md.length,
  };
}

const MARKER = /^(\s*)(?:([-*+])|(\d+)\.)\s+|^(\s*)(>)\s?/;

/**
 * Enter inside a list or quote: continue the marker on the next line.
 *
 * An empty marker is cleared instead of continued — pressing Enter twice is how
 * every editor ends a list, and continuing forever is the behaviour people
 * complain about. Returns `null` when the key should just be typed.
 */
export function continueList(sel: Sel): Edit | null {
  if (sel.start !== sel.end) return null;
  const from = sel.value.lastIndexOf('\n', sel.start - 1) + 1;
  const line = sel.value.slice(from, sel.start);
  const match = MARKER.exec(line);
  if (!match) return null;

  const [marker] = match;
  // Nothing after the marker: the author is ending the list.
  if (line.slice(marker.length).trim() === '') {
    return { from, to: sel.start, text: '', selStart: from, selEnd: from };
  }

  const indent = match[1] ?? match[4] ?? '';
  const next = match[3]
    ? `${indent}${Number(match[3]) + 1}. `
    : match[2]
      ? `${indent}${match[2]} `
      : `${indent}> `;
  const text = `\n${next}`;
  return {
    from: sel.start,
    to: sel.start,
    text,
    selStart: sel.start + text.length,
    selEnd: sel.start + text.length,
  };
}

/** Apply an `Edit` to a string — the pure counterpart of `apply-edit.ts`. */
export function applyEditToString(value: string, edit: Edit): string {
  return value.slice(0, edit.from) + edit.text + value.slice(edit.to);
}
