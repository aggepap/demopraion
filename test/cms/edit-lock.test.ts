import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { relativeSince } from '@/cms/admin/locks/since';

const NOW = new Date('2026-08-27T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe('relativeSince', () => {
  test('reads as "just now" inside the first minute', () => {
    assert.equal(relativeSince(ago(0), NOW), 'just now');
    assert.equal(relativeSince(ago(59_000), NOW), 'just now');
  });

  test('counts whole minutes, singular and plural', () => {
    assert.equal(relativeSince(ago(60_000), NOW), '1 minute ago');
    assert.equal(relativeSince(ago(4 * 60_000), NOW), '4 minutes ago');
  });

  test('switches to hours past sixty minutes', () => {
    assert.equal(relativeSince(ago(60 * 60_000), NOW), '1 hour ago');
    assert.equal(relativeSince(ago(3 * 60 * 60_000), NOW), '3 hours ago');
  });

  test('a clock-skewed future timestamp does not render as negative', () => {
    // The holder's "since" comes from the database, the comparison clock from
    // the browser. They disagree; "in -2 minutes" must never reach a user.
    assert.equal(relativeSince(new Date(NOW.getTime() + 90_000).toISOString(), NOW), 'just now');
  });

  test('an unparseable timestamp degrades to empty rather than "NaN minutes ago"', () => {
    assert.equal(relativeSince('not-a-date', NOW), '');
    assert.equal(relativeSince('', NOW), '');
  });
});

// ── Room bookkeeping ────────────────────────────────────────────────────────
// These guard a render loop, not a display bug. The provider's context value
// contains `rooms`, so anything that changes the `rooms` object IDENTITY makes
// every consumer's effect re-run. An update that always allocated a new object
// therefore span forever: cleanup → new identity → resubscribe → cleanup.

import { applyRoomState, lockPhase, removeRoom, type Rooms } from '@/cms/admin/locks/rooms';

const holderA = { userId: 1, userName: 'Alice', sessionId: 'tab-A', since: '2026-08-27T12:00:00.000Z' };
const holderB = { userId: 2, userName: 'Bob', sessionId: 'tab-B', since: '2026-08-27T12:01:00.000Z' };

describe('removeRoom', () => {
  test('returns the SAME object when the room was not there', () => {
    const rooms: Rooms = { 'document:1': { holder: holderA } };
    assert.equal(removeRoom(rooms, 'document:999'), rooms);
  });

  test('returns the same object when removing from an empty map', () => {
    const rooms: Rooms = {};
    assert.equal(removeRoom(rooms, 'document:1'), rooms);
  });

  test('returns a new object, without the room, when it was there', () => {
    const rooms: Rooms = { 'document:1': { holder: holderA }, 'order:2': { holder: holderB } };
    const next = removeRoom(rooms, 'document:1');
    assert.notEqual(next, rooms);
    assert.deepEqual(Object.keys(next), ['order:2']);
  });
});

describe('applyRoomState', () => {
  test('returns the SAME object when the holder has not actually changed', () => {
    // Heartbeats and re-acquires re-broadcast an unchanged holder constantly.
    const rooms: Rooms = { 'document:1': { holder: holderA } };
    assert.equal(applyRoomState(rooms, 'document:1', { ...holderA }), rooms);
  });

  test('returns the same object when a free room is reported free again', () => {
    const rooms: Rooms = { 'document:1': { holder: null } };
    assert.equal(applyRoomState(rooms, 'document:1', null), rooms);
  });

  test('returns a new object when the holder changes', () => {
    const rooms: Rooms = { 'document:1': { holder: holderA } };
    const next = applyRoomState(rooms, 'document:1', holderB);
    assert.notEqual(next, rooms);
    assert.equal(next['document:1'].holder?.userId, 2);
  });

  test('returns a new object when a lock is released', () => {
    const rooms: Rooms = { 'document:1': { holder: holderA } };
    assert.notEqual(applyRoomState(rooms, 'document:1', null), rooms);
  });

  test('notices a rename or a new start time on the same user', () => {
    const rooms: Rooms = { 'document:1': { holder: holderA } };
    assert.notEqual(applyRoomState(rooms, 'document:1', { ...holderA, userName: 'Alicia' }), rooms);
    assert.notEqual(applyRoomState(rooms, 'document:1', { ...holderA, since: 'later' }), rooms);
  });

  test('records a room it has never seen', () => {
    const next = applyRoomState({}, 'document:1', holderA);
    assert.equal(next['document:1'].holder?.userName, 'Alice');
  });
});

