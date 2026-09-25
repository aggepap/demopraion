'use client';

import { useState } from 'react';

import { usePathname, useRouter } from '@/lib/i18n/routing';

/**
 * Title search + sort + the result count.
 *
 * The search box is a form that navigates on submit rather than searching as
 * you type: the results are server-rendered, so a request per keystroke would
 * be a request per keystroke.
 */
export function BookingToolbar({
  q,
  sort,
  labels,
}: {
  q: string;
  sort: string;
  labels: {
    searchPlaceholder: string;
    sortLabel: string;
    /** Already rendered by the server. A `(count) => string` here crossed the
     *  server/client boundary as a function and threw "Functions cannot be
     *  passed directly to Client Components", 500-ing the whole listing. */
    resultCount: string;
    sortOptions: { value: string; label: string }[];
  };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [term, setTerm] = useState(q);

  function navigate(mutate: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(window.location.search);
    mutate(params);
    params.delete('page');
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 pb-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          navigate((p) => (term.trim() ? p.set('q', term.trim()) : p.delete('q')));
        }}
        className="flex items-center gap-2"
      >
        <input
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={labels.searchPlaceholder}
          aria-label={labels.searchPlaceholder}
          className="rounded-sm border border-neutral-300 px-3 py-1.5 text-sm"
        />
      </form>

      <p className="text-sm text-neutral-600" aria-live="polite">
        {labels.resultCount}
      </p>

      <label className="flex items-center gap-2 text-sm">
        <span className="text-neutral-600">{labels.sortLabel}</span>
        <select
          value={sort}
          onChange={(e) => navigate((p) => p.set('sort', e.target.value))}
          className="rounded-sm border border-neutral-300 px-2 py-1.5 text-sm"
        >
          {labels.sortOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
