/**
 * Reject MDX that would *execute* rather than render.
 *
 * ## Why this exists
 *
 * An MDX body is not markup, it is a module. `@mdx-js/mdx`'s `evaluate()`
 * compiles the stored string and runs it in the Node process that serves the
 * request, so every `{…}` expression in a document body is server-side
 * JavaScript with the ambient scope of the server. Verified against this
 * project's own dependencies before this guard existed:
 *
 *   - `{process.env.AUTH_SECRET}`  rendered the signing secret into the page
 *   - `<script>alert(1)</script>`  reached the browser verbatim (and
 *     `next.config.ts` sets `script-src 'unsafe-inline'` for inline JSON-LD, so
 *     CSP does not stop it)
 *   - `{(() => { globalThis.x = 1 })()}`  ran, and the mutation persisted
 *
 * Two principals can write a body: anyone holding `cms.content.write` (the
 * seeded `editor` role does), and the PM bridge — `modules/pm/write.ts` maps
 * PM's `description` key onto whatever `pmFieldMap` says, which is `bodyMdx` for
 * every editorial collection. `docs/PM_BRIDGE_SPEC.md` §13 designs that token as
 * content-only and explicitly withholds publishing; reaching `process.env` was
 * never part of the deal.
 *
 * ## The rule: data, not code
 *
 * Rejecting every expression was the first instinct and it is wrong — published
 * content already relies on literal attributes, e.g.
 * `<ComparisonTable headers={['Parameter', 'SEO', 'AEO']}>`. So an expression is
 * accepted when its whole ESTree is *data*: literals, arrays, objects of
 * literals, a signed number, an untagged template with no interpolation. The
 * moment an identifier, member access or call appears it is code, and code is
 * refused. A comment-only expression — an MDX comment, which parses to zero
 * statements — stays allowed: it is idiomatic and evaluates to nothing.
 *
 * Elements are allow-listed by name, and the list holds **only the site's own
 * components** — no raw HTML element names at all. Markdown syntax already
 * covers paragraphs, links and emphasis, and an element allow-list is exactly
 * where `<script>`, `<iframe>` and `on*` handlers creep back in later.
 *
 * ## Pure on purpose
 *
 * No imports, so it runs in the same shape at both ends: as a remark plugin
 * inside the `evaluate()` that would otherwise execute the code (protecting rows
 * already in the database), and against a parsed tree on the write path so an
 * editor is told at save time. Fenced code blocks are `code` nodes, never
 * expressions, so documenting a JSON-LD snippet in an article stays fine.
 */

/** Minimal shape of the mdast nodes this walks. Local rather than imported so
 *  the module keeps zero dependencies and stays trivially unit-testable. */
interface MdastNode {
  type: string;
  name?: string | null;
  value?: unknown;
  children?: MdastNode[];
  attributes?: MdastNode[];
  data?: { estree?: EstreeProgram | null };
}

interface EstreeNode {
  type: string;
  [key: string]: unknown;
}

interface EstreeProgram {
  type: string;
  body?: EstreeNode[];
}

/**
 * Is this ESTree node pure data?
 *
 * Deliberately an allow-list: an unknown node type is refused, so a new syntax
 * in a future parser version fails closed rather than slipping through.
 *
 * `allowed` is threaded through because inert JSX counts as data — published
 * scenarios pass a fragment as a ReactNode prop, e.g.
 * `<Outcomes intro={<>…text…</>}>` — but only while every element inside it is
 * still an allow-listed component. Without that check the attribute position
 * would be a hole straight back to `title={<script>…</script>}`.
 */
function isDataOnly(node: unknown, allowed: ReadonlySet<string>): boolean {
  if (node === null || node === undefined) return true; // array hole: `[1, , 2]`
  if (typeof node !== 'object') return false;
  const n = node as EstreeNode;

  const every = (list: unknown): boolean =>
    (list as unknown[] | undefined ?? []).every((item) => isDataOnly(item, allowed));

  switch (n.type) {
    case 'Literal':
      // A regex literal is data, but it is also a program the engine compiles
      // and a known denial-of-service surface. Nothing legitimate needs one in
      // a document body.
      return !('regex' in n) && !('bigint' in n);
    case 'ArrayExpression':
      return every(n.elements);
    case 'ObjectExpression':
      return every(n.properties);
    case 'Property': {
      // `{ [x]: 1 }` computes its key, which is evaluation. A plain identifier
      // key is not evaluated, so `{ a: 1 }` and `{ 'a': 1 }` are both data.
      if (n.computed === true) return false;
      const key = n.key as EstreeNode | undefined;
      const keyOk = key?.type === 'Identifier' || (key?.type === 'Literal' && !('regex' in key));
      return keyOk && isDataOnly(n.value, allowed);
    }
    case 'UnaryExpression':
      // Only so `{-1}` and `{+1}` read as numbers. `!`, `typeof`, `void` and
      // `delete` all observe or alter state.
      return (
        (n.operator === '-' || n.operator === '+') && isDataOnly(n.argument, allowed)
      );
    case 'TemplateLiteral':
      // Interpolation is evaluation; a template with none is just a string.
      return (n.expressions as unknown[] | undefined ?? []).length === 0;

    // ── Inert JSX ──────────────────────────────────────────────────────────
    // Markup passed as a prop value. Everything reachable from here is checked
    // the same way, so nothing gains a capability by being nested.
    case 'JSXText':
      return true;
    case 'JSXEmptyExpression':
      // The inside of a JSX comment.
      return true;
    case 'JSXExpressionContainer':
      return isDataOnly(n.expression, allowed);
    case 'JSXFragment':
      return every(n.children);
    case 'JSXElement': {
      const opening = n.openingElement as EstreeNode | undefined;
      const name = opening?.name as EstreeNode | undefined;
      // A plain `JSXIdentifier` is the only shape that can match the list;
      // `JSXMemberExpression` (`<Foo.Bar/>`) and namespaced names cannot, and
      // fall through to a refusal.
      if (name?.type !== 'JSXIdentifier' || !allowed.has(String(name.name))) return false;
      return every(opening?.attributes) && every(n.children);
    }
    case 'JSXAttribute':
      // A spread is `JSXSpreadAttribute`, which is not listed — so it is refused.
      return n.value === null || isDataOnly(n.value, allowed);

    default:
      return false;
  }
}

