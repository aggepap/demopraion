import 'server-only';

import { eq } from 'drizzle-orm';

import { CMS_CACHE_REVALIDATE } from '../../core/cache';
import { getDb, schema } from '../../db';
import { filterExternalReviews, type ExternalReviewRow, type ReviewQuery } from './mapping';

/**
 * Reading the synced reviews for the public site.
 *
 * Everything is read once and filtered in memory: a site has tens of reviews,
 * not thousands, and the shortcode's own filters (location, minimum rating,
 * limit) are exactly the kind of thing that turns into four nearly identical
 * SQL queries otherwise.
 */
export const REVIEWS_TAG = 'cms:reviews-external';

export async function listExternalReviews(query: ReviewQuery & { location?: string } = {}) {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.reviewsExternal.id,
      locationId: schema.reviewsExternal.locationId,
      source: schema.reviewsExternal.source,
      externalId: schema.reviewsExternal.externalId,
      authorName: schema.reviewsExternal.authorName,
      photoMediaId: schema.reviewsExternal.photoMediaId,
      rating: schema.reviewsExternal.rating,
      text: schema.reviewsExternal.text,
      publishedAt: schema.reviewsExternal.publishedAt,
      ownerReply: schema.reviewsExternal.ownerReply,
      hidden: schema.reviewsExternal.hidden,
    })
    .from(schema.reviewsExternal)
    .limit(500);

  let locationId = query.locationId;
  if (query.location && query.location !== 'all') {
    const [location] = await db
      .select({ id: schema.reviewLocations.id })
      .from(schema.reviewLocations)
      .where(eq(schema.reviewLocations.slug, query.location))
      .limit(1);
    // A shortcode naming a location that does not exist shows nothing, rather
    // than silently showing every location's reviews.
    if (!location) return [];
    locationId = location.id;
  }

  return filterExternalReviews(
    rows.map((row) => ({ ...row, text: row.text ?? '' })) as ExternalReviewRow[],
    { ...query, locationId }
  );
}

export async function listReviewLocations() {
  return getDb().select().from(schema.reviewLocations).orderBy(schema.reviewLocations.id);
}

/** Hide or unhide one review. The text itself is never editable. */
export async function setReviewHidden(id: number, hidden: boolean) {
  await getDb()
    .update(schema.reviewsExternal)
    .set({ hidden })
    .where(eq(schema.reviewsExternal.id, id));
}

export { CMS_CACHE_REVALIDATE };
