/**
 * `POST /api/cms/cron/[job]`, driven through the real route pipeline.
 *
 * Every refusal here is decided before a job runs or the database is touched,
 * so it is tested without one: a wrong or missing secret is a 401 whatever the
 * job name (the route must not tell a stranger which jobs exist), and an
 * unknown job or one whose module is off is a 404.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { NextRequest } from 'next/server';

import { CRON_SECRET_MIN_LENGTH } from '@/cms/core/cron/policy';
import { cronRoute } from '@/cms/core/cron/service';

const SECRET = 's'.repeat(CRON_SECRET_MIN_LENGTH);

/** A distinct client IP per request, so the route's rate limit never interferes. */
let seq = 0;
function post(headers: Record<string, string> = {}) {
  seq += 1;
  return new NextRequest('http://localhost/api/cms/cron/x', {
    method: 'POST',
    headers: { 'x-real-ip': `198.51.100.${seq}`, ...headers },
  });
}

const params = (job: string) => ({ params: Promise.resolve({ job }) });

let ran = 0;
const route = (flags: Record<string, boolean>) =>
  cronRoute({
    jobs: {
      'shop-job': {
        module: 'commerce',
        run: async () => {
          ran += 1;
          return {};
        },
      },
    },
    moduleFlags: async () => flags,
  });

beforeEach(() => {
  ran = 0;
  process.env.CMS_CRON_SECRET = SECRET;
});
afterEach(() => {
  delete process.env.CMS_CRON_SECRET;
});

describe('cron route', () => {
  test('no secret header is a 401, even for a real job', async () => {
    const res = await route({ commerce: true })(post(), params('shop-job'));
    assert.equal(res.status, 401);
    assert.equal(ran, 0);
  });

  test('a wrong secret is a 401, and so is a wrong secret for an unknown job', async () => {
    const wrong = { 'x-cron-secret': 'w'.repeat(CRON_SECRET_MIN_LENGTH) };
    assert.equal((await route({ commerce: true })(post(wrong), params('shop-job'))).status, 401);
    assert.equal((await route({ commerce: true })(post(wrong), params('nope'))).status, 401);
    assert.equal(ran, 0);
  });

  test('with CMS_CRON_SECRET unset, even an empty header is refused', async () => {
    delete process.env.CMS_CRON_SECRET;
    const res = await route({ commerce: true })(post({ 'x-cron-secret': '' }), params('shop-job'));
    assert.equal(res.status, 401);
  });

  test('the right secret and an unknown job is a 404', async () => {
    const res = await route({ commerce: true })(post({ 'x-cron-secret': SECRET }), params('nope'));
    assert.equal(res.status, 404);
  });

  test("the right secret and a job whose module is off is a 404, and it doesn't run", async () => {
    const res = await route({ commerce: false })(
      post({ 'x-cron-secret': SECRET }),
      params('shop-job')
    );
    assert.equal(res.status, 404);
    assert.equal(ran, 0);
  });

  test('a cross-site Origin does not matter — the secret is the authorisation', async () => {
    // A scheduler sends no Origin; a browser-issued POST without the secret
    // still fails on the secret, not on origin.
    const res = await route({ commerce: true })(
      post({ origin: 'https://evil.test' }),
      params('shop-job')
    );
    assert.equal(res.status, 401);
  });

  describe('in production, with no X-Real-IP (a scheduler calling 127.0.0.1 directly)', () => {
    const env = process.env as Record<string, string | undefined>;
    let nodeEnv: string | undefined;
    beforeEach(() => {
      nodeEnv = env.NODE_ENV;
      env.NODE_ENV = 'production';
    });
    afterEach(() => {
      env.NODE_ENV = nodeEnv;
    });
    const bare = (headers: Record<string, string> = {}) =>
      new NextRequest('http://127.0.0.1/api/cms/cron/x', { method: 'POST', headers });

    test('the right secret is not refused by the missing-IP rule', async () => {
      const res = await route({ commerce: true })(bare({ 'x-cron-secret': SECRET }), params('nope'));
      assert.equal(res.status, 404);
    });

    test('a wrong or missing secret still is — it gets no way round the limiter', async () => {
      const wrong = { 'x-cron-secret': 'w'.repeat(CRON_SECRET_MIN_LENGTH) };
      assert.equal((await route({ commerce: true })(bare(wrong), params('nope'))).status, 429);
      assert.equal((await route({ commerce: true })(bare(), params('nope'))).status, 429);
    });
  });
});
