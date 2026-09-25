import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  formatSeedSummary,
  parseSeedMode,
  seedAction,
  tally,
  type SeedCounts,
} from '@/cms/db/seeds/seed-mode';

/**
 * The content seeders (`db:seed-articles|answers|scenarios`) rebuild a document's
 * entire `data` blob from the files under `src/content` and wrote it over whatever
 * was in the database — with no `expectedVersion`, so the optimistic-concurrency
 * check that protects two editors from each other was skipped too.
 *
 * They are documented as first-deploy tools, but nothing stopped one being run
 * against a live database, and doing so silently reverted every edit made in the
 * admin: body, headline, TOC, FAQ, CTA, tags. No prompt, no diff, no error. The
 * `document_versions` history means it is recoverable, but only by someone who
 * knows to look.
 *
 * So the destructive half now needs asking for. These tests pin the decision
 * itself, which is the part that has to be right — the DB round-trip is the same
 * `createDocument`/`updateDocument` call it always was.
 */

test('an absent document is created in either mode', () => {
  assert.equal(seedAction(false, 'create-only'), 'create');
  assert.equal(seedAction(false, 'force'), 'create');
});

test('an existing document is skipped by default and updated only under --force', () => {
  assert.equal(seedAction(true, 'create-only'), 'skip');
  assert.equal(seedAction(true, 'force'), 'update');
});

test('no flag means the non-destructive mode', () => {
  assert.equal(parseSeedMode([]), 'create-only');
  assert.equal(parseSeedMode(['--locale=el']), 'create-only');
});

test('--force selects the destructive mode', () => {
  assert.equal(parseSeedMode(['--force']), 'force');
  assert.equal(parseSeedMode(['--locale=el', '--force']), 'force');
});

/**
 * `argv.includes` would be enough, but the flag turns a read-mostly command into
 * one that overwrites live editorial — so it is matched exactly, and a token that
 * merely contains the word does not count. `--no-force` reading as force is the
 * one that would actually hurt.
 */
test('a token that merely contains "--force" does not select it', () => {
  for (const argv of [['--no-force'], ['--force-all'], ['--flag=--force'], ['force'], ['-force']]) {
    assert.equal(parseSeedMode(argv), 'create-only', argv.join(' '));
  }
});

test('the summary reports all three counts', () => {
  const counts: SeedCounts = { created: 2, updated: 0, skipped: 4 };
  const line = formatSeedSummary('articles', counts, 'create-only');
  assert.match(line, /articles/);
  assert.match(line, /created 2/);
  assert.match(line, /skipped 4/);
});

/**
 * A skip is silent by nature: the operator asked for a seed and got fewer writes
 * than they expected. If the line does not say how to override, the only way to
 * find out is to read the source.
 */
test('the summary names --force when something was skipped', () => {
  const line = formatSeedSummary('answers', { created: 0, updated: 0, skipped: 8 }, 'create-only');
  assert.match(line, /--force/);
});

test('the summary stays quiet about --force when nothing was skipped', () => {
  const line = formatSeedSummary('answers', { created: 8, updated: 0, skipped: 0 }, 'create-only');
  assert.doesNotMatch(line, /--force/);
});

test('a forced run reports what it overwrote', () => {
  const line = formatSeedSummary('scenarios', { created: 0, updated: 10, skipped: 0 }, 'force');
  assert.match(line, /updated 10/);
  assert.doesNotMatch(line, /--force/);
});

test('each action increments its own counter and no other', () => {
  const counts: SeedCounts = { created: 0, updated: 0, skipped: 0 };
  tally(counts, 'create');
  assert.deepEqual(counts, { created: 1, updated: 0, skipped: 0 });
  tally(counts, 'update');
  assert.deepEqual(counts, { created: 1, updated: 1, skipped: 0 });
  tally(counts, 'skip');
  assert.deepEqual(counts, { created: 1, updated: 1, skipped: 1 });
});
