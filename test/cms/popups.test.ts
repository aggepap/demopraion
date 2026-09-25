import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  choosePopup,
  isPopupActive,
  matchesTarget,
  popupPagePath,
  shouldShowAgain,
  toPopupRecord,
  type PopupRecord,
} from '@/cms/modules/popups/policy';

/**
 * When a popup may appear.
 *
 * Four independent questions, kept apart because they fail differently: is it
 * published and in date, is this the right page, has this visitor seen it
 * recently, and — when several qualify — which one wins.
 *
 * The frequency rule is the one that decides whether the site is annoying.
 */

const popup = (over: Partial<PopupRecord> = {}): PopupRecord => ({
  id: 1,
  slug: 'offer',
  priority: 0,
  startAt: null,
  endAt: null,
  target: { mode: 'all', paths: [], exclude: [] },
  frequency: { mode: 'days', days: 7 },
  ...over,
});

const now = new Date('2026-09-17T12:00:00Z');

describe('isPopupActive', () => {
  test('no dates means always', () => {
    assert.equal(isPopupActive(popup(), now), true);
  });

  test('before it starts, and after it ends, it is not', () => {
    assert.equal(isPopupActive(popup({ startAt: new Date('2026-09-18T00:00:00Z') }), now), false);
    assert.equal(isPopupActive(popup({ endAt: new Date('2026-09-16T00:00:00Z') }), now), false);
  });

  test('inside the window it is', () => {
    const active = popup({
      startAt: new Date('2026-09-01T00:00:00Z'),
      endAt: new Date('2026-09-30T00:00:00Z'),
    });
    assert.equal(isPopupActive(active, now), true);
  });
});

describe('matchesTarget', () => {
  test('"all" is every page', () => {
    assert.equal(matchesTarget(popup(), { path: '/shop/thing' }), true);
  });

  test('a list of paths matches exactly', () => {
    const p = popup({ target: { mode: 'paths', paths: ['/', '/shop'], exclude: [] } });
    assert.equal(matchesTarget(p, { path: '/shop' }), true);
    assert.equal(matchesTarget(p, { path: '/shop/thing' }), false);
  });

  test('a trailing * matches a section', () => {
    const p = popup({ target: { mode: 'paths', paths: ['/shop/*'], exclude: [] } });
    assert.equal(matchesTarget(p, { path: '/shop/thing' }), true);
    assert.equal(matchesTarget(p, { path: '/blog/thing' }), false);
  });

  test('exclusions win over matches', () => {
    const p = popup({
      target: { mode: 'paths', paths: ['/shop/*'], exclude: ['/shop/secret'] },
    });
    assert.equal(matchesTarget(p, { path: '/shop/secret' }), false);
  });

  test('an exclusion applies to "all" too', () => {
    const p = popup({ target: { mode: 'all', paths: [], exclude: ['/checkout'] } });
    assert.equal(matchesTarget(p, { path: '/checkout' }), false);
    assert.equal(matchesTarget(p, { path: '/' }), true);
  });

  test('the query string is never part of the match', () => {
    const p = popup({ target: { mode: 'paths', paths: ['/shop'], exclude: [] } });
    assert.equal(matchesTarget(p, { path: '/shop?page=2' }), true);
  });

  test('a pattern is glob-like, never a regular expression', () => {
    // A `.*` typed by an admin must match the characters, not everything —
    // and must not be able to hang the server.
    const p = popup({ target: { mode: 'paths', paths: ['.*'], exclude: [] } });
    assert.equal(matchesTarget(p, { path: '/anything' }), false);
  });
});

