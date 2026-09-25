/**
 * Every unmatched in-locale URL reaches the 404 monitor.
 *
 * Only `[slug]` and `shop/[slug]` logged. Anything deeper — `/old/section/page`,
 * a mistyped `/en/blog/x` on a site with no blog — fell to the `[...rest]`
 * catch-all, which redirected to /page-not-found without a word, so the admin's
 * 404 list never showed the broken links most worth a redirect.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

describe('[...rest] catch-all', () => {
  const src = readFileSync('src/app/[locale]/[...rest]/page.tsx', 'utf8');

  test('logs the path before redirecting to the not-found page, like [slug]', () => {
    assert.match(src, /await log404\(`\/\$\{rest\.join\('\/'\)\}`, locale\)[\s\S]*redirect\(pageNotFoundPath\(locale\)\)/);
  });
});
