import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { documentLockKey, isValidResourceKey, orderLockKey, reservationLockKey } from '@/cms/core/locks/keys';
import {
  decideAcquire,
  decideRelease,
  decideWrite,
  expiresAtFrom,
  holderView,
  isExpired,
  resolveTtlSeconds,
  type LockRecord,
} from '@/cms/core/locks/policy';
import { clientFrame, roomKey } from '@/cms/core/locks/protocol';

const NOW = new Date('2026-08-27T10:00:00.000Z');

function lock(over: Partial<LockRecord> = {}): LockRecord {
  return {
    resourceType: 'document',
    resourceKey: 'grp-1',
    userId: 1,
    userName: 'Alice',
    sessionId: 'sess-a',
    connectionId: 'conn-a',
    acquiredAt: new Date(NOW.getTime() - 60_000),
    heartbeatAt: new Date(NOW.getTime() - 5_000),
    expiresAt: new Date(NOW.getTime() + 30_000),
    ...over,
  };
}

const alice = { userId: 1, userName: 'Alice', sessionId: 'sess-a', connectionId: 'conn-a' };
const bob = { userId: 2, userName: 'Bob', sessionId: 'sess-b', connectionId: 'conn-b' };

describe('isExpired', () => {
  test('a lock expiring in the future is live', () => {
    assert.equal(isExpired(lock(), NOW), false);
  });

  test('is inclusive at the boundary — expiresAt === now is already expired', () => {
    // A lock that expires "exactly now" must not keep anyone out: the whole
    // point of the TTL is that a dead holder stops blocking people.
    assert.equal(isExpired(lock({ expiresAt: NOW }), NOW), true);
  });

  test('one millisecond either side of the boundary', () => {
    assert.equal(isExpired(lock({ expiresAt: new Date(NOW.getTime() + 1) }), NOW), false);
    assert.equal(isExpired(lock({ expiresAt: new Date(NOW.getTime() - 1) }), NOW), true);
  });
});

describe('decideAcquire', () => {
  test('grants a resource nobody holds', () => {
    const r = decideAcquire(null, bob, NOW, 60);
    assert.equal(r.decision, 'granted');
    assert.deepEqual(r.expiresAt, new Date(NOW.getTime() + 60_000));
  });

  test('grants over a lock that has expired', () => {
    const stale = lock({ expiresAt: new Date(NOW.getTime() - 1_000) });
    assert.equal(decideAcquire(stale, bob, NOW, 60).decision, 'granted');
  });

  test('refuses a live lock held by a different user', () => {
    assert.equal(decideAcquire(lock(), bob, NOW, 60).decision, 'held-by-other');
  });

  test('renews for the same tab — an F5 must not lock you out of your own document', () => {
    assert.equal(decideAcquire(lock(), alice, NOW, 60).decision, 'renewed');
  });

  test('renews for the same user in a different tab, rather than refusing them', () => {
    // Two tabs are one person. Telling Alice that "Alice is editing this"
    // would be both true and useless.
    const secondTab = { ...alice, sessionId: 'sess-a2', connectionId: 'conn-a2' };
    assert.equal(decideAcquire(lock(), secondTab, NOW, 60).decision, 'renewed');
  });

  test('a renewal still moves the expiry forward', () => {
    const r = decideAcquire(lock(), alice, NOW, 60);
    assert.deepEqual(r.expiresAt, new Date(NOW.getTime() + 60_000));
  });
});

describe('decideRelease', () => {
  test('releases when the connection that holds the lock is the one closing', () => {
    assert.equal(decideRelease(lock(), 'conn-a'), 'release');
  });

  test('ignores a release from a superseded connection — the refresh race', () => {
    /*
     * On F5 the tab keeps its sessionId, so the NEW socket re-acquires before
     * the OLD socket's close event arrives. Releasing on session alone would
     * delete the lock that was just granted, and the tab would silently lose
     * its own document.
     */
    assert.equal(decideRelease(lock({ connectionId: 'conn-a2' }), 'conn-a'), 'ignore');
  });

  test('ignores a release when there is no lock at all', () => {
    assert.equal(decideRelease(null, 'conn-a'), 'ignore');
  });
});

describe('decideWrite', () => {
  test('allows when nobody holds the resource', () => {
    assert.equal(decideWrite(null, 2, NOW), 'allowed');
  });

  test('allows when the lock has expired', () => {
    assert.equal(decideWrite(lock({ expiresAt: new Date(NOW.getTime() - 1) }), 2, NOW), 'allowed');
  });

  test('allows the holder', () => {
    assert.equal(decideWrite(lock(), 1, NOW), 'allowed');
  });

  test('blocks a different user', () => {
    assert.equal(decideWrite(lock(), 2, NOW), 'blocked');
  });

  test('keys off the user, not the tab, so the holder’s second tab may still save', () => {
    /*
     * Deliberately NOT keyed on sessionId. If a save were authorised by a
     * session id, and the id is broadcast to every socket in the room so tabs
     * can tell "mine" from "theirs", then that id would be a bypass token
     * anyone in the room could replay. The user id comes from the signed
     * session cookie and cannot be spoofed, so the check uses that instead.
     */
    assert.equal(decideWrite(lock({ sessionId: 'some-other-tab' }), 1, NOW), 'allowed');
  });

  test('blocks an unauthenticated-looking caller while a lock is live', () => {
    assert.equal(decideWrite(lock(), null, NOW), 'blocked');
  });
});

