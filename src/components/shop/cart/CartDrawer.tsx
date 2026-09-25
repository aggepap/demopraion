'use client';

import { Minus, Plus, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRef } from 'react';

import { useDialog } from '@/cms/admin/ui/use-dialog';
import { ButtonLink } from '@/components/ui/Button';
import { Link } from '@/lib/i18n/routing';
import { formatPrice } from '@/lib/money';
import { cn } from '@/lib/utils';

import { useCart } from './CartProvider';

/** Right-anchored slide-over cart. Rendered once in the layout; only active
 *  when commerce is enabled. Full modal a11y (scroll-lock, Escape, focus trap
 *  and restore) comes from the shared `useDialog` hook. */
export function CartDrawer({ commerceEnabled }: { commerceEnabled: boolean }) {
  const t = useTranslations('cart');
  const pageLocale = useLocale();
  const { items, subtotal, currency, isOpen, close, removeItem, setQty } = useCart();

  const panelRef = useRef<HTMLDivElement>(null);
  useDialog({ open: isOpen, onClose: close, panelRef });

  if (!commerceEnabled) return null;

  // The cart's own locale, or the page's when it is empty.
  const locale = items[0]?.locale ?? pageLocale;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('title')}
      // The drawer stays mounted so it can animate, so `visibility: hidden`
      // is the only thing keeping it out of the tab order. `aria-hidden` makes
      // that explicit for assistive tech — the same fix MobileMenu carries for
      // a previously-reported axe `aria-hidden-focus` violation.
      aria-hidden={!isOpen}
      className={cn(
        'fixed inset-0 z-[60] transition-[opacity,visibility] duration-200',
        isOpen ? 'visible opacity-100' : 'invisible opacity-0',
      )}
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label={t('close')}
        onClick={close}
        className="absolute inset-0 h-full w-full bg-black/40"
        tabIndex={isOpen ? 0 : -1}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className={cn(
          'absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-soft-pearl shadow-xl transition-transform duration-300',
          isOpen ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="flex items-center justify-between border-b border-border-soft px-6 py-4">
          <h2 className="font-display text-lg font-semibold text-midnight-navy">{t('title')}</h2>
          <button
            type="button"
            onClick={close}
            aria-label={t('close')}
            className="p-2 -m-2 text-midnight-navy hover:text-warm-gold-deep"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <p className="font-body text-text-muted">{t('empty')}</p>
            <Link
              href="/shop"
              onClick={close}
              className="font-body text-sm font-medium text-warm-gold-deep hover:underline"
            >
              {t('continueShopping')}
            </Link>
          </div>
        ) : (
          <>
            <ul className="flex-1 divide-y divide-border-soft overflow-y-auto px-6">
              {items.map((item) => (
                <li key={item.key} className="flex gap-3 py-4">
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-sm bg-bone-cream">
                    {item.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.imageUrl} alt={item.title} className="h-full w-full object-cover" />
                    ) : null}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="font-body text-sm font-medium text-midnight-navy">{item.title}</span>
                    {item.optionsLabel ? (
                      <span className="font-body text-xs text-text-muted">{item.optionsLabel}</span>
                    ) : null}
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex items-center rounded-sm border border-border-soft">
                        <button
                          type="button"
                          aria-label={t('decrease')}
                          onClick={() => setQty(item.key, item.quantity - 1)}
                          className="p-1.5 text-text-muted hover:text-midnight-navy"
                        >
                          <Minus className="h-3.5 w-3.5" aria-hidden />
                        </button>
                        <span className="w-8 text-center font-body text-sm">{item.quantity}</span>
                        <button
                          type="button"
                          aria-label={t('increase')}
                          onClick={() => setQty(item.key, item.quantity + 1)}
                          className="p-1.5 text-text-muted hover:text-midnight-navy"
                        >
                          <Plus className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeItem(item.key)}
                        className="font-body text-xs text-text-muted hover:text-red-600"
                      >
                        {t('remove')}
                      </button>
                    </div>
                  </div>
                  <span className="font-body text-sm font-medium text-midnight-navy">
                    {formatPrice(item.unitPrice * item.quantity, item.currency, item.locale)}
                  </span>
                </li>
              ))}
            </ul>

            <div className="border-t border-border-soft px-6 py-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="font-body text-sm text-text-muted">{t('subtotal')}</span>
                <span className="font-display text-lg font-semibold text-midnight-navy">
                  {formatPrice(subtotal, currency, locale)}
                </span>
              </div>
              <ButtonLink href="/checkout" variant="primary" size="sm" className="w-full" onClick={close}>
                {t('checkout')}
              </ButtonLink>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
