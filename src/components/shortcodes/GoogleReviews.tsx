import { publicReviews } from '@/cms/modules/reviews-external';

import { ReviewStars } from './ReviewStars';

/**
 * Reviews from Google, placed by `[google-reviews]`.
 *
 * A server component: the reviews are already in our own database (see the
 * sync), so there is nothing to fetch in the browser and nothing for a visitor
 * to wait on.
 *
 * **No Review or AggregateRating structured data.** Google's own guidelines
 * refuse "self-serving" review markup — a business marking up reviews of
 * itself — and publishing it risks a manual action on the whole site.
 * Attribution to Google is required and is rendered below.
 */
export async function GoogleReviews({
  layout = 'carousel',
  location = 'all',
  limit = 6,
  min = 1,
}: {
  layout?: 'carousel' | 'grid' | 'badge';
  location?: string;
  limit?: number;
  min?: number;
}) {
  const reviews = await publicReviews({ location, limit, min });
  if (reviews.length === 0) return null;

  const average = reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length;

  if (layout === 'badge') {
    return (
      <aside className="border-border-soft my-6 flex w-fit items-center gap-3 rounded-sm border bg-white px-4 py-3">
        <ReviewStars rating={Math.round(average)} />
        <span className="font-body text-text-primary text-sm font-medium">
          {average.toFixed(1)} / 5
        </span>
        <span className="font-body text-text-muted text-xs">{reviews.length} Google reviews</span>
      </aside>
    );
  }

  return (
    <section className="my-8">
      <ul
        className={
          layout === 'grid'
            ? 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3'
            : // "Carousel" without JavaScript: a scroll-snapping row works with
              // a trackpad, a touch screen and the keyboard, and needs nothing.
              'flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2'
        }
      >
        {reviews.map((review) => (
          <li
            key={review.id}
            className={`border-border-soft flex flex-col gap-2 rounded-sm border bg-white p-4 ${
              layout === 'grid' ? '' : 'w-72 shrink-0 snap-start'
            }`}
          >
            <div className="flex items-center gap-2">
              {review.photoMediaId ? (
                // eslint-disable-next-line @next/next/no-img-element -- our own media route
                <img
                  src={`/api/cms/media/file/${review.photoMediaId}`}
                  alt=""
                  width={32}
                  height={32}
                  className="h-8 w-8 rounded-full object-cover"
                />
              ) : null}
              <span className="font-body text-text-primary text-sm font-medium">
                {review.authorName || 'Google user'}
              </span>
            </div>
            <ReviewStars rating={review.rating} />
            {review.text ? (
              <p className="font-body text-text-muted text-sm">{review.text}</p>
            ) : null}
            {review.ownerReply ? (
              <p className="border-border-soft font-body text-text-muted border-l-2 pl-3 text-xs">
                {review.ownerReply}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      {/* Required by Google's terms wherever their reviews are shown. */}
      <p className="font-body text-text-muted mt-2 text-xs">Reviews from Google</p>
    </section>
  );
}
