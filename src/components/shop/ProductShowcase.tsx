'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import type { ProductBadge } from '@/cms/modules/commerce';
import { GiftCardBuyBox, type GiftCardOffer } from '@/components/shop/GiftCardBuyBox';
import { WishlistButton } from '@/components/shop/wishlist/WishlistButton';
import { useCart } from '@/components/shop/cart/CartProvider';
import { ProductBadges } from '@/components/shop/ProductBadges';
import { ReviewStars } from '@/components/shop/ReviewStars';
import { resolveActiveGallery } from '@/components/shop/variant-gallery';
import { clampQuantity, type QuantityRules } from '@/cms/modules/commerce/quantity';
import { Button, safeHref } from '@/components/ui/Button';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { Link } from '@/lib/i18n/routing';
import { formatPrice } from '@/lib/money';

/**
 * Interactive product buy box + gallery. Selecting one value per attribute axis
 * resolves the matching generated variation and reflects its price, stock/
 * availability and image (WooCommerce-style). Kept client-side because the
 * selection is interactive; the server page resolves media UUIDs to URLs and
 * passes plain data in.
 */

export interface ShowcaseImage {
  url: string;
  alt: string;
}
export interface ShowcaseValue {
  id: string;
  label: string;
  color?: string;
  imageUrl?: string;
  /** Variant gallery ("photo per colour") — swaps the whole gallery when selected. */
  gallery?: ShowcaseImage[];
}
export interface ShowcaseAttribute {
  id: string;
  name: string;
  swatchType: string;
  values: ShowcaseValue[];
}
export interface ShowcaseVariation {
  id: string;
  /** Maps attribute id → selected value id. */
  options: Record<string, string>;
  price?: number;
  stock?: number;
  sku?: string;
  enabled?: boolean;
  imageUrl?: string;
}

interface Props {
  /** Document id — what the wishlist saves (a slug can be renamed). */
  productId: number;
  slug: string;
  title: string;
  subtitle?: string;
  images: ShowcaseImage[];
  attributes: ShowcaseAttribute[];
  variations: ShowcaseVariation[];
  basePrice: number;
  compareAt?: number;
  currency: string;
  locale: string;
  /** Product-level availability enum, used when no variation is resolved. */
  baseAvailability: string;
  /** Merchandising badges (Sale / New / …), resolved server-side. */
  badges?: ProductBadge[];
  /** Approved-review summary; when present, shows stars linking to the reviews. */
  rating?: { average: number; count: number };
  /** When true, show a "Size guide" link anchoring to the on-page chart. */
  hasSizeGuide?: boolean;
  /** External / affiliate product (§5): a "Buy on X" link replaces the cart. */
  external?: { url: string; label: string };
  /** Grouped product (§5): its components; "Add all" replaces the single cart button. */
  grouped?: GroupedComponentView[];
  /** Digital product (§5): shows a no-shipping note + the included file names. */
  digital?: { includes: string[] };
  /** Purchase limits (§6): min / max / step / sold-individually. */
  quantityRules?: QuantityRules;
  /** Gift card product: the shop's amounts; the gift card form replaces the cart button. */
  giftCard?: GiftCardOffer;
}

/** A grouped product's component, projected for the buy box. */
export interface GroupedComponentView {
  slug: string;
  title: string;
  quantity: number;
  unitPrice: number;
  imageUrl?: string;
  href: string;
  availability: string;
}

const AVAILABILITY_TONE: Record<string, string> = {
  'in-stock': 'bg-green-100 text-green-800',
  'out-of-stock': 'bg-neutral-200 text-neutral-600',
  preorder: 'bg-amber-100 text-amber-800',
  'made-to-order': 'bg-amber-100 text-amber-800',
};

const isEnabled = (v: ShowcaseVariation) => v.enabled !== false;

