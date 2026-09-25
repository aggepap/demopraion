/**
 * Telling a repeat signup apart from a new one.
 *
 * The endpoint used to answer identically whichever it was, on purpose: an
 * endpoint that says "already subscribed" also answers "is this person on your
 * list?" for any address someone can type. That is now a deliberate trade — a
 * visitor who signs up twice was being told "you're subscribed" a second time,
 * which reads as though the first one had not worked. The per-IP budget on the
 * route is what bounds the probing it opens up.
 *
 * Three outcomes rather than two, and the third is the one worth getting right:
 * somebody who unsubscribed and is coming back has genuinely just subscribed,
 * and telling them they are "already subscribed" would be both wrong and
 * discouraging.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { subscribeOutcome } from '@/cms/modules/newsletter/logic';

describe('subscribeOutcome', () => {
  test('a brand-new address has just subscribed', () => {
    assert.equal(subscribeOutcome(null), 'subscribed');
    assert.equal(subscribeOutcome(undefined), 'subscribed');
  });

  test('an address already on the list is already on the list', () => {
    assert.equal(subscribeOutcome({ unsubscribedAt: null }), 'already-subscribed');
  });

  test('someone coming back after unsubscribing has subscribed, not "already"', () => {
    // They asked to leave and have now asked to return. That is a signup, and
    // the row has to be reactivated for it — see `subscribe`.
    assert.equal(
      subscribeOutcome({ unsubscribedAt: new Date('2026-01-01T00:00:00Z') }),
      'resubscribed',
    );
  });

  test('only the already-subscribed case is not a success', () => {
    // The forms branch on exactly this: two of the three show the success
    // state, and one shows the new message.
    const successes = ['subscribed', 'resubscribed'];
    assert.equal(successes.includes(subscribeOutcome(null)), true);
    assert.equal(successes.includes(subscribeOutcome({ unsubscribedAt: new Date() })), true);
    assert.equal(successes.includes(subscribeOutcome({ unsubscribedAt: null })), false);
  });
});
