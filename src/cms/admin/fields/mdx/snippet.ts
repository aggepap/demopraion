/**
 * Build an MDX snippet for a palette component.
 *
 * Everything here is generated to be **accepted by `mdx-guard.ts` by
 * construction**, because a snippet the guard refuses is worse than no palette
 * at all: `MdxRuntime` answers a refusal with an empty body, so the failure
 * shows up as a live page that quietly lost its content. Concretely that means
 * attribute values are only ever string literals, numbers, or literal arrays of
 * strings — the shapes `isDataOnly` allows. Never a spread, never an
 * identifier, never a template with interpolation.
 *
 * `test/cms/mdx-snippet.test.ts` pins the formatting, and
 * `test/components/mdx-palette.test.tsx` parses every generated snippet with
 * the real MDX processor and runs the real guard over it — that round trip is
 * what makes "guaranteed valid" a fact rather than an intention.
 *
 * Pure: no React, no DOM. The editor applies the returned text; this module
 * only computes it.
 */
import type { MdxChildrenSpec, MdxComponentSpec, MdxPropSpec } from '../../../config';

/** One prop's collected value, in the shape its `type` implies. */
export type PropValue = string | string[] | string[][];

export interface RepeatItemValues {
  props: Record<string, PropValue>;
  body: string;
}

export interface SnippetValues {
  props: Record<string, PropValue>;
  /** The direct body slot, for a spec with `children`. */
  body?: string;
  /** One entry per generated child, for a spec with `repeat`. */
  items?: RepeatItemValues[];
}

export interface Snippet {
  text: string;
  /**
   * Offset within `text` where the caret should land — the first empty body
   * slot, so the author starts typing where the words go rather than hunting
   * for the hole in a scaffold they did not write.
   */
  caret: number;
}

const INDENT = '  ';

/** `01`, `02`, … or `1`, `2`, … */
export function autoNumberValue(index: number, format: 'padded' | 'plain'): string {
  const n = index + 1;
  return format === 'padded' ? String(n).padStart(2, '0') : String(n);
}

/**
 * A string as a JSX attribute value.
 *
 * A plain quoted literal wherever possible, because that is what hand-written
 * bodies look like and what an author will copy next time. A value carrying a
 * `"`, a newline or a brace falls back to `{'…'}` — still a bare `Literal` in
 * the ESTree the guard walks, so still data.
 */