export function ProductShowcase({
  productId,
  slug,
  title,
  subtitle,
  images,
  attributes,
  variations,
  basePrice,
  compareAt,
  currency,
  locale,
  baseAvailability,
  badges = [],
  rating,
  hasSizeGuide = false,
  external,
  grouped,
  digital,
  quantityRules,
  giftCard,
}: Props) {
  const t = useTranslations('shop');
  const tCart = useTranslations('cart');
  const { addItem, open } = useCart();
  const hasVariations = variations.length > 0 && attributes.length > 0;

  // Seed the selection from the first enabled variation so the buy box shows a
  // coherent price/image on load.
  const [selected, setSelected] = useState<Record<string, string>>(() => {
    if (!hasVariations) return {};
    const seed = variations.find(isEnabled) ?? variations[0];
    return seed ? { ...seed.options } : {};
  });
  const [activeThumb, setActiveThumb] = useState(0);

  // Quantity (§6). Absent rules → a plain 1..∞ stepper; the stepper is hidden
  // for sold-individually products (always 1).
  const qRules = quantityRules ?? { min: 1, max: null, step: 1, soldIndividually: false };
  const [qty, setQty] = useState(qRules.min);
  const bumpQty = (delta: number) => setQty((q) => clampQuantity(qRules, q + delta * qRules.step));

  const allSelected = attributes.every((a) => selected[a.id]);
  const matched = useMemo(() => {
    if (!hasVariations || !allSelected) return undefined;
    return variations.find((v) => attributes.every((a) => v.options[a.id] === selected[a.id]));
  }, [hasVariations, allSelected, variations, attributes, selected]);

  /** A value is selectable if some enabled variation carries it together with
   *  the currently-selected values of the OTHER axes. */
  const isValueAvailable = (attrId: string, valueId: string): boolean => {
    if (!hasVariations) return true;
    return variations.some((v) => {
      if (!isEnabled(v)) return false;
      if (v.options[attrId] !== valueId) return false;
      return attributes.every(
        (a) => a.id === attrId || !selected[a.id] || v.options[a.id] === selected[a.id],
      );
    });
  };

  const price = matched?.price ?? basePrice;
  const showCompare = compareAt != null && compareAt > price;

  // Availability: driven by the resolved variation when one exists, else the
  // product-level enum.
  let availabilityKey = baseAvailability;
  if (hasVariations) {
    if (!matched) {
      availabilityKey = 'select';
    } else if (!isEnabled(matched) || matched.stock === 0) {
      availabilityKey = 'out-of-stock';
    } else {
      availabilityKey = 'in-stock';
    }
  }

  // Variant gallery ("photo per colour"): the selected colour's gallery swaps
  // the whole strip; `resolveActiveGallery` returns the base `images` array by
  // identity when no selected value carries one.
  const activeGallery = useMemo(
    () => resolveActiveGallery(attributes, selected, images),
    [attributes, selected, images],
  );
  const usingVariantGallery = activeGallery !== images;
  const galleryKey = activeGallery.map((g) => g.url).join('|');
  // Reset the active thumbnail whenever the gallery set changes (new colour).
  // React's documented "adjust state during render" pattern — compare against a
  // stored key, no effect and no ref (both of which the compiler linter rejects
  // for this) — see react.dev "You Might Not Need an Effect".
  const [seenGalleryKey, setSeenGalleryKey] = useState(galleryKey);
  if (seenGalleryKey !== galleryKey) {
    setSeenGalleryKey(galleryKey);
    setActiveThumb(0);
  }

  const displayImage = usingVariantGallery
    ? (activeGallery[activeThumb]?.url ?? activeGallery[0]?.url)
    : (matched?.imageUrl ?? images[activeThumb]?.url ?? images[0]?.url);
  const displayAlt =
    (usingVariantGallery ? activeGallery[activeThumb]?.alt : matched ? title : images[activeThumb]?.alt) ||
    title;

  // Add-to-cart availability: block incomplete/disabled/sold-out variation
  // selections, and product-level out-of-stock when there are no variations.
  const soldOut = hasVariations
    ? !matched || !isEnabled(matched) || matched.stock === 0
    : baseAvailability === 'out-of-stock';

  function handleAdd() {
    const optionsLabel = attributes
      .map((a) => {
        const v = a.values.find((x) => x.id === selected[a.id]);
        return v ? `${a.name}: ${v.label}` : null;
      })
      .filter(Boolean)
      .join(', ');
    addItem(
      {
        slug,
        title,
        variationId: matched?.id,
        optionsLabel: optionsLabel || undefined,
        sku: matched?.sku,
        unitPrice: price,
        currency,
        imageUrl: displayImage,
        locale,
        virtual: Boolean(digital),
        minQty: qRules.min,
        maxQty: qRules.max ?? undefined,
        qtyStep: qRules.step,
      },
      clampQuantity(qRules, qty),
    );
    open();
  }

  /** Grouped product: add every component as its own (standard) cart line. */
  function handleAddAll() {
    if (!grouped?.length) return;
    for (const c of grouped) {
      addItem(
        { slug: c.slug, title: c.title, unitPrice: c.unitPrice, currency, imageUrl: c.imageUrl, locale },
        c.quantity,
      );
    }
    open();
  }

  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:gap-16">
      {/* Gallery */}
      <div className="flex flex-col gap-4">
        <div className="aspect-square overflow-hidden rounded-sm bg-bone-cream">
          {displayImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={displayImage} alt={displayAlt} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-text-muted">
              <span className="font-body text-sm">{title}</span>
            </div>
          )}
        </div>
        {activeGallery.length > 1 ? (
          <div className="grid grid-cols-4 gap-3">
            {activeGallery.slice(0, 8).map((g, i) => (
              <button
                key={`${galleryKey}-${i}`}
                type="button"
                onClick={() => setActiveThumb(i)}
                aria-label={g.alt || `${title} ${i + 1}`}
                className={`aspect-square overflow-hidden rounded-sm border bg-bone-cream ${
                  i === activeThumb && (usingVariantGallery || !matched?.imageUrl)
                    ? 'border-warm-gold-deep'
                    : 'border-border-soft'
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={g.url} alt={g.alt || `${title} ${i + 1}`} className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* Buy box */}
      <div className="flex flex-col">
        {badges.length > 0 ? <ProductBadges badges={badges} className="mb-3" /> : null}
        {subtitle ? <Eyebrow className="mb-3">{subtitle}</Eyebrow> : null}
        <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight leading-tight text-midnight-navy">
          {title}
        </h1>

        {rating ? (
          <a href="#reviews" className="mt-2 inline-flex items-center gap-2 text-sm hover:opacity-80">
            <ReviewStars value={rating.average} size={16} />
            <span className="font-body text-text-muted">
              {rating.average.toFixed(1)} ({rating.count})
            </span>
          </a>
        ) : null}

        {giftCard ? null : (
        <div className="mt-4 flex items-center gap-3">
          <span className="font-display text-2xl font-semibold text-midnight-navy">
            {formatPrice(price, currency, locale)}
          </span>
          {showCompare ? (
            <span className="font-body text-lg text-text-muted line-through">
              {formatPrice(compareAt!, currency, locale)}
            </span>
          ) : null}
        </div>
        )}

        <span
          className={`mt-3 inline-flex w-fit items-center rounded-sm px-2.5 py-1 text-xs font-medium ${
            availabilityKey === 'select'
              ? 'bg-neutral-100 text-neutral-600'
              : (AVAILABILITY_TONE[availabilityKey] ?? 'bg-neutral-100 text-neutral-600')
          }`}
        >
          {availabilityKey === 'select' ? t('selectOptions') : t(`availability.${availabilityKey}`)}
        </span>

        {matched?.sku ? (
          <p className="mt-2 font-body text-xs text-text-muted">
            {t('sku')}: {matched.sku}
          </p>
        ) : null}

        {/* Quantity (§6) — only for the normal add-to-cart path. */}
        {!external && !grouped && !giftCard && !qRules.soldIndividually ? (
          <div className="mt-6 flex items-center gap-3">
            <span className="font-body text-sm text-text-muted">{t('quantity')}</span>
            <div className="inline-flex items-center rounded-sm border border-border-soft">
              <button
                type="button"
                onClick={() => bumpQty(-1)}
                disabled={qty <= qRules.min}
                aria-label={t('decrease')}
                className="px-3 py-1.5 text-text-primary disabled:opacity-40"
              >
                −
              </button>
              <span className="w-10 text-center font-body text-sm" aria-live="polite">
                {qty}
              </span>
              <button
                type="button"
                onClick={() => bumpQty(1)}
                disabled={qRules.max != null && qty >= qRules.max}
                aria-label={t('increase')}
                className="px-3 py-1.5 text-text-primary disabled:opacity-40"
              >
                +
              </button>
            </div>
            {qRules.step > 1 ? (
              <span className="font-body text-xs text-text-muted">{t('inSteps', { step: qRules.step })}</span>
            ) : null}
          </div>
        ) : null}

        {/* Buy action — varies by product type (§5). */}
        {giftCard ? (
          <GiftCardBuyBox
            slug={slug}
            title={title}
            currency={currency}
            locale={locale}
            offer={giftCard}
            imageUrl={displayImage}
          />
        ) : null}
        <div className="mt-6">
          {giftCard ? null : external ? (
            /*
             * `externalUrl` is a plain `f.text` field an editor types into, so it
             * arrives here as an arbitrary string — the same footing as a CTA
             * href, and it goes through the same allow-list. React 19 refuses to
             * emit a `javascript:` href on its own, but that is a backstop and it
             * does not cover `data:`; `safeHref` states the policy instead.
             */
            <a
              href={safeHref(external.url)}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-flex w-full items-center justify-center rounded-sm bg-warm-gold-deep px-5 py-2.5 font-body text-sm font-medium text-white hover:opacity-90 sm:w-auto"
            >
              {external.label || t('buyExternal')}
            </a>
          ) : grouped ? (
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={grouped.length === 0}
              onClick={handleAddAll}
              className="w-full sm:w-auto"
            >
              {t('addAllToCart')}
            </Button>
          ) : (
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={soldOut}
              onClick={handleAdd}
              className="w-full sm:w-auto"
            >
              {tCart('addToCart')}
            </Button>
          )}
          {/* Saves the CHOSEN variation, so "the blue one" comes back as blue. */}
          <WishlistButton productId={productId} variationId={matched?.id ?? ''} />
        </div>

        {/* Digital: no-shipping note + what's included. */}
        {digital ? (
          <div className="mt-4 rounded-sm border border-border-soft bg-bone-cream/40 p-4">
            <p className="font-body text-sm font-medium text-text-primary">{t('digitalNote')}</p>
            {digital.includes.length > 0 ? (
              <ul className="mt-2 list-disc pl-5 font-body text-sm text-text-muted">
                {digital.includes.map((name, i) => (
                  <li key={i}>{name}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {/* Grouped: the component list. */}
        {grouped ? (
          <div className="mt-8 flex flex-col gap-3">
            <h2 className="font-display text-lg font-semibold text-midnight-navy">{t('includedProducts')}</h2>
            <ul className="flex flex-col divide-y divide-border-soft border-y border-border-soft">
              {grouped.map((c) => (
                <li key={c.slug} className="flex items-center gap-3 py-3">
                  {c.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.imageUrl} alt={c.title} className="h-12 w-12 shrink-0 rounded-sm object-cover" />
                  ) : null}
                  <Link href={c.href} className="min-w-0 flex-1 font-body text-sm text-text-primary hover:text-warm-gold-deep">
                    {c.title}
                  </Link>
                  {c.quantity > 1 ? (
                    <span className="font-body text-xs text-text-muted">×{c.quantity}</span>
                  ) : null}
                  <span className="font-body text-sm text-text-primary">
                    {formatPrice(c.unitPrice * c.quantity, currency, locale)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Options */}
        {!external && !grouped && !giftCard && attributes.length > 0 ? (
          <div className="mt-8 flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-lg font-semibold text-midnight-navy">{t('options')}</h2>
              {hasSizeGuide ? (
                <a href="#size-guide" className="font-body text-sm text-warm-gold-deep hover:underline">
                  {t('sizeGuide')}
                </a>
              ) : null}
            </div>
            {attributes.map((attr) => {
              const selectedLabel = attr.values.find((v) => v.id === selected[attr.id])?.label;
              return (
                <div key={attr.id} className="flex flex-col gap-2">
                  <span className="font-body text-sm font-medium text-text-primary">
                    {attr.name}
                    {selectedLabel ? (
                      <span className="ml-2 font-normal text-text-muted">{selectedLabel}</span>
                    ) : null}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {attr.values.map((v) => {
                      const active = selected[attr.id] === v.id;
                      const available = isValueAvailable(attr.id, v.id);
                      const pick = () => setSelected((s) => ({ ...s, [attr.id]: v.id }));
                      const ring = active
                        ? 'ring-2 ring-warm-gold-deep ring-offset-1'
                        : 'ring-1 ring-border-soft';
                      const dim = !available && !active ? 'opacity-40' : '';

                      if (attr.swatchType === 'color' && v.color) {
                        return (
                          <button
                            key={v.id}
                            type="button"
                            onClick={pick}
                            disabled={!available && !active}
                            title={v.label}
                            aria-label={v.label}
                            aria-pressed={active}
                            className={`h-8 w-8 rounded-full ${ring} ${dim}`}
                            style={{ backgroundColor: v.color }}
                          />
                        );
                      }
                      if (attr.swatchType === 'image' && v.imageUrl) {
                        return (
                          <button
                            key={v.id}
                            type="button"
                            onClick={pick}
                            disabled={!available && !active}
                            title={v.label}
                            aria-label={v.label}
                            aria-pressed={active}
                            className={`h-10 w-10 overflow-hidden rounded-sm ${ring} ${dim}`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={v.imageUrl} alt={v.label} className="h-full w-full object-cover" />
                          </button>
                        );
                      }
                      return (
                        <button
                          key={v.id}
                          type="button"
                          onClick={pick}
                          disabled={!available && !active}
                          aria-pressed={active}
                          className={`rounded-sm px-3 py-1.5 font-body text-sm ${ring} ${dim} ${
                            active ? 'bg-warm-gold/15 text-warm-gold-deep' : 'text-text-primary'
                          }`}
                        >
                          {v.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {hasVariations && allSelected && !matched ? (
              <p className="font-body text-sm text-red-600">{t('unavailable')}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
