/**
 * Google reviews and hand-entered testimonials.
 *
 * Off by default (`googleReviews` module). Two sources, one table, and a
 * nightly sync — see `sync.ts` for why the reviews are stored rather than
 * fetched per page view.
 */
export {
  filterExternalReviews,
  GOOGLE_REVIEWS_KEY,
  mapGbpReview,
  mapPlacesReview,
  parseGoogleReviewsConfig,
  starRatingToNumber,
  type ExternalReviewRow,
  type GoogleReviewLocation,
  type GoogleReviewsConfig,
  type MappedReview,
  type ReviewQuery,
  type ReviewSort,
  type ReviewSource,
} from './mapping';
export {
  exchangeGbpCode,
  fetchGbpReviews,
  fetchPlacesReviews,
  gbpAuthorizeUrl,
  GBP_SCOPE,
  GOOGLE_SECRET_KEYS,
} from './google';
export {
  getGoogleReviewsConfig,
  syncAllReviewLocations,
  syncReviewLocation,
  type SyncResult,
} from './sync';
export { listExternalReviews, listReviewLocations, REVIEWS_TAG, setReviewHidden } from './read';
export {
  googleOauthCallbackRoute,
  googleOauthStartRoute,
  publicReviews,
  reviewHideRoute,
  reviewLocationsRoute,
  reviewsExternalListRoute,
  reviewSyncRoute,
} from './routes';
