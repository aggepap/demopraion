import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

/**
 * The admin bar's Edit link only appears where a page tells it which document
 * it shows (`<AdminEditTarget doc={…} />`). Nothing makes a page do that, so a
 * new document page — or a generated one — would silently have no Edit link.
 * This pins it: whatever loads a CMS document to render it must register it.
 */

const ROOT = process.cwd();
const SCAN = ['src/app/[locale]', 'src/components'];

/** The read calls that fetch one document (or a taxonomy term) for display. */
const DOCUMENT_LOADERS = [
  'resolveRenderDoc(',
  'getPublishedDocument(',
  'getProduct(',
  'resolveBookingPricing(',
  'listProductsByCategory(',
  'listProductsByTag(',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

const files = SCAN.flatMap((dir) => walk(join(ROOT, dir))).map((f) => ({
  path: relative(ROOT, f),
  text: readFileSync(f, 'utf8'),
}));

const loadsDocument = files.filter((f) => DOCUMENT_LOADERS.some((call) => f.text.includes(call)));

test('there are document pages to check', () => {
  assert.ok(loadsDocument.length > 0);
});

test('every page or section that renders a CMS document offers it to the admin bar', () => {
  const missing = loadsDocument.filter((f) => !f.text.includes('<AdminEditTarget ')).map((f) => f.path);
  assert.deepEqual(missing, [], `no Edit link registered in: ${missing.join(', ')}`);
});

test('the home hero offers the home page document for editing', () => {
  const hero = files.find((f) => f.path === join('src', 'components', 'site', 'HomeSections.tsx'));
  assert.ok(hero, 'HomeSections.tsx not found');
  assert.match(hero.text, /<AdminEditTarget doc=\{doc\} \/>/);
});
