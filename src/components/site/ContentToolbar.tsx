import { useTranslations } from 'next-intl';

import { Link } from '@/lib/i18n/routing';
import type { ContentTerm } from '@/lib/site/content';

/**
 * Search and category filter above a content listing.
 *
 * A plain GET form, deliberately: it needs no JavaScript, it is operable from
 * the keyboard by default, and submitting it produces an ordinary URL — which
 * is the whole state of the listing, so the result can be linked and shared.
 * The alternative, a client component pushing router state, would buy nothing
 * here and would stop working before hydration.
 *
 * There is no hidden `page` field. A new search has to start at page one; a
 * carried-over page would pin someone to page 4 of results that no longer have
 * four pages.
 *
 * `namespace` names the message namespace (`blog`, `faq`, `cases`) so the
 * component does not depend on any one collection's strings existing.
 */
export function ContentToolbar({
  namespace,
  basePath,
  q,
  category,
  categories,
  total,
}: {
  namespace: string;
  /** The unfiltered listing, e.g. `/blog` — where "clear" goes. */
  basePath: string;
  q: string;
  category: string;
  categories: readonly ContentTerm[];
  /** Matches in the current view, stated so the result count is not a surprise. */
  total: number;
}) {
  const t = useTranslations(namespace);
  const filtered = q.length > 0 || category.length > 0;

  return (
    <div className="mt-10 flex flex-wrap items-end justify-between gap-4">
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="content-search" className="font-body text-xs uppercase tracking-wider-2 text-text-muted">
            {t('search')}
          </label>
          <input
            id="content-search"
            type="search"
            name="q"
            defaultValue={q}
            placeholder={t('searchPlaceholder')}
            className="w-56 rounded-sm border border-border-soft bg-white px-3 py-2 font-body text-sm focus:border-warm-gold focus:outline-none focus:ring-1 focus:ring-warm-gold"
          />
        </div>

        {categories.length > 0 ? (
          <div className="flex flex-col gap-1">
            <label
              htmlFor="content-category"
              className="font-body text-xs uppercase tracking-wider-2 text-text-muted"
            >
              {t('filterByCategory')}
            </label>
            <select
              id="content-category"
              name="category"
              defaultValue={category}
              className="rounded-sm border border-border-soft bg-white px-3 py-2 font-body text-sm focus:border-warm-gold focus:outline-none focus:ring-1 focus:ring-warm-gold"
            >
              <option value="">{t('allCategories')}</option>
              {categories.map((term) => (
                <option key={term.slug} value={term.slug}>
                  {term.title}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <button
          type="submit"
          className="rounded-sm border border-border-soft px-4 py-2 font-body text-sm transition-colors hover:border-warm-gold"
        >
          {t('searchSubmit')}
        </button>
      </form>

      {filtered ? (
        <div className="flex items-center gap-4">
          <p role="status" className="font-body text-sm text-text-muted">
            {t('results', { count: total })}
          </p>
          <Link href={basePath} className="font-body text-sm text-text-muted underline underline-offset-4 hover:text-text-primary">
            {t('clear')}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
