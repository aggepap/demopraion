import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { planSeedDocument, remapRelation } from '@/cms/db/seeds/content-plan';

/**
 * `db:seed-content` inserted every snapshot document under its original id. On a
 * database that already had content, that id could belong to a different
 * document and the run aborted on the primary key. It also wrote no
 * `document_versions` rows, so seeded documents had an empty history.
 */

describe('planSeedDocument', () => {
  test('a document already present by (type, slug, locale) is skipped and mapped', () => {
    assert.deepEqual(planSeedDocument(42, true), { kind: 'skip', dbId: 42 });
    assert.deepEqual(planSeedDocument(42, false), { kind: 'skip', dbId: 42 });
  });

  test('a new document keeps its id when it is free', () => {
    assert.deepEqual(planSeedDocument(undefined, false), { kind: 'insert', keepId: true });
  });

  test('a new document whose id another row holds is inserted under a fresh id', () => {
    assert.deepEqual(planSeedDocument(undefined, true), { kind: 'insert', keepId: false });
  });
});

describe('remapRelation', () => {
  const idMap = new Map([
    [1, 101],
    [2, 2],
  ]);

  test('rewrites both ends through the id map', () => {
    assert.deepEqual(remapRelation({ fromId: 1, toId: 2, fieldKey: 'author', position: 0 }, idMap), {
      fromId: 101,
      toId: 2,
      fieldKey: 'author',
      position: 0,
    });
  });

  test('drops a link whose end was never seeded', () => {
    assert.equal(remapRelation({ fromId: 1, toId: 9 }, idMap), null);
    assert.equal(remapRelation({ fromId: 9, toId: 2 }, idMap), null);
  });
});

describe('seed-content wiring', () => {
  const src = readFileSync('src/cms/db/seeds/cli/seed-content.ts', 'utf8');

  test('every inserted document gets its first version row', () => {
    assert.match(src, /insert\(documentVersions\)/);
    assert.match(src, /version: 1/);
  });

  test('the original id is only reused when the plan says it is free', () => {
    assert.match(src, /plan\.keepId \? \{ id: doc\.id \} : \{\}/);
    assert.match(src, /remapRelation\(snapRel, idMap\)/);
  });

  test('runs under plain tsx: nothing that reaches server-only', () => {
    // The document service reaches `server-only` through the redirect writers.
    assert.doesNotMatch(src, /documents\/service'/);
  });

  test('a missing snapshot is a message, not a stack trace', () => {
    assert.match(src, /if \(!existsSync\(FILE\)\)/);
    assert.match(src, /No content snapshot found/);
  });
});
