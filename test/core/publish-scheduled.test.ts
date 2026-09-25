import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { auditActionGroup } from '@/cms/core/audit-groups';
import { auditActionLabel } from '@/cms/core/audit-labels';
import {
  publishDueScheduled,
  type ScheduledDocument,
  type PublishScheduledDeps,
} from '@/cms/core/documents/publish-scheduled';

/**
 * A scheduled document went live when its time came — the public read treats
 * `scheduled` with a past date as visible — but its stored status stayed
 * "scheduled" forever. The admin list and the form went on saying "scheduled"
 * about a page that had been public for weeks.
 *
 * Promotion rewrites the status to "published" (recorded in the audit log) the
 * next time anyone looks, and on a cron tick for sites that have one.
 */
const NOW = new Date('2026-09-23T10:00:00Z');

const row = (over: Partial<ScheduledDocument> = {}): ScheduledDocument => ({
  id: 1,
  type: 'page',
  locale: 'el',
  slug: 'news',
  status: 'scheduled',
  publishedAt: null,
  scheduledFor: new Date('2026-09-23T09:00:00Z'),
  ...over,
});

function fakes(due: ScheduledDocument[], failIds: number[] = [], changedIds: number[] = []) {
  const published: { id: number; publishedAt: Date }[] = [];
  const audits: Record<string, unknown>[] = [];
  const revalidated: number[] = [];
  const asked: { now: Date; type?: string }[] = [];
  const deps: PublishScheduledDeps = {
    listDue: async (now, type) => {
      asked.push({ now, type });
      return due.filter((r) => r.scheduledFor != null && r.scheduledFor <= now && (!type || r.type === type));
    },
    publish: async (doc, patch) => {
      if (failIds.includes(doc.id)) throw new Error('boom');
      if (changedIds.includes(doc.id)) return false;
      published.push({ id: doc.id, publishedAt: patch.publishedAt });
      return true;
    },
    audit: async (entry) => {
      audits.push(entry as unknown as Record<string, unknown>);
    },
    revalidate: (doc) => {
      revalidated.push(doc.id);
    },
  };
  return { deps, published, audits, revalidated, asked };
}

describe('publishDueScheduled', () => {
  test('a scheduled document whose time has passed becomes published', async () => {
    const f = fakes([row()]);
    const out = await publishDueScheduled(f.deps, { now: NOW });
    assert.deepEqual(out, { published: 1, failed: 0 });
    assert.deepEqual(f.published.map((p) => p.id), [1]);
    assert.deepEqual(f.revalidated, [1]);
  });

  test('one still in the future is left alone', async () => {
    const f = fakes([row({ scheduledFor: new Date('2026-09-24T00:00:00Z') })]);
    const out = await publishDueScheduled(f.deps, { now: NOW });
    assert.deepEqual(out, { published: 0, failed: 0 });
    assert.equal(f.audits.length, 0);
  });

  test('its published date is the moment it was scheduled for, not the moment we noticed', async () => {
    const f = fakes([row()]);
    await publishDueScheduled(f.deps, { now: NOW });
    assert.equal(f.published[0].publishedAt.toISOString(), '2026-09-23T09:00:00.000Z');
  });

  test('a published date the editor chose (a backdate) is kept', async () => {
    const f = fakes([row({ publishedAt: new Date('2026-01-01T00:00:00Z') })]);
    await publishDueScheduled(f.deps, { now: NOW });
    assert.equal(f.published[0].publishedAt.toISOString(), '2026-01-01T00:00:00.000Z');
  });

  test('every promotion is written to the audit log, attributed to the scheduler', async () => {
    const f = fakes([row({ id: 4, type: 'article' })]);
    await publishDueScheduled(f.deps, { now: NOW });
    assert.equal(f.audits.length, 1);
    const entry = f.audits[0];
    assert.equal(entry.action, 'document.publish_scheduled');
    assert.equal(entry.userId ?? null, null);
    assert.equal(entry.actorLabel, 'scheduler');
    assert.equal(entry.subjectType, 'article');
    assert.equal(entry.subjectId, 4);
  });

  test('one failure does not stop the rest, and is counted', async () => {
    const f = fakes([row({ id: 1 }), row({ id: 2 }), row({ id: 3 })], [2]);
    const out = await publishDueScheduled(f.deps, { now: NOW });
    assert.deepEqual(out, { published: 2, failed: 1 });
    assert.deepEqual(f.published.map((p) => p.id), [1, 3]);
    assert.equal(f.audits.length, 2);
  });

  test('a document an editor changed since it was listed is left alone, and not audited', async () => {
    const f = fakes([row({ id: 1 }), row({ id: 2 })], [], [1]);
    const out = await publishDueScheduled(f.deps, { now: NOW });
    assert.deepEqual(out, { published: 1, failed: 0 });
    assert.deepEqual(f.audits.map((a) => a.subjectId), [2]);
  });

  test('can be narrowed to one collection, for the admin list of that collection', async () => {
    const f = fakes([row({ id: 1, type: 'page' }), row({ id: 2, type: 'article' })]);
    await publishDueScheduled(f.deps, { now: NOW, type: 'article' });
    assert.equal(f.asked[0].type, 'article');
    assert.deepEqual(f.published.map((p) => p.id), [2]);
  });
});

describe('the audit screen and the scheduler agree', () => {
  test('the promotion reads as a sentence and sits with content', () => {
    assert.equal(auditActionLabel('document.publish_scheduled'), 'Published a scheduled document');
    assert.equal(auditActionGroup('document.publish_scheduled'), 'content');
  });

  test('alt-text edits read as a sentence too', () => {
    assert.equal(auditActionLabel('media.update'), 'Changed a file’s alt text');
  });
});

describe('the cron job', () => {
  test('is registered', () => {
    const route = readFileSync('src/app/api/cms/cron/[job]/route.ts', 'utf8');
    assert.match(route, /'content-publish-scheduled':/);
  });

  // START_HERE.md lives only in the CMS base; the new-site skill strips it from
  // generated sites, where this check has nothing to read.
  test('is documented in START_HERE.md', { skip: !existsSync('START_HERE.md') && 'base-only file' }, () => {
    const guide = readFileSync('START_HERE.md', 'utf8');
    assert.match(guide, /`content-publish-scheduled`/);
  });
});
