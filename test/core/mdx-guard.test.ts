/**
 * The MDX guard is the only thing between a document body and the server's
 * scope: `evaluate()` compiles and runs a body in-process, so before this
 * existed `{process.env.AUTH_SECRET}` in an article rendered the signing secret
 * into the page, and `<script>` reached the browser (CSP allows inline script
 * for the site's JSON-LD, so it does not help).
 *
 * The suite is deliberately two-sided. Blocking code is half the job; the other
 * half is not breaking the bodies editors write, which use literal attributes
 * (`headers={['a','b']}`) and inert JSX props (`intro={<>…</>}`) — an
 * over-strict guard would silently blank live pages (the render path returns
 * null on a refusal).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { findMdxFieldErrors, validateMdxSource } from '@/cms/core/fields/mdx-validate';
import { mdxGuardPlugin } from '@/cms/core/fields/mdx-guard';
import { f } from '@/cms/config';
/**
 * A fixed allow-list, independent of the site's own (`src/lib/cms/mdx-allowlist.ts`):
 * the guard is under test here, not any one site's component palette.
 */
const ALLOWED = ['Pillars', 'Pillar', 'ComparisonTable', 'Outcomes', 'Outcome'];

/** Assert `source` is refused, and say what the guard actually thought if not. */
async function assertRefused(source: string, because: string): Promise<void> {
  const violations = await validateMdxSource(source, ALLOWED);
  assert.ok(violations.length > 0, `expected to refuse ${because}, but it passed: ${source}`);
}

async function assertAccepted(source: string, because: string): Promise<void> {
  const violations = await validateMdxSource(source, ALLOWED);
  assert.deepEqual(violations, [], `expected to accept ${because}, got: ${violations.join(' ')}`);
}

describe('mdx guard — refuses anything that executes', () => {
  test('expressions that read server state', async () => {
    await assertRefused('Value: {process.env.AUTH_SECRET}', 'an env read');
    await assertRefused('{globalThis.process.env.X}', 'a member chain');
    await assertRefused('{require("node:fs")}', 'a require call');
    await assertRefused('{import("node:fs")}', 'a dynamic import');
    await assertRefused('{`${process.env.X}`}', 'template interpolation');
    await assertRefused('{({ [process.env.X]: 1 })}', 'a computed object key');
    await assertRefused(
      '{(() => { globalThis.x = 1; return "y" })()}',
      'an IIFE with a side effect',
    );
  });

  test('module-level import/export', async () => {
    await assertRefused('import fs from "node:fs"\n\ntext', 'an import');
    await assertRefused('export const x = 1\n\ntext', 'an export');
  });

  test('raw HTML elements, including the ones that carry script', async () => {
    await assertRefused('<script>alert(1)</script>', '<script>');
    await assertRefused('<iframe src="http://evil" />', '<iframe>');
    await assertRefused('<img src="x" onError="alert(1)" />', 'an inline event handler');
    // Markdown covers these, so allowing them buys nothing and costs the
    // allow-list its one clear rule.
    await assertRefused('<a href="/x">link</a>', 'a raw anchor');
  });

  test('components that are not on the list', async () => {
    await assertRefused('<Evil />', 'an unknown component');
    await assertRefused('<Foo.Bar />', 'a member-expression component name');
  });

  test('attribute positions are not a back door', async () => {
    await assertRefused('<Pillar {...process.env} />', 'a spread attribute');
    await assertRefused('<Pillar title={process.env.AUTH_SECRET} />', 'code in an attribute');
    await assertRefused('<Pillar title={<script>x</script>} />', 'a script nested in an attribute');
  });

  test('inert JSX in an attribute is still checked all the way down', async () => {
    // `intro={<>…</>}` is legitimate (see below), which makes the fragment a
    // place someone would try to hide things.
    await assertRefused(
      '<Outcomes intro={<><script>alert(1)</script></>}>x</Outcomes>',
      'a script inside a fragment prop',
    );
    await assertRefused(
      '<Outcomes intro={<>{process.env.X}</>}>x</Outcomes>',
      'an expression inside a fragment prop',
    );
    await assertRefused(
      '<Outcomes intro={<><Pillar title={process.env.X} /></>}>x</Outcomes>',
      'code in an attribute inside a fragment prop',
    );
    await assertRefused(
      '<Outcomes intro={<><Pillar {...process.env} /></>}>x</Outcomes>',
      'a spread inside a fragment prop',
    );
  });

  test('an unrecognised node type fails closed', async () => {
    // Not reachable through MDX syntax today — the point is that the ESTree
    // walk is an allow-list, so a node a future parser adds is refused rather
    // than waved through.
    await assertRefused('{1 + 1}', 'arithmetic (a BinaryExpression)');
    await assertRefused('{[1].length}', 'a property read');
    await assertRefused('{/re/}', 'a regex literal');
  });
});

