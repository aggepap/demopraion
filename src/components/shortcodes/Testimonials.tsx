import { localizedText } from '@/cms/core/content/localized';
import { listPublishedDocuments } from '@/cms/core/read';
import config from '@/site.config';

import { ReviewStars } from './ReviewStars';

export interface TestimonialCard {
  name: string;
  role: string;
  /** "What they said" is a localized field: resolved to this page's language. */
  quote: string;
  rating: number | null;
  photo: string;
}

/**
 * One stored testimonial, ready to show. The quote is stored per language, and
 * went through `String()` as "[object Object]" before this.
 */
export function testimonialCard(data: unknown, locale: string, defaultLocale: string): TestimonialCard {
  const d = (data ?? {}) as Record<string, unknown>;
  const rating = Number(d.rating);
  return {
    name: localizedText(d.title, locale, defaultLocale),
    role: localizedText(d.role, locale, defaultLocale),
    quote: localizedText(d.quote, locale, defaultLocale),
    rating: d.rating !== '' && Number.isInteger(rating) && rating > 0 ? rating : null,
    photo: typeof d.photo === 'string' ? d.photo : '',
  };
}

/**
 * Quotes the owner typed in, placed by `[testimonials]`.
 *
 * Deliberately a different component from the Google one: these are the
 * business's own collected words, so they carry no Google attribution and no
 * "verified" implication.
 */
export async function Testimonials({
  layout = 'grid',
  limit = 6,
  locale = 'el',
}: {
  layout?: 'grid' | 'carousel';
  limit?: number;
  locale?: string;
}) {
  const docs = await listPublishedDocuments('testimonial', locale, { limit });
  if (docs.length === 0) return null;

  return (
    <ul
      className={
        layout === 'grid'
          ? 'my-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3'
          : 'my-8 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2'
      }
    >
      {docs.slice(0, limit).map((doc) => {
        const { name, role, quote, rating, photo } = testimonialCard(doc.data, locale, config.defaultLocale);
        return (
          <li
            key={doc.id}
            className={`border-border-soft flex flex-col gap-2 rounded-sm border bg-white p-4 ${
              layout === 'grid' ? '' : 'w-72 shrink-0 snap-start'
            }`}
          >
            {rating ? <ReviewStars rating={rating} /> : null}
            <blockquote className="font-body text-text-primary text-sm">{quote}</blockquote>
            <div className="flex items-center gap-2">
              {photo ? (
                // eslint-disable-next-line @next/next/no-img-element -- our own media route
                <img
                  src={`/api/cms/media/file/${encodeURIComponent(photo)}`}
                  alt=""
                  width={32}
                  height={32}
                  className="h-8 w-8 rounded-full object-cover"
                />
              ) : null}
              <p className="font-body text-text-muted text-xs">
                <span className="text-text-primary font-medium">{name}</span>
                {role ? ` — ${role}` : ''}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
