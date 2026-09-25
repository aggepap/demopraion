import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { redirectMatches, redirectWouldLoop } from '@/cms/core/seo/match';

/**
 * What a redirect rule catches.
 *
 * Three rules were permanently inert because of this comparison alone, and a browser test
 * can only see that through a whole request — which is why each of those findings took a
 * live probe to notice and none of them could be pinned down to a case. Here they are cases.
 *
 * The same function answers the question at request time and at write time (the loop check),
 * because two different notions of "what does this rule catch" is exactly how a cycle got
 * past the guard (F-051).
 */

test('a literal rule matches its own path and nothing else', () => {
  assert.equal(redirectMatches('/old', 'literal', '/old'), true);
  assert.equal(redirectMatches('/old', 'literal', '/older'), false);
  assert.equal(redirectMatches('/old', 'literal', '/old/deeper'), false);
});

test('a trailing slash on either side is the same path (F-055)', () => {
  // The app runs `trailingSlash: false`, so Next strips it before the proxy is consulted:
  // a rule stored with one could never fire, and the visible 308 was Next's own doing.
  assert.equal(redirectMatches('/old/', 'literal', '/old'), true);
  assert.equal(redirectMatches('/old', 'literal', '/old/'), true);
  assert.equal(redirectMatches('/old///', 'literal', '/old'), true);
});

test('the root is not stripped to the empty string', () => {
  assert.equal(redirectMatches('/', 'literal', '/'), true);
  assert.equal(redirectMatches('/', 'literal', '/something'), false);
});

test('a percent-encoded request matches a rule written in real characters (F-054)', () => {
  // A browser sends non-ASCII encoded and `nextUrl.pathname` hands it over that way, while
  // the admin stored the characters themselves — so the rule never fired.
  assert.equal(redirectMatches('/δοκιμή', 'literal', '/%CE%B4%CE%BF%CE%BA%CE%B9%CE%BC%CE%AE'), true);
  assert.equal(redirectMatches('/a b', 'literal', '/a%20b'), true);
});

test('a malformed escape is compared as it arrived rather than throwing', () => {
  // `decodeURIComponent('%')` throws. Failing to match is acceptable; taking the request
  // down over a bad URL is not.
  assert.doesNotThrow(() => redirectMatches('/x', 'literal', '/%'));
  assert.equal(redirectMatches('/%', 'literal', '/%'), true);
});

test('a wildcard catches the subtree and the bare prefix', () => {
  assert.equal(redirectMatches('/docs/*', 'wildcard', '/docs'), true);
  assert.equal(redirectMatches('/docs/*', 'wildcard', '/docs/a'), true);
  assert.equal(redirectMatches('/docs/*', 'wildcard', '/docs/a/b'), true);
  // Not a sibling that merely starts with the same letters — that was F-050's mistake one
  // layer up, and it must not be reintroduced here.
  assert.equal(redirectMatches('/docs/*', 'wildcard', '/docsearch'), false);
});

test('a wildcard written without /* is treated as the prefix it plainly meant (F-053)', () => {
  // The write path refuses this shape now; a row stored before that guard existed must not
  // silently behave as a literal, which is what made a whole subtree look covered.
  assert.equal(redirectMatches('/docs', 'wildcard', '/docs'), true);
  assert.equal(redirectMatches('/docs', 'wildcard', '/docs/a'), true);
  assert.equal(redirectMatches('/docs', 'wildcard', '/docsearch'), false);
});

test('a regex rule matches by pattern', () => {
  assert.equal(redirectMatches('^/p/\\d+$', 'regex', '/p/42'), true);
  assert.equal(redirectMatches('^/p/\\d+$', 'regex', '/p/abc'), false);
});

test('an invalid regex matches nothing instead of throwing', () => {
  assert.doesNotThrow(() => redirectMatches('([', 'regex', '/x'));
  assert.equal(redirectMatches('([', 'regex', '/x'), false);
});

test('a regex is not handed an unbounded subject (F-052 defence in depth)', () => {
  /*
   * The write boundary refuses a nested quantifier, but a row stored before that guard — or
   * written straight into the database — must not be able to run against an arbitrarily long
   * path. Matching runs synchronously on the thread that serves everyone.
   */
  const long = `/${'a'.repeat(300)}`;
  assert.equal(redirectMatches('^/a+$', 'regex', long), false);
  assert.equal(redirectMatches('^/a+$', 'regex', `/${'a'.repeat(100)}`), true);
});

test('an unknown kind matches nothing', () => {
  // A row with a kind this version does not understand must be inert, not a wildcard.
  assert.equal(redirectMatches('/x', 'something-else', '/x'), false);
});

describe('redirectWouldLoop', () => {
  const rule = (source: string, target: string, kind = 'literal') => ({ source, target, kind });

  test('a rule onto itself loops, trailing slash or not', () => {
    assert.equal(redirectWouldLoop([], '/a', '/a'), true);
    assert.equal(redirectWouldLoop([], '/a/', '/a'), true);
  });

  test('a chain that comes back through existing rules loops', () => {
    assert.equal(redirectWouldLoop([rule('/b', '/c'), rule('/c', '/a')], '/a', '/b'), true);
    assert.equal(redirectWouldLoop([rule('/b/*', '/a', 'wildcard')], '/a', '/b/x'), true);
  });

  test('a chain that ends somewhere else does not', () => {
    assert.equal(redirectWouldLoop([rule('/b', '/c')], '/a', '/b'), false);
    assert.equal(redirectWouldLoop([], '/a', '/b'), false);
  });
});
