/**
 * Idle timeout for the admin session.
 *
 * The session used to be a flat absolute expiry: signed in at 09:00 with
 * `ADMIN_SESSION_TTL_HOURS=8`, valid until 17:00 whether or not anybody touched
 * it. That is the wrong shape for an unattended laptop — the window that
 * matters is "how long since this person last did something", not "how long
 * since they signed in".
 *
 * So the JWT's `exp` now rides the idle window and is pushed forward as the
 * user works, while a separate `abs` claim keeps the original absolute cap so a
 * session cannot be renewed forever. The decision of which of those applies is
 * pure, and lives here, because getting it wrong in either direction is bad in
 * a different way: too eager and people lose unsaved work, too lax and the
 * feature does nothing.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import {
  decideSessionRefresh,
  DEFAULT_IDLE_MINUTES,
  IDLE_WARNING_SECONDS,
  idleState,
  sessionIdleSeconds,
  SESSION_REFRESH_AFTER_SECONDS,
} from '@/cms/modules/auth/session-idle';

afterEach(() => {
  delete process.env.ADMIN_SESSION_IDLE_MINUTES;
});

describe('sessionIdleSeconds', () => {
  test('defaults to an hour', () => {
    delete process.env.ADMIN_SESSION_IDLE_MINUTES;
    assert.equal(DEFAULT_IDLE_MINUTES, 60);
    assert.equal(sessionIdleSeconds(), 60 * 60);
  });

  test('honours a configured value', () => {
    process.env.ADMIN_SESSION_IDLE_MINUTES = '15';
    assert.equal(sessionIdleSeconds(), 15 * 60);
  });

  test('falls back to the default for a value that is not a positive number', () => {
    // These arrive from an env file. A typo must not become a session that
    // expires instantly and locks the whole team out of the admin.
    for (const raw of ['', '   ', 'abc', '0', '-5', 'NaN', 'Infinity']) {
      process.env.ADMIN_SESSION_IDLE_MINUTES = raw;
      assert.equal(sessionIdleSeconds(), 60 * 60, JSON.stringify(raw));
    }
  });

  test('enforces a floor, so no configuration can make the admin unusable', () => {
    // One minute is already absurd; anything below it is certainly a mistake.
    process.env.ADMIN_SESSION_IDLE_MINUTES = '0.1';
    assert.ok(sessionIdleSeconds() >= 60, 'must not go below a minute');
  });

  test('refreshes far more often than it expires', () => {
    // The refresh cadence exists to avoid a Set-Cookie on every single request.
    // It has to be small relative to the idle window or the sliding expiry
    // stops sliding in time.
    assert.ok(SESSION_REFRESH_AFTER_SECONDS > 0);
    assert.ok(SESSION_REFRESH_AFTER_SECONDS < 60 * 60 / 4);
  });
});

describe('decideSessionRefresh', () => {
  const IDLE = 3600;
  const NOW = 1_800_000_000;
  const base = { issuedAt: NOW, absoluteExpiry: NOW + 8 * 3600 };

  test('a session touched a moment ago is left alone', () => {
    assert.deepEqual(decideSessionRefresh(base, NOW + 5, IDLE), { action: 'ok' });
  });

  test('is refreshed once it is older than the refresh cadence', () => {
    const at = NOW + SESSION_REFRESH_AFTER_SECONDS;
    const d = decideSessionRefresh(base, at, IDLE);
    assert.equal(d.action, 'refresh');
    assert.equal(d.action === 'refresh' && d.expiresAt, at + IDLE);
  });

  test('expires once the idle window has passed with no activity', () => {
    assert.deepEqual(decideSessionRefresh(base, NOW + IDLE, IDLE), { action: 'expired' });
    assert.deepEqual(decideSessionRefresh(base, NOW + IDLE + 1, IDLE), { action: 'expired' });
  });

  test('the boundary is inclusive, so exactly-idle is out', () => {
    assert.equal(decideSessionRefresh(base, NOW + IDLE - 1, IDLE).action, 'refresh');
    assert.equal(decideSessionRefresh(base, NOW + IDLE, IDLE).action, 'expired');
  });

  test('the absolute cap wins even when the user is active', () => {
    /*
     * Without this, an active session renews indefinitely and
     * `ADMIN_SESSION_TTL_HOURS` stops meaning anything — a stolen cookie kept
     * warm by a script would never expire.
     */
    const nearCap = { issuedAt: NOW, absoluteExpiry: NOW + 60 };
    assert.deepEqual(decideSessionRefresh(nearCap, NOW + 61, IDLE), { action: 'expired' });
  });

  test('a refresh never reaches past the absolute cap', () => {
    const nearCap = { issuedAt: NOW, absoluteExpiry: NOW + SESSION_REFRESH_AFTER_SECONDS + 30 };
    const at = NOW + SESSION_REFRESH_AFTER_SECONDS;
    const d = decideSessionRefresh(nearCap, at, IDLE);
    assert.equal(d.action, 'refresh');
    assert.equal(d.action === 'refresh' && d.expiresAt, nearCap.absoluteExpiry);
  });

  test('the refresh cadence scales down for a short idle window', () => {
    /*
     * The bug this locks down, found by running with
     * `ADMIN_SESSION_IDLE_MINUTES=1`: with a flat 60-second refresh cadence and
     * a 60-second window, a session becomes eligible for refresh at exactly the
     * moment it expires — so it never refreshes, and an actively working user
     * is signed out every minute regardless of what they do.
     *
     * The cadence has to be a fraction of the window, not a constant.
     */
    const short = 60;
    const at = NOW + 20;
    const d = decideSessionRefresh({ issuedAt: NOW, absoluteExpiry: NOW + 8 * 3600 }, at, short);
    assert.equal(d.action, 'refresh', 'must refresh well before the short window is up');
    assert.equal(d.action === 'refresh' && d.expiresAt, at + short);
  });

  test('the long-window cadence is unchanged', () => {
    // A minute for an hour-long window: still the documented behaviour.
    const almost = NOW + SESSION_REFRESH_AFTER_SECONDS - 1;
    assert.equal(decideSessionRefresh(base, almost, IDLE).action, 'ok');
    assert.equal(
      decideSessionRefresh(base, NOW + SESSION_REFRESH_AFTER_SECONDS, IDLE).action,
      'refresh',
    );
  });

  test('a session issued in the future is not trusted into a longer life', () => {
    // Clock skew between two app servers, or a hand-crafted claim.
    const d = decideSessionRefresh({ ...base, issuedAt: NOW + 999 }, NOW, IDLE);
    assert.equal(d.action, 'ok');
  });
});