describe('documentLockKey', () => {
  test('prefers the translation group so every locale shares one lock', () => {
    assert.equal(documentLockKey({ translationGroupId: 'grp-9', variantIds: [12, 13] }), 'grp-9');
  });

  test('falls back to the lowest variant id when the group is not set yet', () => {
    assert.equal(documentLockKey({ translationGroupId: null, variantIds: [13, 12] }), 'row:12');
  });

  test('gives EVERY variant of one document the SAME key', () => {
    /*
     * The editor screen edits all locales at once, and the URL id depends on
     * which locale you happened to open. Keying on the row id would have given
     * /admin/article/12 (EL) and /admin/article/13 (EN) two separate locks —
     * two people editing the same document, each told it was free.
     */
    const el = documentLockKey({ translationGroupId: null, variantIds: [12, 13] });
    const en = documentLockKey({ translationGroupId: null, variantIds: [13, 12] });
    assert.equal(el, en);
  });

  test('a single-locale document still gets a stable key', () => {
    assert.equal(documentLockKey({ translationGroupId: null, variantIds: [7] }), 'row:7');
  });
});

describe('order and reservation keys', () => {
  test('are namespaced by their numeric id', () => {
    assert.equal(orderLockKey(42), '42');
    assert.equal(reservationLockKey(42), '42');
  });
});

describe('isValidResourceKey', () => {
  test('accepts uuids and the row fallback', () => {
    assert.equal(isValidResourceKey('9f8b7c60-1111-4222-8333-444455556666'), true);
    assert.equal(isValidResourceKey('row:12'), true);
  });

  test('rejects traversal, whitespace, emptiness and overlong keys', () => {
    assert.equal(isValidResourceKey('../etc'), false);
    assert.equal(isValidResourceKey('a b'), false);
    assert.equal(isValidResourceKey(''), false);
    assert.equal(isValidResourceKey('x'.repeat(65)), false);
  });
});

describe('roomKey', () => {
  test('namespaces the key by resource type', () => {
    assert.equal(roomKey('document', 'grp-1'), 'document:grp-1');
    // An order and a document may legitimately share the key "12".
    assert.notEqual(roomKey('order', '12'), roomKey('document', '12'));
  });
});

describe('clientFrame', () => {
  test('accepts the four supported frames', () => {
    for (const action of ['acquire', 'release', 'takeover', 'observe'] as const) {
      const parsed = clientFrame.safeParse({ action, resourceType: 'order', resourceKey: '12' });
      assert.equal(parsed.success, true, action);
    }
  });

  test('rejects an unknown action and an unknown resource type', () => {
    assert.equal(clientFrame.safeParse({ action: 'destroy', resourceType: 'order', resourceKey: '1' }).success, false);
    assert.equal(clientFrame.safeParse({ action: 'acquire', resourceType: 'invoice', resourceKey: '1' }).success, false);
  });

  test('strips a client-supplied userId — identity comes from the cookie, never the frame', () => {
    /*
     * The relay forwards frames verbatim. If a userId in the payload could
     * reach the lock row, anyone could hold a lock as anyone else.
     */
    const parsed = clientFrame.parse({ action: 'acquire', resourceType: 'order', resourceKey: '12', userId: 99 });
    assert.equal('userId' in parsed, false);
  });

  test('rejects a malformed resource key rather than storing it', () => {
    assert.equal(clientFrame.safeParse({ action: 'acquire', resourceType: 'order', resourceKey: '../x' }).success, false);
  });
});

describe('holderView', () => {
  test('carries what the banner needs and nothing that authorises anything', () => {
    const view = holderView(lock());
    assert.deepEqual(view, {
      userId: 1,
      userName: 'Alice',
      sessionId: 'sess-a',
      since: lock().acquiredAt.toISOString(),
    });
    // The socket id is the release credential; it must never leave the server.
    assert.equal('connectionId' in view, false);
  });
});

describe('resolveTtlSeconds', () => {
  test('defaults when unset', () => {
    assert.equal(resolveTtlSeconds(undefined), 60);
  });

  test('an empty or junk value falls back instead of becoming zero', () => {
    /*
     * `Number('')` is 0, and a zero TTL would expire every lock the instant it
     * was taken — the feature would look like it simply did not work. Same trap
     * ADMIN_SESSION_IDLE_MINUTES documents in .env.example.
     */
    assert.equal(resolveTtlSeconds(''), 60);
    assert.equal(resolveTtlSeconds('abc'), 60);
    assert.equal(resolveTtlSeconds('0'), 60);
    assert.equal(resolveTtlSeconds('-30'), 60);
  });

  test('accepts a sane override and clamps an absurd one', () => {
    assert.equal(resolveTtlSeconds('120'), 120);
    assert.equal(resolveTtlSeconds('999999'), 3600);
  });
});

describe('expiresAtFrom', () => {
  test('is now plus the ttl', () => {
    assert.deepEqual(expiresAtFrom(NOW, 45), new Date(NOW.getTime() + 45_000));
  });
});
