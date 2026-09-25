/**
 * Which header the client's address is read from, and why the audit log kept
 * saying "unknown".
 *
 * `x-real-ip` is the only header trusted for bucketing, and that is right: a
 * client can set ANY header, so `x-forwarded-for` is only as trustworthy as the
 * proxy in front of it — and Next's own server passes a client-supplied
 * `x-forwarded-for` straight through rather than overwriting it. (So does it
 * with `x-real-ip`; that header is trustworthy only because a correctly
 * configured reverse proxy overwrites it, which is the deployment's job, not
 * the app's.)
 *
 * The consequence nobody had accounted for: running the app directly — local
 * development, where there IS no proxy — means neither header is set by anyone
 * trustworthy, so every audit row recorded `unknown`. The forensic column was
 * empty in exactly the environment where someone is most likely to be reading
 * it while working out what a feature does.
 *
 * So the LABEL falls back in development only. The LIMITER does not: refusing
 * to bucket an unidentifiable request is a security property and stays.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import { clientIpLabel, getClientIp } from '@/cms/core/rate-limit';

const ORIGINAL_ENV = process.env.NODE_ENV;

function req(headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/cms/anything', { headers });
}

function setEnv(value: string) {
  // NODE_ENV is `readonly` in the types but an ordinary assignable env var at
  // runtime. `defineProperty` is refused on `process.env`, so assign through a
  // widened view of it.
  (process.env as Record<string, string>).NODE_ENV = value;
}

afterEach(() => setEnv(ORIGINAL_ENV ?? 'test'));

describe('getClientIp — used for rate limiting', () => {
  test('reads x-real-ip', () => {
    assert.equal(getClientIp(req({ 'x-real-ip': '203.0.113.7' })), '203.0.113.7');
  });

  test('never reads x-forwarded-for, in any environment', () => {
    /*
     * The whole point. Next passes a client-supplied `x-forwarded-for` through
     * unchanged, so honouring it would let anyone pick their own rate-limit
     * bucket — and with it, unlimited password guesses.
     */
    for (const env of ['development', 'production']) {
      setEnv(env);
      assert.equal(getClientIp(req({ 'x-forwarded-for': '1.2.3.4' })), null, env);
    }
  });

  test('returns null when nothing identifies the caller', () => {
    assert.equal(getClientIp(req()), null);
  });
});

describe('clientIpLabel — used for audit rows and logs', () => {
  test('prefers x-real-ip, exactly as the limiter does', () => {
    setEnv('production');
    assert.equal(clientIpLabel(req({ 'x-real-ip': '203.0.113.7' })), '203.0.113.7');
  });

  test('in PRODUCTION, an unidentified caller is still recorded as unknown', () => {
    /*
     * Deliberately unchanged. In production the app sits behind a proxy that
     * sets `x-real-ip`; if it did not, falling back to a spoofable header would
     * write an attacker-chosen address into the forensic record — worse than
     * recording nothing, because it looks authoritative.
     */
    setEnv('production');
    assert.equal(clientIpLabel(req()), 'unknown');
    assert.equal(clientIpLabel(req({ 'x-forwarded-for': '1.2.3.4' })), 'unknown');
  });

  test('in DEVELOPMENT, falls back to x-forwarded-for so local logs are readable', () => {
    // There is no proxy locally, and Next synthesises this header from the
    // socket. Recording it beats recording nothing on a screen someone is
    // reading precisely to understand what just happened.
    setEnv('development');
    assert.equal(clientIpLabel(req({ 'x-forwarded-for': '::ffff:127.0.0.1' })), '::ffff:127.0.0.1');
  });

  test('the development fallback takes the FIRST hop, not the whole chain', () => {
    // `x-forwarded-for` is a comma-separated list; storing it raw puts a list
    // in a column every reader treats as one address.
    setEnv('development');
    assert.equal(clientIpLabel(req({ 'x-forwarded-for': '198.51.100.9, 10.0.0.1' })), '198.51.100.9');
  });

  test('still unknown in development when there is nothing at all', () => {
    setEnv('development');
    assert.equal(clientIpLabel(req()), 'unknown');
  });
});
