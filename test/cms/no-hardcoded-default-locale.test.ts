import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

/**
 * Greek is Praion's main language, not the CMS's.
 *
 * The core and the site code every generated site keeps used to fall back to
 * `'el'` in a dozen places — request schemas, stored locales, emailed links — so
 * an English-first site built from this code quietly served Greek documents and
 * Greek-prefixed links. The site's default is `config.defaultLocale` (core) or
 * `defaultLocale` from `@/lib/i18n/config` (site); this pins that nothing
 * hardcodes it again.
 *
 * Allowed, each for a stated reason:
 * - database column defaults in the schema files: only apply when an insert omits
 *   the locale, which every write path now supplies;
 * - booking read-side fallbacks for reservations stored before locales were
 *   always written (Praion's legacy rows, which are Greek).
 */

const ROOT = process.cwd();

/** Code that ships in every site: the core plus the kept site layers. */
const SCAN = [
  'src/cms',
  'src/components/shop',
  'src/components/booking',
  'src/components/layout',
  'src/components/ui',
  'src/components/cms',
  'src/lib/i18n',
  'src/lib/seo/commerce-schema.ts',
  'src/lib/money.ts',
  'src/app/api',
  'src/app/[locale]/shop',
  'src/app/[locale]/booking',
  'src/app/[locale]/checkout',
  'src/app/[locale]/order',
  'src/app/[locale]/cart',
  'src/app/[locale]/[slug]',
];

const HARDCODED = [
  /\?\?\s*'el'/, // x ?? 'el'
  /\|\|\s*'el'/, // x || 'el'
  /\.default\(\s*'el'\s*\)/, // zod .default('el')
  /locale\s*===\s*'en'\s*\?\s*'\/en'/, // hand-rolled "en is the prefixed one"
];

const ALLOWED: ReadonlyArray<{ file: string; pattern: RegExp; why: string }> = [
  { file: 'src/cms/db/adapters/mysql/schema/', pattern: /varchar\('locale'.*\.default\('el'\)/, why: 'column default; writes always supply a locale' },
  { file: 'src/cms/modules/booking/emails.ts', pattern: /reservation\.locale \?\? 'el'/, why: 'legacy reservations stored without a locale' },
  { file: 'src/cms/modules/booking/reservations.ts', pattern: /reservation\.locale \?\? 'el'/, why: 'price drift on legacy reservations' },
];

function files(path: string): string[] {
  const full = join(ROOT, path);
  if (!statSync(full, { throwIfNoEntry: false })) return [];
  if (statSync(full).isFile()) return [full];
  return readdirSync(full).flatMap((name) => files(join(path, name)));
}

const isComment = (line: string) => /^\s*(\/\/|\*|\/\*)/.test(line);

test('no code that ships in every site hardcodes Greek as the default locale', () => {
  const hits: string[] = [];
  for (const file of SCAN.flatMap(files)) {
    if (!/\.(ts|tsx)$/.test(file)) continue;
    const rel = relative(ROOT, file);
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (isComment(line) || !HARDCODED.some((re) => re.test(line))) return;
        if (ALLOWED.some((a) => rel.startsWith(a.file) && a.pattern.test(line))) return;
        hits.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
  }
  assert.deepEqual(hits, []);
});
