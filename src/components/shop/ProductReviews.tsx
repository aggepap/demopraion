import { getTranslations } from 'next-intl/server';

import type { PublicReview, RatingAggregate } from '@/cms/modules/commerce';
import { ReviewForm } from '@/components/shop/ReviewForm';
import { ReviewStars } from '@/components/shop/ReviewStars';
import type { Locale } from '@/lib/i18n/config';

/**
 * The PDP reviews block: the average summary, the approved review list, and the
 * submission form. Server component — it renders the moderated data and hands
 * only the small interactive form off to the client.
 */
export async function ProductReviews({
  productSlug,
  locale,
  aggregate,
  reviews,
}: {
  productSlug: string;
  locale: Locale;
  aggregate: RatingAggregate;
  reviews: PublicReview[];
}) {
  const t = await getTranslations({ locale, namespace: 'reviews' });
  const dateFmt = new Intl.DateTimeFormat(locale === 'el' ? 'el-GR' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return (
    <section id="reviews" className="mt-16 max-w-3xl scroll-mt-24">
      <h2 className="font-display text-2xl font-semibold text-midnight-navy">{t('title')}</h2>

      {/* Summary */}
      <div className="mt-4 flex items-center gap-3">
        {aggregate.count > 0 ? (
          <>
            <ReviewStars value={aggregate.average} size={20} />
            <span className="font-display text-lg font-semibold text-midnight-navy">
              {aggregate.average.toFixed(1)}
            </span>
            <span className="font-body text-sm text-text-muted">
              {t('basedOn', { count: aggregate.count })}
            </span>
          </>
        ) : (
          <p className="font-body text-sm text-text-muted">{t('noReviews')}</p>
        )}
      </div>

      {/* List */}
      {reviews.length > 0 ? (
        <ul className="mt-8 flex flex-col divide-y divide-border-soft border-t border-border-soft">
          {reviews.map((r) => (
            <li key={r.id} className="py-5">
              <div className="flex flex-wrap items-center gap-2">
                <ReviewStars value={r.rating} size={14} />
                <span className="font-body text-sm font-medium text-text-primary">{r.authorName}</span>
                {r.verified ? (
                  <span className="inline-flex items-center rounded-sm bg-green-100 px-1.5 py-0.5 font-body text-[11px] font-medium text-green-800">
                    {t('verifiedPurchase')}
                  </span>
                ) : null}
                <span className="ml-auto font-body text-xs text-text-muted">
                  {dateFmt.format(new Date(r.createdAt))}
                </span>
              </div>
              {r.title ? (
                <h3 className="mt-2 font-body text-sm font-semibold text-midnight-navy">{r.title}</h3>
              ) : null}
              <p className="mt-1 whitespace-pre-wrap font-body text-sm text-text-primary">{r.body}</p>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Submission form */}
      <div className="mt-10 rounded-sm border border-border-soft bg-white p-6">
        <ReviewForm productSlug={productSlug} locale={locale} />
      </div>
    </section>
  );
}