describe('idleState', () => {
  const IDLE = 3600;
  const NOW = 1_800_000_000_000; // milliseconds

  test('is active right after something happened', () => {
    assert.equal(idleState(NOW, NOW, IDLE), 'active');
    assert.equal(idleState(NOW - 1000, NOW, IDLE), 'active');
  });

  test('warns in the last minute, not before', () => {
    const warnAt = NOW + (IDLE - IDLE_WARNING_SECONDS) * 1000;
    assert.equal(idleState(NOW, warnAt - 1000, IDLE), 'active');
    assert.equal(idleState(NOW, warnAt, IDLE), 'warning');
    assert.equal(idleState(NOW, warnAt + 1000, IDLE), 'warning');
  });

  test('expires exactly at the window', () => {
    assert.equal(idleState(NOW, NOW + IDLE * 1000 - 1000, IDLE), 'warning');
    assert.equal(idleState(NOW, NOW + IDLE * 1000, IDLE), 'expired');
  });

  test('a warning window longer than the idle window still warns before expiring', () => {
    // A pathological configuration (idle of 60s, warning of 60s) must not
    // produce a session that is "expired" from the instant it starts.
    assert.equal(idleState(NOW, NOW, 60, 60), 'warning');
    assert.equal(idleState(NOW, NOW + 60_000, 60, 60), 'expired');
  });

  test('activity timestamped in the future does not read as long-expired', () => {
    // Comes up for real: the value is shared between tabs through localStorage,
    // and a machine waking from sleep can resync its clock backwards.
    assert.equal(idleState(NOW + 60_000, NOW, IDLE), 'active');
  });
});
