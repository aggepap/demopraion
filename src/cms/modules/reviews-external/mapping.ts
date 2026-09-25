/**
 * Two Google payloads, one row.
 *
 * The Business Profile API (`gbp`) returns every review for a location the
 * owner has connected, with star ratings as words. The Places API returns at
 * most five, with numeric ratings. Neither is trusted: a payload missing an id
 * or a usable rating is dropped rather than stored as a half review.
 *
 * Pure — the fetching, the tokens and the photo download live elsewhere.
 */

export type ReviewSource = 'gbp' | 'places';
export type ReviewSort = 'newest' | 'rating';

export interface MappedReview {
  locationId: number;
  source: ReviewSource;
  externalId: string;
  authorName: string;
  /** Remote URL; the sync downloads it and stores a local WebP instead. */
  photoUrl: string | null;
  rating: number;
  text: string;
  publishedAt: Date;
  ownerReply: string | null;
  ownerReplyAt: Date | null;
}

export interface ExternalReviewRow {
  id: number;
  locationId: number;
  source: ReviewSource;
  externalId: string;
  authorName: string;
  photoMediaId: string | null;
  rating: number;
  text: string;
  publishedAt: Date;
  ownerReply: string | null;
  hidden: boolean;
}

const GBP_STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

/** A rating, or `null` for anything that is not one. */
export function starRatingToNumber(raw: unknown): number | null {
  if (typeof raw === 'string' && raw in GBP_STARS) return GBP_STARS[raw];
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isInteger(value) && value >= 1 && value <= 5 ? value : null;
}

function asDate(raw: unknown): Date {
  const value = typeof raw === 'string' ? new Date(raw) : null;
  return value && !Number.isNaN(value.getTime()) ? value : new Date();
}

const text = (raw: unknown): string => (typeof raw === 'string' ? raw.trim() : '');

/** A review from the Business Profile API (the `reviews` list under a location). */
export function mapGbpReview(
  payload: Record<string, unknown>,
  locationId: number
): MappedReview | null {
  const externalId = text(payload.reviewId) || text(payload.name);
  const rating = starRatingToNumber(payload.starRating);
  if (!externalId || rating === null) return null;

  const reviewer = (payload.reviewer ?? {}) as Record<string, unknown>;
  const reply = (payload.reviewReply ?? {}) as Record<string, unknown>;

  return {
    locationId,
    source: 'gbp',
    externalId,
    authorName: text(reviewer.displayName),
    photoUrl: text(reviewer.profilePhotoUrl) || null,
    rating,
    // A star rating with no words is a perfectly ordinary review.
    text: text(payload.comment),
    publishedAt: asDate(payload.createTime),
    ownerReply: text(reply.comment) || null,
    ownerReplyAt: reply.updateTime ? asDate(reply.updateTime) : null,
  };
}

/** A review from the Places API (New). At most five per place, and read-only. */
export function mapPlacesReview(
  payload: Record<string, unknown>,
  locationId: number
): MappedReview | null {
  const externalId = text(payload.name);
  const rating = starRatingToNumber(payload.rating);
  if (!externalId || rating === null) return null;

  const author = (payload.authorAttribution ?? {}) as Record<string, unknown>;
  const original = (payload.originalText ?? {}) as Record<string, unknown>;
  const localized = (payload.text ?? {}) as Record<string, unknown>;

  return {
    locationId,
    source: 'places',
    externalId,
    authorName: text(author.displayName),
    photoUrl: text(author.photoUri) || null,
    rating,
    // Prefer what the reviewer wrote over Google's translation of it.
    text: text(original.text) || text(localized.text),
    publishedAt: asDate(payload.publishTime),
    // Places does not return the owner's reply.
    ownerReply: null,
    ownerReplyAt: null,
  };
}

export interface ReviewQuery {
  locationId?: number;
  min?: number;
  sort?: ReviewSort;
  limit?: number;
}

/**
 * What a shortcode actually shows. Hidden reviews are gone for everyone, the
 * minimum rating and the location narrow, and the limit applies LAST — a limit
 * taken before filtering would show three reviews when six qualified.
 */
export function filterExternalReviews(
  rows: readonly ExternalReviewRow[],
  query: ReviewQuery
): ExternalReviewRow[] {
  const min = query.min ?? 1;
  const filtered = rows.filter(
    (row) =>
      !row.hidden &&
      row.rating >= min &&
      (query.locationId === undefined || row.locationId === query.locationId)
  );
  const sorted = [...filtered].sort((a, b) =>
    query.sort === 'rating'
      ? b.rating - a.rating || b.publishedAt.getTime() - a.publishedAt.getTime()
      : b.publishedAt.getTime() - a.publishedAt.getTime()
  );
  return query.limit ? sorted.slice(0, query.limit) : sorted;
}

export interface GoogleReviewLocation {
  slug: string;
  label: string;
  source: ReviewSource;
  /** Places only. */
  placeId: string;
  /** Business Profile only: `accounts/x/locations/y`. */
  resourceName: string;
}

export interface GoogleReviewsConfig {
  enabled: boolean;
  minRating: number;
  sort: ReviewSort;
  locations: GoogleReviewLocation[];
}

/** The `site_settings` key holding the (structured JSON) reviews config. */
export const GOOGLE_REVIEWS_KEY = 'integrations.googleReviews';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function parseGoogleReviewsConfig(raw: unknown): GoogleReviewsConfig {
  const value = (raw ?? {}) as Record<string, unknown>;
  const rawLocations = Array.isArray(value.locations) ? value.locations : [];
  const minRating = Number(value.minRating);
  const sort = value.sort === 'rating' ? 'rating' : 'newest';

  return {
    enabled: value.enabled === true,
    minRating: Number.isInteger(minRating) ? Math.min(5, Math.max(1, minRating)) : 1,
    sort,
    locations: rawLocations
      .map((entry) => (entry ?? {}) as Record<string, unknown>)
      .filter((entry) => typeof entry.slug === 'string' && SLUG.test(entry.slug))
      .map((entry) => ({
        slug: String(entry.slug),
        label: typeof entry.label === 'string' ? entry.label : String(entry.slug),
        source: entry.source === 'gbp' ? 'gbp' : 'places',
        placeId: typeof entry.placeId === 'string' ? entry.placeId : '',
        resourceName: typeof entry.resourceName === 'string' ? entry.resourceName : '',
      })),
  };
}
