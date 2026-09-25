import 'server-only';

import { and, eq } from 'drizzle-orm';

import { fetchRemoteImage, toWebp } from '../../core/media/image';
import { uploadMedia } from '../../core/media/service';
import { getSetting } from '../../core/settings';
import { getDb, schema } from '../../db';
import {
  GOOGLE_REVIEWS_KEY,
  mapGbpReview,
  mapPlacesReview,
  parseGoogleReviewsConfig,
  type MappedReview,
} from './mapping';
import { fetchGbpReviews, fetchPlacesReviews } from './google';

/**
 * Bringing Google's reviews into the database.
 *
 * Upserted by `(location, external id)`, so running the sync twice changes
 * nothing and a review edited on Google's side is corrected here. The admin's
 * `hidden` flag is never overwritten: hiding a review is a decision about this
 * site, not a fact about the review.
 *
 * A failure is recorded on the location rather than thrown away — a sync that
 * quietly stopped working looks exactly like a business nobody reviews.
 */

/** Google serves reviewer photos from these hosts. */
const PHOTO_HOSTS = ['*.googleusercontent.com', '*.ggpht.com', 'lh3.googleusercontent.com'];
const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
const PHOTO_WIDTH = 96;

export async function getGoogleReviewsConfig() {
  return parseGoogleReviewsConfig(await getSetting(GOOGLE_REVIEWS_KEY));
}

/**
 * Re-host one reviewer photo as a local WebP.
 *
 * The point is not the file size: it is that a page showing Google's own URL
 * makes every visitor's browser call Google before they have answered the
 * cookie banner. Returns null on any failure — a review without a portrait is
 * still a review.
 */
async function storePhoto(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const raw = await fetchRemoteImage(url, {
      allowHosts: PHOTO_HOSTS,
      maxBytes: PHOTO_MAX_BYTES,
      timeoutMs: 8000,
    });
    const webp = await toWebp(raw, { maxWidth: PHOTO_WIDTH });
    const media = await uploadMedia(
      { buffer: webp, originalName: 'reviewer.webp', mime: 'image/webp' },
      // No administrator uploaded this; the sync did.
      null
    );
    return media.uuid;
  } catch (err) {
    console.error('[cms/reviews] reviewer photo failed', err);
    return null;
  }
}

async function upsertReview(review: MappedReview): Promise<void> {
  const db = getDb();
  const [existing] = await db
    .select({ id: schema.reviewsExternal.id, photoMediaId: schema.reviewsExternal.photoMediaId })
    .from(schema.reviewsExternal)
    .where(
      and(
        eq(schema.reviewsExternal.locationId, review.locationId),
        eq(schema.reviewsExternal.externalId, review.externalId)
      )
    )
    .limit(1);

  // Only fetched once: re-downloading every portrait on every nightly sync
  // would be thousands of pointless requests to Google.
  const photoMediaId = existing?.photoMediaId ?? (await storePhoto(review.photoUrl));

  const values = {
    locationId: review.locationId,
    source: review.source,
    externalId: review.externalId,
    authorName: review.authorName,
    photoMediaId,
    rating: review.rating,
    text: review.text,
    publishedAt: review.publishedAt,
    ownerReply: review.ownerReply,
    ownerReplyAt: review.ownerReplyAt,
  };

  if (existing) {
    // `hidden` is deliberately absent: it is the admin's decision, not Google's.
    await db
      .update(schema.reviewsExternal)
      .set(values)
      .where(eq(schema.reviewsExternal.id, existing.id));
  } else {
    await db.insert(schema.reviewsExternal).values(values);
  }
}

export interface SyncResult {
  location: string;
  fetched: number;
  stored: number;
  error?: string;
}

/** Sync one location. Never throws: the error is recorded and returned. */
export async function syncReviewLocation(locationId: number): Promise<SyncResult> {
  const db = getDb();
  const [location] = await db
    .select()
    .from(schema.reviewLocations)
    .where(eq(schema.reviewLocations.id, locationId))
    .limit(1);
  if (!location) return { location: String(locationId), fetched: 0, stored: 0, error: 'not found' };

  try {
    const payloads =
      location.source === 'gbp'
        ? await fetchGbpReviews(location.resourceName ?? '')
        : await fetchPlacesReviews(location.placeId ?? '');

    const mapped = payloads
      .map((payload) =>
        location.source === 'gbp'
          ? mapGbpReview(payload, location.id)
          : mapPlacesReview(payload, location.id)
      )
      .filter((review): review is MappedReview => review !== null);

    for (const review of mapped) await upsertReview(review);

    await db
      .update(schema.reviewLocations)
      .set({ lastSyncedAt: new Date(), lastError: null })
      .where(eq(schema.reviewLocations.id, location.id));

    return { location: location.slug, fetched: payloads.length, stored: mapped.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sync failed.';
    await db
      .update(schema.reviewLocations)
      .set({ lastSyncedAt: new Date(), lastError: message.slice(0, 500) })
      .where(eq(schema.reviewLocations.id, location.id));
    return { location: location.slug, fetched: 0, stored: 0, error: message };
  }
}

/** The nightly job: every enabled location, one after another. */
export async function syncAllReviewLocations(): Promise<{ results: SyncResult[] }> {
  const config = await getGoogleReviewsConfig();
  if (!config.enabled) return { results: [] };

  const locations = await getDb()
    .select({ id: schema.reviewLocations.id })
    .from(schema.reviewLocations)
    .where(eq(schema.reviewLocations.enabled, true));

  const results: SyncResult[] = [];
  // Sequential on purpose: Google's per-minute quotas are small, and a nightly
  // job has all night.
  for (const location of locations) results.push(await syncReviewLocation(location.id));
  return { results };
}
