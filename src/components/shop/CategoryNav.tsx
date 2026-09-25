import { Link } from '@/lib/i18n/routing';
import { cn } from '@/lib/utils';

export interface CategoryNavItem {
  slug: string;
  title: string;
  href: string;
}

const pill = (active: boolean) =>
  cn(
    'rounded-sm border px-3 py-1.5 font-body text-sm transition-colors',
    active
      ? 'border-warm-gold bg-warm-gold/15 text-warm-gold-deep'
      : 'border-border-soft text-text-primary hover:border-warm-gold hover:text-warm-gold-deep',
  );

/** Category filter row for the shop. `activeSlug` undefined = "all products". */
export function CategoryNav({
  categories,
  activeSlug,
  allLabel,
}: {
  categories: CategoryNavItem[];
  activeSlug?: string;
  allLabel: string;
}) {
  if (categories.length === 0) return null;
  return (
    <nav className="flex flex-wrap gap-2" aria-label="Categories">
      <Link href="/shop" className={pill(!activeSlug)}>
        {allLabel}
      </Link>
      {categories.map((c) => (
        <Link key={c.slug} href={c.href} className={pill(c.slug === activeSlug)}>
          {c.title}
        </Link>
      ))}
    </nav>
  );
}
