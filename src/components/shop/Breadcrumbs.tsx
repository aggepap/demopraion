import { Link } from '@/lib/i18n/routing';

/**
 * Visible breadcrumb trail for the storefront (Shop → Category → Product).
 * Server-safe. The matching `BreadcrumbList` JSON-LD is emitted separately by
 * each page from the same items, so the visible trail and the structured data
 * never drift.
 *
 * The last item is the current page and renders as plain text (no link); every
 * earlier item links to its `href`.
 */
export interface Crumb {
  label: string;
  /** Site-relative href (no locale prefix — `Link` adds it). Omit on the last. */
  href?: string;
}

export function Breadcrumbs({ items, className = '' }: { items: Crumb[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-1.5 font-body text-sm text-text-muted">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={`${item.label}-${i}`} className="flex items-center gap-1.5">
              {item.href && !isLast ? (
                <Link href={item.href} className="hover:text-warm-gold-deep">
                  {item.label}
                </Link>
              ) : (
                <span className={isLast ? 'text-text-primary' : undefined} aria-current={isLast ? 'page' : undefined}>
                  {item.label}
                </span>
              )}
              {isLast ? null : <span aria-hidden="true">/</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