describe('mdx guard — accepts what editors actually write', () => {
  test('plain markdown', async () => {
    await assertAccepted(
      '## Heading\n\nSome **bold** text, a [link](https://example.com) and `code`.',
      'ordinary markdown',
    );
  });

  test('allow-listed components', async () => {
    await assertAccepted(
      '<Pillars>\n  <Pillar title="One">body</Pillar>\n</Pillars>',
      'nested allow-listed components',
    );
  });

  test('literal attribute values', async () => {
    await assertAccepted(
      "<ComparisonTable headers={['Parameter', 'SEO', 'AEO']} rows={[['a','b','c']]} />",
      'literal arrays',
    );
    await assertAccepted('<Pillar order={-1} title="a">b</Pillar>', 'a negative number');
    await assertAccepted('<Pillar meta={{ a: 1, b: "two" }} title="a">b</Pillar>', 'a literal object');
    await assertAccepted('{`hello`}', 'a template with no interpolation');
  });

  test('inert JSX as a prop', async () => {
    await assertAccepted(
      '<Outcomes intro={<>Indicative outcomes, not guarantees.</>}><Outcome heading="h">b</Outcome></Outcomes>',
      'a fragment prop',
    );
    await assertAccepted(
      '<Outcomes intro={<>see <Pillar title="a">b</Pillar></>}>x</Outcomes>',
      'an allow-listed component inside a fragment prop',
    );
  });

  test('an MDX comment', async () => {
    await assertAccepted('{/* editor note */}\n\ntext', 'a comment-only expression');
  });

  test('a fenced code block is content, not code', async () => {
    // Articles document JSON-LD snippets. These are `code` nodes, never
    // expressions, and must not be mistaken for one.
    await assertAccepted(
      '```json\n{ "@type": "Hotel", "starRating": { "ratingValue": "4" } }\n```',
      'a fenced JSON block containing braces',
    );
    await assertAccepted('```js\nconst x = process.env.SECRET\n```', 'fenced JS as documentation');
  });

  test('an empty body', async () => {
    await assertAccepted('', 'an empty string');
    await assertAccepted('   \n  ', 'whitespace only');
  });
});

describe('mdx field walk', () => {
  const bodyField = f.mdx('bodyMdx', { allowedComponents: ALLOWED });

  test('reports the offending field by path', async () => {
    const errors = await findMdxFieldErrors([bodyField], {
      bodyMdx: 'Value: {process.env.AUTH_SECRET}',
    });
    assert.deepEqual(Object.keys(errors), ['bodyMdx']);
    assert.match(errors.bodyMdx[0], /not allowed/);
  });

  test('clean data yields no errors', async () => {
    const errors = await findMdxFieldErrors([bodyField], { bodyMdx: '## Fine\n\nText.' });
    assert.deepEqual(errors, {});
  });

  test('a code field with no allow-list is left alone', async () => {
    // `f.code` is also used for raw JSON-LD overrides, which are not MDX and
    // must not be run through an MDX parser.
    const errors = await findMdxFieldErrors([f.code('raw', { language: 'json' })], {
      raw: '{ "a": 1 }',
    });
    assert.deepEqual(errors, {});
  });

  test('finds a body nested in a group', async () => {
    const errors = await findMdxFieldErrors([f.group('section', [bodyField])], {
      section: { bodyMdx: '{process.env.X}' },
    });
    assert.deepEqual(Object.keys(errors), ['section.bodyMdx']);
  });

  test('finds a body nested in a repeater, with its row index', async () => {
    const errors = await findMdxFieldErrors([f.repeater('blocks', [bodyField])], {
      blocks: [{ bodyMdx: '## ok' }, { bodyMdx: '<script>x</script>' }],
    });
    assert.deepEqual(Object.keys(errors), ['blocks.1.bodyMdx']);
  });

  /*
   * The walk used to key on `language === 'mdx' && field.allowedComponents`, so a
   * body declared without the option was not "allowed everything" — it was never
   * looked at. An `f.mdx()` field whose allow-list the author forgot therefore
   * skipped the one check that stands between a stored body and `evaluate()`
   * running it in the server's scope. Absent means "no components", not "no check".
   */
  test('an mdx field with NO allow-list is checked, not skipped', async () => {
    const noList = f.mdx('bodyMdx');
    const errors = await findMdxFieldErrors([noList], {
      bodyMdx: 'Value: {process.env.AUTH_SECRET}',
    });
    assert.deepEqual(Object.keys(errors), ['bodyMdx'], 'the unguarded body must still be refused');
  });

  test('an mdx field with no allow-list still permits plain prose', async () => {
    const noList = f.mdx('bodyMdx');
    const errors = await findMdxFieldErrors([noList], { bodyMdx: '## Heading\n\nJust words.' });
    assert.deepEqual(errors, {});
  });

  test('an mdx field with no allow-list refuses every component', async () => {
    const noList = f.mdx('bodyMdx');
    const errors = await findMdxFieldErrors([noList], { bodyMdx: '<Callout>hi</Callout>' });
    assert.deepEqual(Object.keys(errors), ['bodyMdx']);
  });

  test('checks every locale of a localized body', async () => {
    const localized = f.mdx('bodyMdx', { allowedComponents: ALLOWED, localized: true });
    const errors = await findMdxFieldErrors([localized], {
      bodyMdx: { el: '## καλό', en: '{process.env.X}' },
    });
    assert.deepEqual(Object.keys(errors), ['bodyMdx']);
  });
});

describe('mdxGuardPlugin', () => {
  test('throws on an unsafe tree, so `evaluate` rejects before running it', () => {
    const transform = mdxGuardPlugin(ALLOWED)();
    const unsafe = { type: 'root', children: [{ type: 'mdxjsEsm', value: 'import x from "y"' }] };
    assert.throws(() => transform(unsafe), /Unsafe MDX refused/);
  });

  test('passes a clean tree through', () => {
    const transform = mdxGuardPlugin(ALLOWED)();
    const clean = { type: 'root', children: [{ type: 'paragraph', children: [] }] };
    assert.doesNotThrow(() => transform(clean));
  });
});
