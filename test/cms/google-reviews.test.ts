import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  filterExternalReviews,
  mapGbpReview,
  mapPlacesReview,
  parseGoogleReviewsConfig,
  starRatingToNumber,
  type ExternalReviewRow,
} from '@/cms/modules/reviews-external/mapping';

/**
 * Turning two very different Google payloads into one row.
 *
 * The Business Profile API speaks in words (`FIVE`), Places in numbers, and
 * neither is trusted: a review that arrives without a rating or without any
 * text is not a review worth storing, and a star rating outside 1–5 means the
 * payload is not what we think it is.
 */

describe('starRatingToNumber', () => {
  test('reads the Business Profile enum', () => {
    assert.equal(starRatingToNumber('FIVE'), 5);
    assert.equal(starRatingToNumber('ONE'), 1);
  });

  test('reads a plain number from Places', () => {
    assert.equal(starRatingToNumber(4), 4);
    assert.equal(starRatingToNumber('4'), 4);
  });

  test('anything else is not a rating', () => {
    for (const raw of ['STAR_RATING_UNSPECIFIED', 'SIX', 0, 6, null, undefined, 'lots']) {
      assert.equal(starRatingToNumber(raw), null, JSON.stringify(raw));
    }
  });
});

describe('mapGbpReview', () => {
  const payload = {
    name: 'accounts/1/locations/2/reviews/abc',
    reviewId: 'abc',
    starRating: 'FIVE',
    comment: 'Πολύ καλή εξυπηρέτηση',
    createTime: '2026-09-01T10:00:00Z',
    reviewer: { displayName: 'Maria K.', profilePhotoUrl: 'https://lh3.googleusercontent.com/a/x' },
    reviewReply: { comment: 'Ευχαριστούμε!', updateTime: '2026-09-02T09:00:00Z' },
  };

  test('maps the fields the shop actually shows', () => {
    const row = mapGbpReview(payload, 7);
    assert.equal(row?.locationId, 7);
    assert.equal(row?.source, 'gbp');
    assert.equal(row?.externalId, 'abc');
    assert.equal(row?.rating, 5);
    assert.equal(row?.authorName, 'Maria K.');
    assert.equal(row?.text, 'Πολύ καλή εξυπηρέτηση');
    assert.equal(row?.ownerReply, 'Ευχαριστούμε!');
    assert.equal(row?.photoUrl, 'https://lh3.googleusercontent.com/a/x');
  });

  test('a rating with no comment is still a rating', () => {
    const row = mapGbpReview({ ...payload, comment: undefined }, 7);
    assert.equal(row?.text, '');
    assert.equal(row?.rating, 5);
  });

  test('refuses a payload with no id or no rating', () => {
    assert.equal(mapGbpReview({ ...payload, reviewId: undefined, name: undefined }, 7), null);
    assert.equal(mapGbpReview({ ...payload, starRating: 'STAR_RATING_UNSPECIFIED' }, 7), null);
  });

  test('falls back to the resource name for the id', () => {
    const row = mapGbpReview({ ...payload, reviewId: undefined }, 7);
    assert.equal(row?.externalId, 'accounts/1/locations/2/reviews/abc');
  });

  test('an anonymous reviewer gets no name rather than "undefined"', () => {
    const row = mapGbpReview({ ...payload, reviewer: {} }, 7);
    assert.equal(row?.authorName, '');
  });
});