/** An expression node's ESTree is data-only (or it has no statements at all,
 *  which is the MDX-comment case). */
function expressionIsDataOnly(node: MdastNode, allowed: ReadonlySet<string>): boolean {
  const program = node.data?.estree;
  // No estree at all means the parser was configured without acorn, so nothing
  // here can be judged. Refuse rather than assume: this function is the only
  // thing standing between a document body and the server's scope.
  if (!program) return typeof node.value === 'string' && node.value.trim() === '';

  const body = program.body ?? [];
  if (body.length === 0) return true;
  if (body.length > 1) return false;
  const statement = body[0];
  if (statement.type !== 'ExpressionStatement') return false;
  return isDataOnly(statement.expression, allowed);
}

/** A short, quotable excerpt for the error message — enough to find the line,
 *  not enough to paste an exfiltration payload into a log aggregator. */
function excerpt(node: MdastNode): string {
  const raw = typeof node.value === 'string' ? node.value : '';
  const flat = raw.replace(/\s+/g, ' ').trim();
  return flat.length > 60 ? `${flat.slice(0, 60)}…` : flat;
}

/**
 * Every reason `tree` is unsafe, in document order. Empty means it is clean.
 *
 * Returns all of them rather than throwing on the first: an editor fixing a
 * pasted body should see the whole list, not play whack-a-mole through six
 * saves.
 */
export function findMdxViolations(tree: unknown, allowed: readonly string[]): string[] {
  const allowSet = new Set(allowed);
  const out: string[] = [];

  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return;
    const n = node as MdastNode;

    switch (n.type) {
      case 'mdxjsEsm':
        out.push(
          '`import`/`export` is not allowed in a body — it loads and runs code on the server.',
        );
        break;

      case 'mdxFlowExpression':
      case 'mdxTextExpression':
        if (!expressionIsDataOnly(n, allowSet)) {
          const shown = excerpt(n);
          out.push(
            `Expression \`{${shown}}\` is not allowed — a body may only contain literal values, not code that runs on the server.`,
          );
        }
        break;

      case 'mdxJsxFlowElement':
      case 'mdxJsxTextElement': {
        // `name: null` is a fragment (`<>…</>`) — no capability of its own, and
        // its children are walked like anything else.
        if (typeof n.name === 'string' && !allowSet.has(n.name)) {
          out.push(
            `<${n.name}> is not an allowed component. Use markdown, or one of: ${[...allowSet].sort().join(', ')}.`,
          );
        }
        for (const attr of n.attributes ?? []) {
          if (attr.type === 'mdxJsxExpressionAttribute') {
            // `<Foo {...bar} />` — a spread is a read of something in scope.
            out.push(`A spread attribute on <${n.name ?? 'fragment'}> is not allowed.`);
            continue;
          }
          const value = attr.value;
          if (
            value !== null &&
            typeof value === 'object' &&
            (value as MdastNode).type === 'mdxJsxAttributeValueExpression' &&
            !expressionIsDataOnly(value as MdastNode, allowSet)
          ) {
            out.push(
              `Attribute \`${attr.name ?? '?'}\` on <${n.name ?? 'fragment'}> must be a literal value, not code.`,
            );
          }
        }
        break;
      }
    }

    for (const child of n.children ?? []) walk(child);
    for (const attr of n.attributes ?? []) {
      // Children of an attribute expression are already judged above; this
      // reaches JSX nested inside one (`<Foo bar={<Baz />} />`).
      const value = (attr as MdastNode).value;
      if (value !== null && typeof value === 'object') walk(value);
    }
  };

  walk(tree);
  return out;
}

/**
 * The same check as a remark plugin, for the compile that would otherwise run
 * the code. Throws, which `evaluate()` surfaces as a rejected promise.
 */
export function mdxGuardPlugin(allowed: readonly string[]) {
  return function guard() {
    return function transform(tree: unknown): void {
      const violations = findMdxViolations(tree, allowed);
      if (violations.length > 0) {
        throw new Error(`Unsafe MDX refused: ${violations.join(' ')}`);
      }
    };
  };
}
