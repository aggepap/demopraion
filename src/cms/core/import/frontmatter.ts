/**
 * Splitting a `.md` import file into its YAML frontmatter and its body.
 *
 * Pure and dependency-light on purpose: this is the first thing an uploaded file
 * touches, and it runs in `npm test` with no database and no request context.
 *
 * ## Why `yaml` and not a hand-rolled parser
 *
 * The frontmatter carries nested groups, repeaters of objects and lists of
 * strings — `faq.items[].question` is three levels down. A `key: value` splitter
 * covers about a fifth of what the editorial collections need, and the fifth it
 * covers is the part authors get right unaided.
 *
 * `yaml` was already in the tree (the `qa/` bundle uses it) and, unlike
 * `@mdx-js/mdx`'s `estree-walker`, it publishes a CJS entry — so a static import
 * survives the `tsx` CLI that runs the tests and the seed scripts. See the
 * `"//@mdx-js/mdx"` note in `package.json` for the trap this avoids.
 */
import { parseDocument } from 'yaml';

/** A delimiter line: exactly three dashes, trailing whitespace tolerated. */
const DELIMITER = /^---[ \t]*$/;

export class FrontmatterError extends Error {
  /** 1-based line in the source, when the failure has a location. */
  readonly line?: number;

  constructor(message: string, line?: number) {
    super(message);
    this.name = 'FrontmatterError';
    this.line = line;
  }
}

export interface SplitFile {
  /** The raw YAML between the delimiters, or `null` when the file has none. */
  raw: string | null;
  /** Everything after the closing delimiter, leading blank lines trimmed. */
  body: string;
  /** 1-based source line the body starts on, so body errors can be located. */
  bodyLine: number;
}

/**
 * Normalise line endings and drop a UTF-8 BOM.
 *
 * Both matter in practice rather than in theory: Windows editors write CRLF, and
 * a BOM in front of the opening `---` makes the first line `﻿---`, which no
 * longer matches the delimiter — the whole file then reads as a body with no
 * frontmatter and every field silently goes missing.
 */
export function normalizeSource(source: string): string {
  return source.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

/**
 * Separate the frontmatter block from the body.
 *
 * Only a delimiter on the very first line opens a block. A `---` further down is
 * a markdown horizontal rule or a YAML document separator inside the body, and
 * treating it as an opener would swallow prose into the metadata.
 */
export function splitFrontmatter(source: string): SplitFile {
  const lines = normalizeSource(source).split('\n');

  if (lines.length === 0 || !DELIMITER.test(lines[0])) {
    return { raw: null, body: normalizeSource(source), bodyLine: 1 };
  }

  const closing = lines.findIndex((line, index) => index > 0 && DELIMITER.test(line));
  if (closing === -1) {
    throw new FrontmatterError(
      'The frontmatter block is never closed — add a line containing only `---` after the last setting.',
      1,
    );
  }

  const raw = lines.slice(1, closing).join('\n');

  // Skip the blank lines an author naturally leaves after the closing `---`, so
  // a stored body never starts with dead space.
  let start = closing + 1;
  while (start < lines.length && lines[start].trim() === '') start += 1;

  return { raw, body: lines.slice(start).join('\n'), bodyLine: start + 1 };
}

/**
 * Parse the YAML block into a plain object.
 *
 * Anchors and aliases are refused outright (`toJS({ maxAliasCount: 0 })`, which
 * is where they are expanded and therefore where the limit bites). They have no
 * place in a hand-written content file, and they are the mechanism behind the
 * "billion laughs" expansion — a few lines that inflate into gigabytes while the
 * request is still being parsed.
 *
 * The 1.2 core schema is deliberate too: under 1.1, `2026-08-24` parses to a
 * `Date` and `no` parses to `false`, so a date field's value would arrive as a
 * different type depending on how it was quoted. Everything stays a string here
 * and `coerce.ts` does the converting, in one place, with a message when it
 * cannot.
 */
export function parseFrontmatterBlock(raw: string): Record<string, unknown> {
  /*
   * `parseDocument` + an explicit error check, NOT `parse()`.
   *
   * The parser recovers from malformed input instead of refusing it, and the
   * recoveries are the dangerous kind — silent and plausible. A block indented
   * with tabs (`a:\n\tb: 1`) recovers to `{ a: null, b: 1 }`: the nesting is
   * gone, `a` is empty, and `b` has been promoted to a top-level key that the
   * collection does not have. An unterminated quote swallows the rest of the
   * line. Both would import as a document quietly missing half its content.
   *
   * Every recovery is recorded on `doc.errors`, so reading that list is what
   * turns "it parsed" into "it is what the author wrote".
   */
  let doc: ReturnType<typeof parseDocument>;
  try {
    doc = parseDocument(raw, { version: '1.2', logLevel: 'silent' });
  } catch (err) {
    throw new FrontmatterError(
      `The settings block is not valid YAML: ${err instanceof Error ? err.message : String(err)}`,
      1,
    );
  }

  const failure = doc.errors[0];
  if (failure) {
    // +1 for the opening delimiter the parser never saw, so the number points at
    // the line the author is actually looking at.
    const line = failure.linePos?.[0]?.line;
    throw new FrontmatterError(
      `The settings block is not valid YAML: ${failure.message}`,
      typeof line === 'number' ? line + 1 : undefined,
    );
  }

  /*
   * The alias limit is enforced HERE, not during compose — `toJS` is what
   * expands an alias, so it is what throws (a `ReferenceError`) when one is
   * found. Catching it is the difference between a clear refusal and a 500.
   */
  let parsed: unknown;
  try {
    parsed = doc.toJS({ maxAliasCount: 0 });
  } catch (err) {
    throw new FrontmatterError(
      `The settings block uses YAML anchors or aliases, which are not allowed here: ${err instanceof Error ? err.message : String(err)}`,
      1,
    );
  }

  // An empty block is legitimate — the file is then body-only, and the caller
  // decides whether that is enough.
  if (parsed === null || parsed === undefined) return {};

  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new FrontmatterError(
      'The settings block must be a list of `key: value` settings, not a single value or a list.',
      1,
    );
  }

  return parsed as Record<string, unknown>;
}
