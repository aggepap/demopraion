import assert from 'node:assert/strict';
import { test } from 'node:test';

import { robotsRules } from '@/app/robots';

/**
 * F-059 — the "extra Disallow" setting reaches the emitted rules.
 *
 * Tested here rather than over HTTP because the production gate in `robots.ts`
 * reads `NEXT_PUBLIC_SITE_URL`, which is inlined at build time: on a dev host the
 * whole file is a blanket `Disallow: /` and the branch that consults the setting is
 * unreachable from a request. That unobservable branch is exactly why the field sat
 * unread — described on the Settings screen as "appended to the generated
 * robots.txt", and appended to nothing.
 */

const paths = (rules: ReturnType<typeof robotsRules>, agent: string): string[] => {
  const list = Array.isArray(rules) ? rules : [rules];
  const rule = list.find((r) => r?.userAgent === agent);
  assert.ok(rule, `expected a rule for ${agent}`);
  const disallow = rule.disallow;
  return Array.isArray(disallow) ? disallow : disallow ? [disallow] : [];
};

test('an extra Disallow path is appended for the wildcard rule', () => {
  const rules = robotsRules(['/private-area']);
  assert.deepEqual(paths(rules, '*'), ['/api/', '/admin/', '/private-area']);
});

test('the same paths apply to the AI crawlers, not just the wildcard', () => {
  const rules = robotsRules(['/private-area']);
  for (const agent of ['GPTBot', 'ClaudeBot', 'PerplexityBot']) {
    assert.ok(
      paths(rules, agent).includes('/private-area'),
      `${agent} must be denied the same paths as the wildcard rule`,
    );
  }
});

test('nothing configured leaves the two permanent exclusions alone', () => {
  assert.deepEqual(paths(robotsRules([]), '*'), ['/api/', '/admin/']);
});

test('a path that is already permanently blocked is not emitted twice', () => {
  // A duplicate `Disallow:` line is not wrong, but it reads as a mistake in a file
  // people inspect by eye, and the admin gains nothing by repeating it.
  assert.deepEqual(paths(robotsRules(['/admin/', '/x']), '*'), ['/api/', '/admin/', '/x']);
});
