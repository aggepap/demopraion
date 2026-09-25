/**
 * `COMMERCE_CRON_SECRET` authorises the abandoned-cart reminder route, which
 * sends real email. It had no minimum length, so a short, guessable secret was
 * accepted — unlike `CMS_CRON_SECRET` and `BOOKING_CRON_SECRET`, which refuse
 * anything under `CRON_SECRET_MIN_LENGTH`. The route must use the same check.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { authorizeCronRequest, CRON_SECRET_MIN_LENGTH } from '../../src/cms/core/cron/policy';

const source = readFileSync(new URL('../../src/cms/modules/commerce/abandoned.ts', import.meta.url), 'utf8');

function fnBody(text: string, name: string): string {
  const start = text.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const next = text.indexOf('\nexport ', start + 1);
  return text.slice(start, next < 0 ? undefined : next);
}

test('the reminder route checks COMMERCE_CRON_SECRET with authorizeCronRequest', () => {
  const body = fnBody(source, 'abandonedRemindRoute');
  assert.match(
    body,
    /authorizeCronRequest\(req\.headers\.get\('x-cron-secret'\), process\.env\.COMMERCE_CRON_SECRET\)/,
  );
  assert.doesNotMatch(body, /timingSafeEquals/);
});

test('a short secret authorises nothing, even when the header matches it', () => {
  const short = 'x'.repeat(CRON_SECRET_MIN_LENGTH - 1);
  assert.equal(authorizeCronRequest(short, short), false);
  const long = 'x'.repeat(CRON_SECRET_MIN_LENGTH);
  assert.equal(authorizeCronRequest(long, long), true);
});