describe('lockPhase', () => {
  const base = { currentUserId: 1, sessionId: 'tab-A' };

  test('an unreachable relay is "unavailable", never "locked"', () => {
    // The editor must stay usable when the sidecar is down.
    assert.equal(lockPhase({ ...base, connected: false, holder: holderB }), 'unavailable');
  });

  test('nobody holding it is unlocked', () => {
    assert.equal(lockPhase({ ...base, connected: true, holder: null }), 'unlocked');
  });

  test('my own tab is "mine"', () => {
    assert.equal(lockPhase({ ...base, connected: true, holder: holderA }), 'mine');
  });

  test('me in another tab is "mine-elsewhere", not a lockout', () => {
    assert.equal(
      lockPhase({ ...base, connected: true, holder: { ...holderA, sessionId: 'tab-other' } }),
      'mine-elsewhere',
    );
  });

  test('somebody else is "theirs" — the only phase that disables the form', () => {
    assert.equal(lockPhase({ ...base, connected: true, holder: holderB }), 'theirs');
  });
});

// ── Where the socket actually connects ──────────────────────────────────────
import { LOCK_WS_PATH, resolveWsUrl } from '@/cms/admin/locks/ws-url';

describe('resolveWsUrl', () => {
  const https = { protocol: 'https:', host: 'praion.gr' };
  const http = { protocol: 'http:', host: 'localhost:3002' };

  test('derives a same-origin wss URL in production', () => {
    // Same host AND port as the document, so CSP `connect-src 'self'` covers it.
    assert.equal(resolveWsUrl('', https), `wss://praion.gr${LOCK_WS_PATH}`);
  });

  test('uses ws:// when the page itself is not secure', () => {
    assert.equal(resolveWsUrl('', http), `ws://localhost:3002${LOCK_WS_PATH}`);
  });

  test('appends the path to a bare origin override', () => {
    // The dev override is written as an origin; nobody should have to know the
    // relay's internal path. Without this the browser hit ws://host/ and the
    // relay — which only serves LOCK_WS_PATH — refused every connection.
    assert.equal(resolveWsUrl('ws://localhost:8081', http), `ws://localhost:8081${LOCK_WS_PATH}`);
  });

  test('a trailing slash is still a bare origin', () => {
    assert.equal(resolveWsUrl('ws://localhost:8081/', http), `ws://localhost:8081${LOCK_WS_PATH}`);
  });

  test('leaves an override that already names the path alone', () => {
    const full = `ws://localhost:8081${LOCK_WS_PATH}`;
    assert.equal(resolveWsUrl(full, http), full);
  });

  test('respects a deliberate custom path', () => {
    assert.equal(resolveWsUrl('wss://relay.example/sockets', https), 'wss://relay.example/sockets');
  });

  test('a malformed override falls back to same-origin rather than throwing', () => {
    assert.equal(resolveWsUrl('not a url', https), `wss://praion.gr${LOCK_WS_PATH}`);
  });
});

test('the relay serves exactly the path the client dials', () => {
  // Two files, one constant, no build step to share it — so assert they agree.
  // A mismatch fails silently: the socket never connects and locking is simply
  // absent, with the editor behaving as if the feature were switched off.
  const relay = readFileSync(
    new URL('../../src/cms/realtime/lock-server.mjs', import.meta.url),
    'utf8',
  );
  const declared = /const WS_PATH = '([^']+)'/.exec(relay)?.[1];
  assert.equal(declared, LOCK_WS_PATH);
});
