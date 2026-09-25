import {
  type ContentDates as Dates,
  formatContentDate,
  hasBeenModified,
} from '@/lib/content-dates';
import type { Locale } from '@/lib/i18n/config';

const LABELS: Record<Locale, { published: string; modified: string }> = {
  el: { published: 'Δημοσιεύθηκε', modified: 'Ενημερώθηκε' },
  en: { published: 'Published', modified: 'Updated' },
};

interface ContentDatesProps {
  dates: Dates;
  locale: Locale;
  className?: string;
}

/**
 * Visible publication line for articles, answers and scenarios.
 *
 * "Updated" only appears once the content has actually been revised — a
 * page that has never changed shows its publication date alone rather than
 * repeating the same date twice.
 *
 * The `<time dateTime>` values are the raw `YYYY-MM-DD` strings, so the
 * machine-readable dates match the JSON-LD `datePublished` / `dateModified`
 * emitted by the same metadata. Google discounts schema dates it cannot
 * corroborate on the rendered page; this is what corroborates them.
 */
export function ContentDates({ dates, locale, className }: ContentDatesProps) {
  const labels = LABELS[locale];
  const modified = hasBeenModified(dates, locale);

  return (
    <p className={`font-body text-sm text-text-muted ${className ?? ''}`}>
      {labels.published}{' '}
      <time dateTime={dates.publishDate}>
        {formatContentDate(dates.publishDate, locale)}
      </time>
      {modified ? (
        <>
          {' · '}
          {labels.modified}{' '}
          <time dateTime={dates.modifiedDate[locale]}>
            {formatContentDate(dates.modifiedDate[locale], locale)}
          </time>
        </>
      ) : null}
    </p>
  );
}