describe('mapPlacesReview', () => {
  const payload = {
    name: 'places/ChIJx/reviews/r1',
    rating: 4,
    text: { text: 'Good coffee' },
    originalText: { text: 'Good coffee' },
    publishTime: '2026-08-20T08:00:00Z',
    authorAttribution: { displayName: 'John', photoUri: 'https://lh3.googleusercontent.com/a/y' },
  };

  test('maps a Places review', () => {
    const row = mapPlacesReview(payload, 3);
    assert.equal(row?.source, 'places');
    assert.equal(row?.rating, 4);
    assert.equal(row?.authorName, 'John');
    assert.equal(row?.text, 'Good coffee');
    assert.equal(row?.externalId, 'places/ChIJx/reviews/r1');
  });

  test('refuses one with no identity at all', () => {
    assert.equal(mapPlacesReview({ ...payload, name: undefined }, 3), null);
  });

  test('takes the localised text when the original is missing', () => {
    const row = mapPlacesReview({ ...payload, originalText: undefined }, 3);
    assert.equal(row?.text, 'Good coffee');
  });
});

describe('filterExternalReviews', () => {
  const row = (over: Partial<ExternalReviewRow> = {}): ExternalReviewRow => ({
    id: 1,
    locationId: 1,
    source: 'places',
    externalId: 'x',
    authorName: 'A',
    photoMediaId: null,
    rating: 5,
    text: 'Great',
    publishedAt: new Date('2026-09-01T00:00:00Z'),
    ownerReply: null,
    hidden: false,
    ...over,
  });

  test('hides what the admin hid', () => {
    const out = filterExternalReviews([row({ id: 1 }), row({ id: 2, hidden: true })], {});
    assert.deepEqual(
      out.map((r) => r.id),
      [1]
    );
  });

  test('applies a minimum rating', () => {
    const out = filterExternalReviews([row({ id: 1, rating: 5 }), row({ id: 2, rating: 3 })], {
      min: 4,
    });
    assert.deepEqual(
      out.map((r) => r.id),
      [1]
    );
  });

  test('newest first by default', () => {
    const out = filterExternalReviews(
      [
        row({ id: 1, publishedAt: new Date('2026-01-01T00:00:00Z') }),
        row({ id: 2, publishedAt: new Date('2026-09-01T00:00:00Z') }),
      ],
      {}
    );
    assert.deepEqual(
      out.map((r) => r.id),
      [2, 1]
    );
  });

  test('can sort by rating instead', () => {
    const out = filterExternalReviews([row({ id: 1, rating: 3 }), row({ id: 2, rating: 5 })], {
      sort: 'rating',
      min: 1,
    });
    assert.deepEqual(
      out.map((r) => r.id),
      [2, 1]
    );
  });

  test('limits, after filtering rather than before', () => {
    const out = filterExternalReviews(
      [row({ id: 1, rating: 2 }), row({ id: 2, rating: 5 }), row({ id: 3, rating: 5 })],
      { min: 4, limit: 1 }
    );
    assert.deepEqual(
      out.map((r) => r.id),
      [2]
    );
  });

  test('a location filter picks one place', () => {
    const out = filterExternalReviews(
      [row({ id: 1, locationId: 1 }), row({ id: 2, locationId: 2 })],
      {
        locationId: 2,
      }
    );
    assert.deepEqual(
      out.map((r) => r.id),
      [2]
    );
  });
});

describe('parseGoogleReviewsConfig', () => {
  test('unset is off', () => {
    const config = parseGoogleReviewsConfig(null);
    assert.equal(config.enabled, false);
    assert.deepEqual(config.locations, []);
  });

  test('keeps declared locations and bounds the numbers', () => {
    const config = parseGoogleReviewsConfig({
      enabled: true,
      minRating: 9,
      sort: 'nonsense',
      locations: [{ slug: 'loutraki', label: 'Loutraki', source: 'places', placeId: 'ChIJ1' }],
    });
    assert.equal(config.enabled, true);
    assert.equal(config.minRating, 5);
    assert.equal(config.sort, 'newest');
    assert.equal(config.locations[0].slug, 'loutraki');
  });

  test('drops a location with no slug, which could never be addressed', () => {
    const config = parseGoogleReviewsConfig({
      enabled: true,
      locations: [{ label: 'No slug', source: 'places' }],
    });
    assert.deepEqual(config.locations, []);
  });
});
