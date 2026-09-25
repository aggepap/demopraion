import type { ProductBadge } from '@/cms/modules/commerce';
import { ProductBadges } from '@/components/shop/ProductBadges';
import { QuickViewButton } from '@/components/shop/QuickViewButton';
import { CompareToggle } from '@/components/shop/compare/CompareToggle';
import { WishlistButton } from '@/components/shop/wishlist/WishlistButton';
import { Link } from '@/lib/i18n/routing';
import { formatPrice } from '@/lib/money';

/** Card projection shared by the shop grid and category pages. */
export interface ProductCardData {
  /** Document id — what the wishlist saves. */
  id: number;
  slug: string;
  title: string;
  subtitle?: string;
  price: number;
  currency: string;
  compareAtPrice?: number;
  image?: { image?: string; alt?: string };
  href: string;
  badges?: ProductBadge[];
}

/**
 * One product card (`<li>`), locale-aware price + link. The quick-view + compare
 * controls sit OUTSIDE the `<Link>` (a button/checkbox nested in an anchor is
 * invalid HTML) and overlay the image on hover.
 */
export function ProductCard({
  product,
  locale,
  quickView = true,
  compare = true,
  wishlist = true,
}: {
  product: ProductCardData;
  locale: string;
  quickView?: boolean;
  compare?: boolean;
  /** The button hides itself when the wishlist is off; this is for callers
   *  that do not want it even when it is on (the wishlist page itself). */
  wishlist?: boolean;
}) {
  return (
    <li className="group relative">
      <Link href={product.href} className="block">
        <div className="relative aspect-square overflow-hidden rounded-sm bg-bone-cream">
          {product.badges?.length ? (
            <ProductBadges badges={product.badges} className="absolute left-3 top-3 z-10" />
          ) : null}
          {product.image?.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/cms/media/file/${product.image.image}`}
              alt={product.image.alt || product.title}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-text-muted">
              <span className="font-body text-sm">{product.title}</span>
            </div>
          )}
        </div>
        <div className="pt-4">
          <h2 className="font-display text-lg font-medium text-midnight-navy group-hover:text-warm-gold-deep">
            {product.title}
          </h2>
          {product.subtitle ? (
            <p className="mt-0.5 font-body text-sm text-text-muted">{product.subtitle}</p>
          ) : null}
          <p className="mt-2 font-body text-base font-medium text-text-primary">
            {product.compareAtPrice && product.compareAtPrice > product.price ? (
              <span className="mr-2 text-text-muted line-through">
                {formatPrice(product.compareAtPrice, product.currency, locale)}
              </span>
            ) : null}
            {formatPrice(product.price, product.currency, locale)}
          </p>
        </div>
      </Link>

      {wishlist ? (
        <div className="absolute top-3 right-3 z-10 translate-y-11 transition-opacity group-hover:opacity-100 sm:opacity-0">
          <WishlistButton productId={product.id} />
        </div>
      ) : null}
      {compare ? (
        <div className="absolute right-3 top-3 z-10 opacity-0 transition-opacity group-hover:opacity-100">
          <CompareToggle slug={product.slug} title={product.title} />
        </div>
      ) : null}
      {quickView ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex aspect-square items-end justify-center pb-3 opacity-0 transition-opacity group-hover:opacity-100">
          <div className="pointer-events-auto">
            <QuickViewButton slug={product.slug} locale={locale} />
          </div>
        </div>
      ) : null}
    </li>
  );
}
