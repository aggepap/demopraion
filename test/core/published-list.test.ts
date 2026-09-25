import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { QueryBuilder } from 'drizzle-orm/mysql-core';

import { schema } from '@/cms/db';
import { pageThrough, PUBLISHED_PAGE_MAX, visibleWhere } from '@/cms/core/read/documents';

/**
 * `listPublishedDocuments` took the newest N rows of every status and dropped
 * the drafts afterwards, so a block asking for three items could get one. And
 * the sitemap called it with the default limit of 200, so a site with more
 * documents than that had a sitemap that silently stopped listing them.
 */

describe('visibleWhere — the visibility rule as SQL', () => {
  const now = new Date('2026-09-25T10:00:00Z');
  const q = new QueryBuilder().select().from(schema.documents).where(visibleWhere(now)).limit(3).toSQL();

  test('keeps published, and scheduled whose time has passed', () => {
    assert.match(q.sql, /`status` = \? or \(`documents`\.`status` = \? and `documents`\.`scheduled_for` <= \?\)/);
    assert.deepEqual(q.params.slice(0, 2), ['published', 'scheduled']);
  });

  test('filters in the WHERE, before the LIMIT', () => {
    assert.ok(q.sql.indexOf(' where ') < q.sql.indexOf(' limit '));
  });
});

describe('pageThrough', () => {
  const rows = Array.from({ length: 2503 }, (_, i) => i);
  const fetchPage = async (offset: number, limit: number) => rows.slice(offset, offset + limit);

  test('returns every row, not the first page', async () => {
    assert.deepEqual(await pageThrough(fetchPage, PUBLISHED_PAGE_MAX), rows);
  });

  test('stops on an exact multiple with one empty page', async () => {
    let calls = 0;
    const exact = Array.from({ length: 20 }, (_, i) => i);
    const out = await pageThrough(async (o, l) => {
      calls++;
      return exact.slice(o, o + l);
    }, 10);
    assert.equal(out.length, 20);
    assert.equal(calls, 3);
  });
});

describe('wiring', () => {
  const read = readFileSync('src/cms/core/read/documents.ts', 'utf8');
  const list = read.slice(read.indexOf('export function listPublishedDocuments'), read.indexOf('export function listAllPublishedDocuments'));

  test('listPublishedDocuments filters visibility in SQL', () => {
    assert.match(list, /visibleWhere\(now\)/);
  });

  test('the module comment no longer promises a time-based fallback', () => {
    assert.doesNotMatch(read, /5-minute/);
  });

  test('the sitemap lists every document, not the first 200', () => {
    const sitemap = readFileSync('src/app/sitemap.ts', 'utf8');
    assert.match(sitemap, /listAllPublishedDocuments\(type, l\)/);
    assert.doesNotMatch(sitemap, /listPublishedDocuments\(type, l\)/);
  });
});
