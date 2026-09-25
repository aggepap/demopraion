import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

/**
 * A JSON-LD defect that validators report as "0 errors": a `FAQPage` emitted as
 * its own `<script>` without `@context`. Parsers resolve `"@type":"FAQPage"` as a
 * relative IRI against the page URL (`https://example.com/faq/FAQPage`), so the
 * FAQ is not recognised as schema.org at all.
 *
 * It is not observable without rendering the route against a DB, so this guard
 * reads the sources.
 */

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.tsx') || path.endsWith('.ts') ? [path] : [];
  });
}

const SOURCES = [...sourceFiles('src/app'), ...sourceFiles('src/components')].map((path) => ({
  path,
  src: readFileSync(path, 'utf8'),
}));

describe('JSON-LD page guards', () => {
  test('no FAQPage is emitted as a standalone block without @context', () => {
    const offenders = SOURCES.filter(({ src }) => /jsonLd\(\s*faqSchema\(/.test(src)).map(({ path }) => path);
    assert.deepEqual(offenders, [], 'wrap faqSchema in graphSchema or add it to the page @graph');
  });

  test('no ItemList is emitted as a standalone block without @context', () => {
    // `itemListSchema` returns a bare node, like `faqSchema` — same defect.
    const offenders = SOURCES.filter(({ src }) => /jsonLd\(\s*itemListSchema\(/.test(src)).map(({ path }) => path);
    assert.deepEqual(offenders, [], "spread it into an object with '@context', or wrap it in graphSchema");
  });
});