describe('shouldShowAgain', () => {
  test('"every visit" always shows', () => {
    assert.equal(shouldShowAgain({ mode: 'always' }, null, now), true);
    assert.equal(shouldShowAgain({ mode: 'always' }, now, now), true);
  });

  test('"once" never shows twice', () => {
    assert.equal(shouldShowAgain({ mode: 'once' }, null, now), true);
    assert.equal(shouldShowAgain({ mode: 'once' }, new Date('2020-01-01T00:00:00Z'), now), false);
  });

  test('"every N days" waits exactly that long', () => {
    const rule = { mode: 'days' as const, days: 7 };
    assert.equal(shouldShowAgain(rule, new Date('2026-09-11T12:00:00Z'), now), false);
    assert.equal(shouldShowAgain(rule, new Date('2026-09-10T11:00:00Z'), now), true);
  });

  test('a seen date in the future is not trusted', () => {
    // It comes from the visitor's own localStorage, which they can edit.
    assert.equal(
      shouldShowAgain({ mode: 'days', days: 7 }, new Date('2030-01-01T00:00:00Z'), now),
      true
    );
  });
});

describe('choosePopup', () => {
  test('the highest priority wins', () => {
    const chosen = choosePopup(
      [popup({ id: 1, priority: 0 }), popup({ id: 2, priority: 10 })],
      { path: '/' },
      now,
      () => true
    );
    assert.equal(chosen?.id, 2);
  });

  test('ties break on the newer popup, so a replacement takes over', () => {
    const chosen = choosePopup(
      [popup({ id: 1, priority: 5 }), popup({ id: 2, priority: 5 })],
      { path: '/' },
      now,
      () => true
    );
    assert.equal(chosen?.id, 2);
  });

  test('one that does not target this page is not chosen', () => {
    const chosen = choosePopup(
      [popup({ id: 1, priority: 10, target: { mode: 'paths', paths: ['/other'], exclude: [] } })],
      { path: '/' },
      now,
      () => true
    );
    assert.equal(chosen, null);
  });

  test('one this visitor has already seen is skipped for the next in line', () => {
    const chosen = choosePopup(
      [popup({ id: 1, priority: 10 }), popup({ id: 2, priority: 1 })],
      { path: '/' },
      now,
      (p) => p.id !== 1
    );
    assert.equal(chosen?.id, 2);
  });

  test('nothing qualifying means nothing shown', () => {
    assert.equal(
      choosePopup([], { path: '/' }, now, () => true),
      null
    );
  });
});

describe('targeting ignores the locale prefix', () => {
  // `usePathname` from next/navigation returns the URL as the browser has it, so
  // a popup aimed at `/shop` never matched `/en/shop`.
  const locales = ['el', 'en'];

  test('strips a known locale segment', () => {
    assert.equal(popupPagePath('/en/shop', locales), '/shop');
    assert.equal(popupPagePath('/en/shop/item', locales), '/shop/item');
    assert.equal(popupPagePath('/en', locales), '/');
    assert.equal(popupPagePath('/shop', locales), '/shop');
    assert.equal(popupPagePath('/english', locales), '/english');
  });

  test('a /shop target matches the English shop', () => {
    const p = toPopupRecord(1, 'p', { target: { mode: 'paths', paths: '/shop' } });
    assert.equal(matchesTarget(p, { path: popupPagePath('/en/shop', locales) }), true);
  });
});

describe('the end date is inclusive', () => {
  // `new Date('2026-03-10')` is midnight UTC at the START of that day, so a
  // campaign "ending 10 March" vanished as 10 March began.
  test('a date-only end runs to the end of that day (UTC)', () => {
    const p = toPopupRecord(1, 'p', { endAt: '2026-03-10' });
    assert.equal(p.endAt?.toISOString(), '2026-03-10T23:59:59.999Z');
    assert.equal(isPopupActive(p, new Date('2026-03-10T18:00:00Z')), true);
    assert.equal(isPopupActive(p, new Date('2026-03-11T00:00:00Z')), false);
  });

  test('a start date still starts at the beginning of its day', () => {
    const p = toPopupRecord(1, 'p', { startAt: '2026-03-10' });
    assert.equal(p.startAt?.toISOString(), '2026-03-10T00:00:00.000Z');
  });
});
