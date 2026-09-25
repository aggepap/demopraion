import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

/**
 * Every storefront page checks its module flag and 404s when it is off.
 *
 * Both storefronts ship in every site and a module is switched on or off in the
 * admin, so a page that forgot its gate would be live on a site that never sold
 * anything. Rendering server components under `node:test` is not practical, so
 * this pins the gate in the source; the smoke test (references/verify.md in the
 * praion new-site skill) checks the real 404.
 */

const LOCALE_DIR = join(process.cwd(), 'src/app/[locale]');

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return pages(full);
    return name === 'page.tsx' ? [full] : [];
  });
}

const GATES: Record<string, string[]> = {
  commerce: ['shop', 'checkout', 'order', 'cart'],
  booking: ['booking'],
};

for (const [module, dirs] of Object.entries(GATES)) {
  for (const dir of dirs) {
    for (const file of pages(join(LOCALE_DIR, dir))) {
      test(`${file.slice(LOCALE_DIR.length + 1)} is gated on the ${module} module`, () => {
        const src = readFileSync(file, 'utf8');
        assert.match(src, new RegExp(`isModuleEnabled\\(\\s*config,\\s*'${module}'\\s*\\)`));
        assert.match(src, /notFound\(\)/);
      });
    }
  }
}