export function attrValue(raw: string): string {
  if (!/["\n\r{}]/.test(raw)) return `"${raw}"`;
  return `{${quoted(raw)}}`;
}

/** The always-quoted form, for use inside a `{…}` expression. */
export function quoted(raw: string): string {
  const escaped = raw
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '')
    .replace(/\n/g, '\\n');
  return `'${escaped}'`;
}

function isFilled(value: PropValue | undefined): boolean {
  if (value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return value.length > 0;
}

const asList = (value: PropValue): string[] => (Array.isArray(value) ? (value as string[]) : []);
const asGrid = (value: PropValue): string[][] =>
  Array.isArray(value) ? (value as string[][]).filter(Array.isArray) : [];

/**
 * One attribute, or `null` when it should be omitted.
 *
 * An optional prop left blank produces no attribute at all rather than
 * `eyebrow=""` — the empty string is a value, and components like `QuickAnswer`
 * treat "absent" and "empty" differently.
 */
export function attr(spec: MdxPropSpec, value: PropValue | undefined, indent: string): string | null {
  if (spec.type === 'boolean') return value === 'true' ? spec.name : null;
  if (!isFilled(value)) return null;

  switch (spec.type) {
    case 'number': {
      const n = Number(value);
      return Number.isFinite(n) ? `${spec.name}={${n}}` : null;
    }
    case 'stringList':
      return `${spec.name}={[${asList(value!).map(quoted).join(', ')}]}`;
    case 'stringGrid': {
      const rows = asGrid(value!);
      if (rows.length === 0) return null;
      // Trailing comma on the last row, matching the hand-written tables in
      // `src/content/answers/` — it keeps a one-row diff to one line when an
      // editor appends.
      const body = rows.map((row) => `${indent}${INDENT}[${row.map(quoted).join(', ')}],`).join('\n');
      return `${spec.name}={[\n${body}\n${indent}]}`;
    }
    default:
      return `${spec.name}=${attrValue(String(value))}`;
  }
}

/**
 * The attribute run for a tag.
 *
 * Attributes stay on the opening-tag line while they comfortably fit. The
 * moment one of them is itself multi-line (a `stringGrid`) or the line grows
 * long, every attribute moves onto its own indented line and the tag closes on
 * a line of its own — which is the shape the published
 * `<ComparisonTable headers={…} rows={…} />` bodies in `src/content/` use, and
 * the only readable option once a table has three columns.
 */
const WRAP_AT = 72;

function attrs(
  specs: readonly MdxPropSpec[] | undefined,
  values: Record<string, PropValue>,
  indent: string,
): { text: string; broken: boolean } {
  const inner = indent + INDENT;
  const parts = (specs ?? [])
    .map((spec) => attr(spec, values[spec.name], inner))
    .filter((part): part is string => part !== null);

  if (parts.length === 0) return { text: '', broken: false };

  const oneLine = ` ${parts.join(' ')}`;
  const mustBreak = parts.some((p) => p.includes('\n')) || oneLine.length > WRAP_AT;
  if (!mustBreak) return { text: oneLine, broken: false };

  return { text: `\n${parts.map((p) => inner + p).join('\n')}\n${indent}`, broken: true };
}

/**
 * Indent a markdown body to sit inside a tag at depth `depth`.
 *
 * Depth 0 keeps its body at column 0 — that is what every published body does
 * (`<QuickAnswer>`, `<CurrentState>`), and it keeps long prose from drifting
 * right. A nested item's body is indented one level past its tag, matching the
 * `<Painpoint>` bodies in `src/content/`.
 */
function indentBody(body: string, indent: string): string {
  if (indent === '') return body;
  return body
    .split('\n')
    .map((line) => (line.trim() === '' ? '' : indent + line))
    .join('\n');
}

interface Piece {
  text: string;
  /** Offset of an empty body slot within `text`, if this piece has one. */
  hole: number | null;
}

function element(
  tag: string,
  attrText: string,
  broken: boolean,
  childrenSpec: MdxChildrenSpec | undefined,
  body: string,
  depth: number,
): Piece {
  const indent = INDENT.repeat(depth);
  const bodyIndent = depth === 0 ? '' : INDENT.repeat(depth + 1);

  if (!childrenSpec) {
    // A broken attribute run already ends at the tag's own indentation, so the
    // slash closes flush; an inline one needs the conventional space.
    return { text: `${indent}<${tag}${attrText}${broken ? '/>' : ' />'}`, hole: null };
  }

  const open = `${indent}<${tag}${attrText}>`;
  const filled = body.trim() !== '';
  const inner = filled ? indentBody(body.trim(), bodyIndent) : bodyIndent;
  const text = `${open}\n${inner}\n${indent}</${tag}>`;
  return { text, hole: filled ? null : open.length + 1 + inner.length };
}

/**
 * The snippet for one palette component.
 *
 * The block is always framed by a blank line on each side and starts at column
 * 0. That framing is not cosmetic: a JSX *flow* element must own its line, or
 * MDX parses it as inline text inside the neighbouring paragraph — the single
 * most common way a hand-written body silently stops rendering.
 */
export function buildSnippet(spec: MdxComponentSpec, values: SnippetValues): Snippet {
  const own = attrs(spec.props, values.props ?? {}, '');

  if (spec.repeat) {
    const repeat = spec.repeat;
    const items = values.items ?? [];
    const lines: string[] = [];
    let caret: number | null = null;
    let offset = `<${spec.name}${own.text}>`.length + 1;

    for (const [index, item] of items.entries()) {
      const props = { ...item.props };
      if (repeat.autoNumber && !isFilled(props[repeat.autoNumber.prop])) {
        props[repeat.autoNumber.prop] = autoNumberValue(index, repeat.autoNumber.format);
      }
      const childAttrs = attrs(repeat.props, props, INDENT);
      const piece = element(
        repeat.child,
        childAttrs.text,
        childAttrs.broken,
        repeat.children,
        item.body ?? '',
        1,
      );
      if (caret === null && piece.hole !== null) caret = offset + piece.hole;
      lines.push(piece.text);
      offset += piece.text.length + 1;
    }

    const open = `<${spec.name}${own.text}>`;
    const text = `${open}\n${lines.join('\n')}\n</${spec.name}>`;
    return { text, caret: caret ?? text.length };
  }

  const piece = element(spec.name, own.text, own.broken, spec.children, values.body ?? '', 0);
  return { text: piece.text, caret: piece.hole ?? piece.text.length };
}

/**
 * Is a required prop still blank? The insert dialog's gate, kept here beside
 * the generator that has to agree with it.
 *
 * It walks `repeat.props` as well as the spec's own, because that is where the
 * required props of the components that need them most actually live —
 * `<FAQItem question>`, `<Pillar heading>`. A gate that checked only the outer
 * props let an empty one through, and `attr` then *correctly* omitted the
 * attribute rather than writing `question=""`, so the author got a bare
 * `<FAQItem>`. Nothing downstream objects: `findMdxViolations` judges tags and
 * attribute shapes, never presence, so it stores, and `<FAQ>` renders an
 * accordion card whose toggle button has no label.
 *
 * An auto-numbered prop is exempt. It is required and permanently blank in the
 * dialog's state — the control only *displays* `autoNumberValue`, and
 * `buildSnippet` above is what actually fills it — so counting it would leave
 * Insert disabled forever on every numbered component.
 */
export function missingRequired(spec: MdxComponentSpec, values: SnippetValues): boolean {
  if ((spec.props ?? []).some((p) => p.required && !isFilled(values.props?.[p.name]))) {
    return true;
  }

  const repeat = spec.repeat;
  if (!repeat) return false;

  const required = (repeat.props ?? []).filter(
    (p) => p.required && p.name !== repeat.autoNumber?.prop,
  );
  return (values.items ?? []).some((item) =>
    required.some((p) => !isFilled(item.props?.[p.name])),
  );
}

/** Sensible empty values for a spec — the dialog's initial state, and the
 *  fixture the round-trip test generates from. */
export function emptyValues(spec: MdxComponentSpec): SnippetValues {
  const seed = (specs: readonly MdxPropSpec[] | undefined): Record<string, PropValue> => {
    const out: Record<string, PropValue> = {};
    for (const p of specs ?? []) {
      out[p.name] =
        p.default ?? (p.type === 'stringList' ? [] : p.type === 'stringGrid' ? [] : '');
    }
    return out;
  };
  const values: SnippetValues = { props: seed(spec.props) };
  if (spec.children) values.body = '';
  if (spec.repeat) {
    values.items = Array.from({ length: spec.repeat.initial }, () => ({
      props: seed(spec.repeat!.props),
      body: '',
    }));
  }
  return values;
}
