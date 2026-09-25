import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

/**
 * `/api/contact` and `/api/cookies/consent` used a second, older limiter in
 * `src/lib/rate-limit.ts` that put every request without `x-real-ip` into one
 * shared `'unknown'` bucket — so behind a proxy that does not set the header, one
 * visitor's submissions spent everyone's budget (and a flood from anywhere was
 * one bucket). The core limiter stopped doing that: in production it refuses an
 * unidentifiable request and warns once. Both routes now use the core limiter.
 */
const ROUTES = ['src/app/api/contact/route.ts', 'src/app/api/cookies/consent/route.ts'];

describe('public endpoints use the core rate limiter', () => {
  for (const path of ROUTES) {
    test(path, () => {
      const src = readFileSync(path, 'utf8');
      assert.match(src, /import \{ checkRateLimit, getClientIp \} from '@\/cms\/core\/rate-limit';/);
      assert.doesNotMatch(src, /@\/lib\/rate-limit/);
    });
  }

  test('the site-level limiter with the shared bucket is gone', () => {
    assert.equal(existsSync('src/lib/rate-limit.ts'), false);
  });

  test('the limits are unchanged', () => {
    assert.match(readFileSync(ROUTES[0], 'utf8'), /RATE_LIMIT = \{ max: 5, windowMs: 60 \* 1000 \}/);
    assert.match(readFileSync(ROUTES[1], 'utf8'), /RATE_LIMIT = \{ max: 20, windowMs: 60 \* 1000 \}/);
  });
});
