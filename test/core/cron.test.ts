import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import {
  authorizeCronRequest,
  CRON_SECRET_MIN_LENGTH,
  isValidCronJobName,
  resolveCronJob,
  type CronJobDef,
} from '@/cms/core/cron/policy';

/**
 * Scheduled jobs are run by an external scheduler calling
 * `POST /api/cms/cron/<job>` with a shared secret. Nothing else authorises them:
 * a job sends email, cancels orders and calls paid APIs, so the default for any
 * misconfiguration is "refuse".
 */

const secret = 'x'.repeat(CRON_SECRET_MIN_LENGTH);

describe('authorizeCronRequest', () => {
  test('accepts the exact secret', () => {
    assert.equal(authorizeCronRequest(secret, secret), true);
  });

  test('refuses a wrong, missing or empty header', () => {
    assert.equal(authorizeCronRequest('y'.repeat(CRON_SECRET_MIN_LENGTH), secret), false);
    assert.equal(authorizeCronRequest(null, secret), false);
    assert.equal(authorizeCronRequest('', secret), false);
  });

  test('refuses everything when the secret is unset or too short', () => {
    // An empty configured secret must not match an empty header.
    assert.equal(authorizeCronRequest('', ''), false);
    assert.equal(authorizeCronRequest(undefined as unknown as string, undefined), false);
    assert.equal(authorizeCronRequest('short', 'short'), false);
  });
});

describe('isValidCronJobName', () => {
  test('kebab-case names only', () => {
    assert.equal(isValidCronJobName('commerce-stale-orders'), true);
    for (const bad of ['', 'Upper', 'with space', '../x', 'a_b', '-lead', 'x'.repeat(65)]) {
      assert.equal(isValidCronJobName(bad), false, bad);
    }
  });
});

describe('resolveCronJob', () => {
  const run = async () => ({ done: 0 });
  const jobs: Record<string, CronJobDef> = {
    'commerce-stale-orders': { module: 'commerce', run },
    'core-thing': { run },
  };

  test('finds a job whose module is on', () => {
    const res = resolveCronJob(jobs, 'commerce-stale-orders', { commerce: true });
    assert.equal(res.kind, 'ok');
  });

  test('a job with no module is always available', () => {
    assert.equal(resolveCronJob(jobs, 'core-thing', {}).kind, 'ok');
  });

  test('an unknown job is not found', () => {
    assert.equal(resolveCronJob(jobs, 'nope', { commerce: true }).kind, 'not_found');
  });

  test('a job whose module is off is not found, not "forbidden"', () => {
    // Same answer as every other module-gated endpoint: the thing does not exist.
    assert.equal(resolveCronJob(jobs, 'commerce-stale-orders', { commerce: false }).kind, 'not_found');
    assert.equal(resolveCronJob(jobs, 'commerce-stale-orders', {}).kind, 'not_found');
  });

  test('prototype keys are not jobs', () => {
    for (const name of ['constructor', 'toString', '__proto__']) {
      assert.equal(resolveCronJob(jobs, name, {}).kind, 'not_found', name);
    }
  });
});

describe('the unified job map', () => {
  // The booking expiry sweep had only its legacy endpoint (and its own secret),
  // so a site wiring one scheduler entry per job from this map never lapsed a
  // stale enquiry or released an abandoned hold.
  const src = readFileSync('src/app/api/cms/cron/[job]/route.ts', 'utf8');

  test('includes the booking expiry sweep, gated on the booking module', () => {
    assert.match(src, /'booking-expire':\s*\{\s*module:\s*'booking'/);
    assert.match(src, /expireStaleReservations\(\)/);
    assert.ok(isValidCronJobName('booking-expire'));
  });
});
