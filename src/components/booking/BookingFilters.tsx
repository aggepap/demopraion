'use client';

import { useState } from 'react';

import { usePathname, useRouter } from '@/lib/i18n/routing';

export interface FilterTerm {
  slug: string;
  title: string;
  count: number;
}

export interface FilterGroup {
  key: 'category' | 'type' | 'departure';
  label: string;
  terms: FilterTerm[];
  selected: string[];
}

/**
 * The listing facets.
 *
 * Every change navigates rather than mutating local state, so the URL is the
 * single source of truth for what is filtered and the view can be linked. The
 * only thing kept client-side is the type-to-narrow box inside each group,
 * which filters a list already delivered as props — no request, no round trip.
 *
 * Terms with no matches are not rendered at all: offering a filter that can only
 * ever return nothing wastes the one click it takes to discover that.
 */
export function BookingFilters({
  groups,
  labels,
}: {
  groups: FilterGroup[];
  labels: { filters: string; clear: string; search: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [needles, setNeedles] = useState<Record<string, string>>({});

  const usable = groups.filter((g) => g.terms.some((t) => t.count > 0));
  if (usable.length === 0) return null;

  const anySelected = groups.some((g) => g.selected.length > 0);

  function navigate(next: URLSearchParams) {
    // Any filter change invalidates the page number — page 4 of a narrower
    // result set is usually empty, which reads as "no matches".
    next.delete('page');
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function toggle(group: FilterGroup, slug: string) {
    const params = new URLSearchParams(window.location.search);
    const selected = new Set(group.selected);
    if (selected.has(slug)) selected.delete(slug);
    else selected.add(slug);

    if (selected.size === 0) params.delete(group.key);
    else params.set(group.key, [...selected].join(','));
    navigate(params);
  }

  function clearAll() {
    const params = new URLSearchParams(window.location.search);
    for (const g of groups) params.delete(g.key);
    params.delete('q');
    navigate(params);
  }

  return (
    <aside className="flex flex-col gap-6 lg:sticky lg:top-24">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold tracking-wider uppercase">
          {labels.filters}
        </h2>
        {anySelected ? (
          <button
            type="button"
            onClick={clearAll}
            className="text-warm-gold-deep text-xs hover:underline"
          >
            {labels.clear}
          </button>
        ) : null}
      </div>

      {usable.map((group) => {
        const needle = (needles[group.key] ?? '').toLowerCase();
        const visible = group.terms
          .filter((t) => t.count > 0)
          .filter((t) => !needle || t.title.toLowerCase().includes(needle));

        return (
          <div key={group.key} className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-neutral-900">{group.label}</h3>

            {group.terms.length > 8 ? (
              <input
                type="search"
                value={needles[group.key] ?? ''}
                onChange={(e) => setNeedles((n) => ({ ...n, [group.key]: e.target.value }))}
                placeholder={labels.search}
                aria-label={`${labels.search} — ${group.label}`}
                className="w-full rounded-sm border border-neutral-300 px-2 py-1 text-sm"
              />
            ) : null}

            <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
              {visible.map((term) => (
                <li key={term.slug}>
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-700">
                    <input
                      type="checkbox"
                      checked={group.selected.includes(term.slug)}
                      onChange={() => toggle(group, term.slug)}
                      className="h-4 w-4 rounded-sm border-neutral-300"
                    />
                    <span className="flex-1">{term.title}</span>
                    <span className="text-xs text-neutral-500">{term.count}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </aside>
  );
}
