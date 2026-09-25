import { Link } from '@/lib/i18n/routing';
import { formatPrice } from '@/lib/money';

import { QuickInfoList } from './QuickInfoList';

export interface BookingCardItem {
  slug: string;
  title: string;
  subtitle?: string;
  href: string;
  image?: string;
  fromPrice: number | null;
  kind?: 'transport' | 'stay';
  quickInfo: { icon?: string; label: string; value: string; suffix?: string }[];
}

/**
 * One experience in the listing.
 *
 * The price is a "from" figure — the cheapest the item can be, before the
 * customer picks a date or an option — so it is labelled as one. An item with
 * no price says so plainly rather than showing nothing, because a card with a
 * blank where a price belongs reads as broken.
 *
 * A stay's figure is PER NIGHT and says so. "from €180" next to "from €450" is
 * an unfair comparison when one is a night and the other a whole day's charter.
 */
export function BookingCard({
  item,
  currency,
  locale,
  labels,
}: {
  item: BookingCardItem;
  currency: string;
  locale: string;
  labels: {
    fromPrice: (price: string) => string;
    fromPriceNight: (price: string) => string;
    onRequest: string;
    viewDetails: string;
  };
}) {
  return (
    <article className="group flex flex-col overflow-hidden rounded-sm border border-neutral-200 bg-white transition-shadow hover:shadow-md">
      <Link href={item.href} className="block aspect-[4/3] overflow-hidden bg-neutral-100">
        {item.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- media is served by uuid through the CMS route, not a static import
          <img
            src={`/api/cms/media/file/${item.image}`}
            alt=""
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            loading="lazy"
          />
        ) : null}
      </Link>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="font-display text-lg leading-tight font-semibold">
          <Link href={item.href} className="hover:text-warm-gold-deep">
            {item.title}
          </Link>
        </h3>

        {item.subtitle ? <p className="text-sm text-neutral-600">{item.subtitle}</p> : null}

        <QuickInfoList items={item.quickInfo} className="mt-1" />

        <div className="mt-auto flex items-baseline justify-between pt-3">
          <span className="text-sm font-medium text-neutral-900">
            {item.fromPrice == null
              ? labels.onRequest
              : item.kind === 'stay'
                ? labels.fromPriceNight(formatPrice(item.fromPrice, currency, locale))
                : labels.fromPrice(formatPrice(item.fromPrice, currency, locale))}
          </span>
          <Link
            href={item.href}
            className="text-warm-gold-deep text-sm font-medium hover:underline"
          >
            {labels.viewDetails}
          </Link>
        </div>
      </div>
    </article>
  );
}
