import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { statusHint, statusOptionDisabled } from '@/cms/admin/status-options';
import { publishDenialMessage, publishForbidden } from '@/cms/core/documents/publish-rights';

/**
 * A writer (edit, no publish) opening a PUBLISHED document could pick
 * "archived" — the form kept it enabled — and the save then failed with a bare
 * "forbidden". Taking a live page down needs publishing rights, exactly like
 * putting it up, so the form now says so before the save, and the server's
 * refusal says it in words if it is reached anyway.
 */
const STATUSES = ['draft', 'published', 'scheduled', 'archived'] as const;

const enabled = (ctx: { canPublish: boolean; current: string; saved: string | null }) =>
  STATUSES.filter((s) => !statusOptionDisabled(s, ctx));

describe('status options in the document form', () => {
  test('a publisher may choose anything', () => {
    assert.deepEqual(enabled({ canPublish: true, current: 'published', saved: 'published' }), [...STATUSES]);
  });

  test('a writer on a draft may keep it a draft or archive it, but not publish', () => {
    assert.deepEqual(enabled({ canPublish: false, current: 'draft', saved: 'draft' }), ['draft', 'archived']);
  });

  test('a writer on a new document may only draft or archive', () => {
    assert.deepEqual(enabled({ canPublish: false, current: 'draft', saved: null }), ['draft', 'archived']);
  });

  test('a writer on a published document cannot archive it or unpublish it', () => {
    assert.deepEqual(enabled({ canPublish: false, current: 'published', saved: 'published' }), ['published']);
  });

  test('a writer on a scheduled document cannot take it off the schedule either', () => {
    assert.deepEqual(enabled({ canPublish: false, current: 'scheduled', saved: 'scheduled' }), ['scheduled']);
  });

  test('the hint explains why, in the same voice as the existing one', () => {
    assert.equal(statusHint({ canPublish: true, saved: 'published' }), undefined);
    assert.equal(
      statusHint({ canPublish: false, saved: 'draft' }),
      'Your role can write and edit, but not publish. Someone with publishing rights takes it live.',
    );
    assert.equal(
      statusHint({ canPublish: false, saved: 'published' }),
      'Your role can write and edit, but not publish. This document is live, so only someone with publishing rights can archive it or turn it back into a draft. Your edits still save.',
    );
  });
});

describe('the server’s refusal', () => {
  test('nothing to refuse when nothing goes live or dark', () => {
    assert.equal(publishDenialMessage({}, { status: 'draft' }), null);
    assert.equal(publishDenialMessage({ status: 'archived' }, { status: 'draft' }), null);
    assert.equal(publishDenialMessage({}, { status: 'published' }), null);
  });

  test('archiving or unpublishing a live document explains itself', () => {
    const msg = 'This document is live. Your role can edit it, but only someone with publishing rights can archive it or turn it back into a draft.';
    assert.equal(publishDenialMessage({ status: 'archived' }, { status: 'published' }), msg);
    assert.equal(publishDenialMessage({ status: 'draft' }, { status: 'scheduled' }), msg);
  });

  test('putting something live explains itself', () => {
    const msg = 'Your role cannot publish. Save it as a draft and ask someone with publishing rights to take it live.';
    assert.equal(publishDenialMessage({ status: 'published' }), msg);
    assert.equal(publishDenialMessage({ scheduledFor: new Date() }, { status: 'draft' }), msg);
  });

  test('the 403 carries the words, not just the code', async () => {
    const res = publishForbidden('Because.');
    assert.equal(res.status, 403);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.ok, false);
    assert.equal(body.error, 'forbidden');
    assert.equal(body.message, 'Because.');
    assert.equal(body.missing, 'cms.content.publish');
  });
});
