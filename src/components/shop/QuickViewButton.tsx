'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useId, useRef, useState } from 'react';

import { useDialog } from '@/cms/admin/ui/use-dialog';
import {
  ProductShowcase,
  type GroupedComponentView,
  type ShowcaseAttribute,
  type ShowcaseImage,
  type ShowcaseVariation,
} from '@/components/shop/ProductShowcase';
import type { GiftCardOffer } from '@/components/shop/GiftCardBuyBox';
import { Link } from '@/lib/i18n/routing';

/**
 * "Quick view" (addendum §6). A per-card trigger that, on click, fetches the
 * product's showcase data and shows the full buy box in a modal — no page
 * navigation. Reuses `ProductShowcase`, so variations / quantity / digital /
 * external all behave exactly as on the product page. The modal machinery only
 * mounts + fetches when opened.
 */

interface QuickViewData {
  id: number;
  slug: string;
  title: string;
  subtitle?: string;
  images: ShowcaseImage[];
  attributes: ShowcaseAttribute[];
  variations: ShowcaseVariation[];
  basePrice: number;
  compareAt?: number;
  currency: string;
  baseAvailability: string;
  badges?: { kind: 'sale' | 'new' | 'bestseller' | 'custom'; label?: string }[];
  external?: { url: string; label: string };
  grouped?: GroupedComponentView[];
  digital?: { includes: string[] };
  quantityRules?: { min: number; max: number | null; step: number; soldIndividually: boolean };
  giftCard?: GiftCardOffer;
}

export function QuickViewButton({ slug, locale }: { slug: string; locale: string }) {
  const t = useTranslations('shop');
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<QuickViewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = useCallback(() => setOpen(false), []);
  useDialog({ open, onClose: close, panelRef });

  async function openModal(e: React.MouseEvent) {
    e.preventDefault(); // the card is a link — don't navigate
    setOpen(true);
    if (data) return;
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/cms/commerce/quick-view?slug=${encodeURIComponent(slug)}&locale=${locale}`);
      const body = await res.json();
      if (!res.ok || !body?.ok) throw new Error('failed');
      setData(body.data as QuickViewData);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="rounded-sm bg-white/95 px-3 py-1.5 font-body text-xs font-medium text-midnight-navy shadow-sm hover:bg-white"
      >
        {t('quickView')}
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-midnight-navy/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          // The card behind this is a `<Link>`; without stopping propagation a
          // backdrop click closed the modal *and* navigated to the product page.
          onClick={(e) => {
            e.stopPropagation();
            close();
          }}
        >
          <div
            ref={panelRef}
            className="relative max-h-[90vh] w-full max-w-4xl overflow-auto rounded-sm bg-soft-pearl p-6 md:p-8"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id={titleId} className="sr-only">
              {data?.title ?? t('quickView')}
            </h2>
            <button
              type="button"
              onClick={close}
              aria-label={t('close')}
              className="absolute right-4 top-4 z-10 rounded-sm px-2 py-1 font-body text-sm text-text-muted hover:text-midnight-navy"
            >
              ✕
            </button>

            {loading ? (
              <p className="py-16 text-center font-body text-sm text-text-muted">…</p>
            ) : error || !data ? (
              <p className="py-16 text-center font-body text-sm text-text-muted">{t('noResults')}</p>
            ) : (
              <>
                <ProductShowcase
                  productId={data.id}
                  slug={data.slug}
                  title={data.title}
                  subtitle={data.subtitle}
                  images={data.images}
                  attributes={data.attributes}
                  variations={data.variations}
                  basePrice={data.basePrice}
                  compareAt={data.compareAt}
                  currency={data.currency}
                  locale={locale}
                  baseAvailability={data.baseAvailability}
                  badges={data.badges}
                  external={data.external}
                  grouped={data.grouped}
                  digital={data.digital}
                  quantityRules={data.quantityRules}
                  giftCard={data.giftCard}
                />
                <div className="mt-6">
                  <Link
                    href={`/shop/${data.slug}`}
                    className="font-body text-sm text-warm-gold-deep hover:underline"
                  >
                    {t('viewDetails')} →
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
