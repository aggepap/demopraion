import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

/**
 * This site was generated from the Praion CMS. Nothing a visitor, editor or
 * crawler sees may still carry that name.
 *
 * Not scanned: `src/cms/**` (the shared core, re-synced from upstream; its
 * `PRAION_TAB` names the Product Manager integration), comment-only lines, docs.
 */

const ROOT = process.cwd();
const DIRS = ['src', 'messages', 'public', 'test/site'];
const ROOT_FILES = ['next.config.ts', 'package.json', '.env.example'];
const TEXT = /\.(?:ts|tsx|js|mjs|json|css|svg|txt|webmanifest|xml)$/;
const ALLOW = [/\bPRAION_TAB\b/];
const SELF = relative(ROOT, __filename);

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const isComment = (line: string) => /^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line);

test('no Praion references outside the shared core', () => {
  const files = [
    ...DIRS.flatMap((d) => walk(join(ROOT, d))).filter((f) => TEXT.test(f)),
    ...ROOT_FILES.map((f) => join(ROOT, f)).filter(existsSync),
  ];
  const hits: string[] = [];
  for (const file of files) {
    const rel = relative(ROOT, file);
    if (rel.startsWith('src/cms/') || rel === SELF) continue;
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (/praion/i.test(line) && !isComment(line) && !ALLOW.some((re) => re.test(line))) {
          hits.push(`${rel}:${i + 1}`);
        }
      });
  }
  assert.deepEqual(hits, []);
});
