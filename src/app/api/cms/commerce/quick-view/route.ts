/**
 * Quick-view product data (addendum §6). Returns the same props the product
 * page passes to `ProductShowcase`, so the modal reuses the exact buy box
 * (variations, quantity, digital/external). Gated by the commerce module.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { checkRateLimit, getClientIp, isModuleEnabled } from '@/cms/core';
import {
  getGiftCardConfig,
  getGroupedComponents,
  getProduct,
  getSiteCurrency,
  groupedTotal,
  quantityRules,
  toBadges,
} from '@/cms/modules/commerce';
import { projectShowcase } from '@/components/shop/showcase-data';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Rate limit, applied by hand because this handler returns its own JSON shape
 * rather than the `createRoute` envelope the storefront's siblings use.
 *
 * Every other public commerce endpoint — shipping-quote, search, review,
 * order-lookup, coupon — passes a `rateLimit` to `createRoute`; these two were
 * the only ones with no cap at all, while each request still runs product
 * queries against the database. That is a free amplifier for anyone who wants
 * to load the site, and the inconsistency was the giveaway.
 */
const mediaUrl = (uuid: string) => `/api/cms/media/file/${uuid}`;
const fail = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status });

export async function GET(req: NextRequest) {
  if (!(await isModuleEnabled(config, 'commerce'))) return fail('not_found', 404);

  const limit = checkRateLimit('commerce-quick-view', getClientIp(req), { max: 120, windowMs: 60_000 });
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  const url = new URL(req.url);
  const slug = url.searchParams.get('slug');
  const locale = url.searchParams.get('locale') || config.defaultLocale;
  if (!slug) return fail('invalid_input', 400);

  const doc = await getProduct(slug, locale);
  if (!doc) return fail('not_found', 404);

  const data = doc.data as Record<string, unknown>;
  const [currency] = await Promise.all([getSiteCurrency()]);
  const sc = projectShowcase(data, { locale, defaultLocale: config.defaultLocale });
  const badges = toBadges(data, locale);

  let grouped;
  let displayPrice = sc.basePrice;
  if (sc.productType === 'grouped') {
    const components = await getGroupedComponents(
      Array.isArray(data.components) ? (data.components as { product?: number; quantity?: number }[]) : [],
      locale,
    );
    grouped = components.map((c) => ({
      slug: c.slug,
      title: c.title,
      quantity: c.quantity,
      unitPrice: c.price,
      imageUrl: c.image?.image ? mediaUrl(c.image.image) : undefined,
      href: `/shop/${c.slug}`,
      availability: c.availability,
    }));
    displayPrice = sc.basePrice > 0 ? sc.basePrice : groupedTotal(components.map((c) => ({ price: c.price, quantity: c.quantity })));
  }

  // A gift card is bought with its amount and recipient, so quick view offers
  // the same form the product page does (or says gift cards are off).
  const giftCard =
    sc.productType === 'giftcard'
      ? (({ enabled, presets, allowCustom, minAmount, maxAmount }) => ({
          enabled,
          presets,
          allowCustom,
          minAmount,
          maxAmount,
        }))(await getGiftCardConfig())
      : undefined;

  return NextResponse.json({
    ok: true,
    data: {
      // The wishlist saves the document id, not the slug: a rename must not
      // empty somebody's saved list.
      id: doc.id,
      slug,
      title: sc.title,
      subtitle: sc.subtitle,
      images: sc.images,
      attributes: sc.attributes,
      variations: sc.variations,
      basePrice: displayPrice,
      compareAt: sc.compareAt,
      currency,
      baseAvailability: sc.availability,
      badges,
      external: sc.external,
      grouped,
      digital: sc.digital,
      quantityRules: quantityRules(data),
      giftCard,
    },
  });
}
