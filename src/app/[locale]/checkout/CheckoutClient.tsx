'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { checkoutLine, useCart } from '@/components/shop/cart/CartProvider';
import { useNewsletterEnabled } from '@/components/layout/NewsletterProvider';
import { StripeCardPanel } from '@/components/shop/StripeCardPanel';
import { Button } from '@/components/ui/Button';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { Link } from '@/lib/i18n/routing';
import { GiftCardField } from '@/components/checkout/GiftCardField';
import { ShippingMethodPicker } from '@/components/checkout/ShippingMethodPicker';
import { formatPrice } from '@/lib/money';

const inputClass =
  'w-full rounded-sm border border-border-soft bg-white px-3 py-2 font-body text-sm text-text-primary focus:border-warm-gold focus:outline-none focus:ring-1 focus:ring-warm-gold';
const labelClass = 'flex flex-col gap-1 font-body text-sm text-text-primary';

/** Mirrors `PickupConfig` in the commerce module (kept literal so this client
 *  component doesn't reach into the server-only shipping module). */
interface PickupOption {
  charge: number;
  locations: { id: string; name: string; address?: string; hours?: string }[];
}

/** What a signed-in customer's form starts with (see `checkoutPrefill`). */
export interface AccountPrefill {
  name: string;
  email: string;
  phone: string;
  address1: string;
  city: string;
  postal: string;
  country: string;
}

export function CheckoutClient({
  locale,
  currency,
  giftWrapFee = 0,
  pickup,
  account,
}: {
  locale: string;
  currency: string;
  giftWrapFee?: number;
  /** Present only when store pickup is enabled (§8). */
  pickup?: PickupOption;
  /**
   * Shop accounts. `prefill` is filled in for a signed-in customer (their
   * default address), and `offerAccount` shows the "create an account" tick to
   * a guest. Both are decided on the server; the tick is a convenience, and the
   * server ignores it when the module is off.
   */
  account?: { offerAccount: boolean; prefill?: AccountPrefill | null };
}) {
  const t = useTranslations('checkout');
  const { items, subtotal, allVirtual, clear } = useCart();

  const [form, setForm] = useState({
    name: account?.prefill?.name ?? '',
    email: account?.prefill?.email ?? '',
    phone: account?.prefill?.phone ?? '',
    address1: account?.prefill?.address1 ?? '',
    city: account?.prefill?.city ?? '',
    postal: account?.prefill?.postal ?? '',
    country: account?.prefill?.country ?? '',
    notes: '',
    giftMessage: '',
  });
  // Guests only: a signed-in customer already has an account.
  const [createAccount, setCreateAccount] = useState(false);
  const [accountPassword, setAccountPassword] = useState('');
  // The chosen delivery option, when the shop offers a choice at all.
  const [shippingMethodId, setShippingMethodId] = useState<number | null>(null);
  const [locker, setLocker] = useState<{ id: string; name: string } | null>(null);
  const [giftCardCodes, setGiftCardCodes] = useState<string[]>([]);
  // Store pickup (§8): offered only for carts with something physical in them.
  const canPickup = Boolean(pickup) && !allVirtual;
  const [delivery, setDelivery] = useState<'ship' | 'pickup'>('ship');
  const [pickupLocationId, setPickupLocationId] = useState(pickup?.locations[0]?.id ?? '');
  const collectsInStore = canPickup && delivery === 'pickup';
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  // The tick feeds `newsletter_subscribers`, the same list the footer band
  // does. With the module off there is no list to join. The route drops a
  // claimed opt-in as well — this only stops it being offered.
  const newsletterEnabled = useNewsletterEnabled();
  const [giftWrap, setGiftWrap] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  /**
   * Set when the order was placed against an in-page gateway. The order exists
   * and holds no stock; the card is collected below before it is confirmed.
   */
  const [pending, setPending] = useState<{ reference: string; clientSecret: string } | null>(null);
  const [quote, setQuote] = useState<{ shipping: number; surcharge: number } | null>(null);
  const [couponInput, setCouponInput] = useState('');
  const [coupon, setCoupon] = useState<{ code: string; discount: number } | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponChecking, setCouponChecking] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function applyCoupon() {
    const code = couponInput.trim();
    if (!code) return;
    setCouponChecking(true);
    setCouponError(null);
    try {
      const res = await fetch('/api/cms/commerce/coupon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          email: form.email || undefined,
          locale,
          items: items.map((i) => ({ slug: i.slug, variationId: i.variationId, quantity: i.quantity })),
        }),
      });
      const data = await res.json().catch(() => null);
      if (data?.ok && data.data.valid) {
        setCoupon({ code: data.data.code, discount: Number(data.data.discount) || 0 });
      } else {
        setCoupon(null);
        const reason = data?.data?.reason;
        setCouponError(
          reason === 'min_subtotal'
            ? t('couponMinSubtotal')
            : reason === 'usage_limit'
              ? t('couponUsageLimit')
              : reason === 'customer_limit'
                ? t('couponCustomerLimit')
                : t('couponInvalid'),
        );
      }
    } catch {
      setCouponError(t('couponInvalid'));
    } finally {
      setCouponChecking(false);
    }
  }

  /*
   * Re-check the coupon whenever the cart changes.
   *
   * The discount was worked out once, when the code was applied, and then kept as a
   * fixed amount. Change a quantity from the header cart drawer — no reload, so this
   * component keeps its state — and the summary went on subtracting a discount
   * calculated against the old subtotal. The customer saw one total and was charged
   * another, because the server recomputes the discount properly at order time. The
   * shipping estimate right below already re-fetched on every cart change; the coupon
   * simply never did.
   *
   * A code that has stopped qualifying (a minimum-subtotal coupon on a cart that has
   * shrunk below it) is dropped with the reason shown, rather than left displaying a
   * discount that will not be honoured.
   */
  const appliedCode = coupon?.code ?? null;
  useEffect(() => {
    if (!appliedCode || items.length === 0) return;
    const controller = new AbortController();
    const id = setTimeout(() => {
      fetch('/api/cms/commerce/coupon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          code: appliedCode,
          email: form.email || undefined,
          locale,
          items: items.map((i) => ({ slug: i.slug, variationId: i.variationId, quantity: i.quantity })),
        }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (!d?.ok) return;
          if (d.data.valid) {
            const discount = Number(d.data.discount) || 0;
            // Only on a real change, so this cannot loop through its own dependency.
            setCoupon((current) =>
              current && current.discount !== discount ? { ...current, discount } : current,
            );
            return;
          }
          setCoupon(null);
          const reason = d.data.reason;
          setCouponError(
            reason === 'min_subtotal'
              ? t('couponMinSubtotal')
              : reason === 'usage_limit'
                ? t('couponUsageLimit')
                : reason === 'customer_limit'
                  ? t('couponCustomerLimit')
                  : t('couponInvalid'),
          );
        })
        .catch(() => {
          /* leave the applied coupon alone; the server is authoritative at order time */
        });
    }, 300);
    return () => {
      clearTimeout(id);
      controller.abort();
    };
    // `appliedCode` rather than `coupon`: this effect sets the discount, so depending
    // on the object it writes would re-run it on its own result.
  }, [appliedCode, items, locale, form.email, t]);

  function removeCoupon() {
    setCoupon(null);
    setCouponInput('');
    setCouponError(null);
  }

  // Live shipping estimate — recomputed (debounced) when the country changes.
  // The server re-computes authoritatively at order time; this is display only.
  const country = form.country.trim();
  useEffect(() => {
    // Digital-only carts have no shipping — skip the estimate entirely.
    if (items.length === 0 || allVirtual) return;
    const controller = new AbortController();
    const id = setTimeout(() => {
      fetch('/api/cms/commerce/shipping-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          locale,
          country,
          delivery: collectsInStore ? 'pickup' : 'ship',
          items: items.map((i) => ({ slug: i.slug, variationId: i.variationId, quantity: i.quantity })),
        }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (d?.ok) setQuote({ shipping: Number(d.data.shipping) || 0, surcharge: Number(d.data.surcharge) || 0 });
        })
        .catch(() => {
          /* ignore — the server re-computes at order time */
        });
    }, 400);
    return () => {
      clearTimeout(id);
      controller.abort();
    };
  }, [country, items, locale, allVirtual, collectsInStore]);

  // Abandoned-cart capture (§9): once the shopper enters a valid email, snapshot
  // the cart (debounced, best-effort). A reminder job emails a recovery link if
  // they don't complete. Skipped after the order is placed.
  const email = form.email.trim();
  useEffect(() => {
    if (reference || items.length === 0 || !/\S+@\S+\.\S+/.test(email)) return;
    const controller = new AbortController();
    const id = setTimeout(() => {
      fetch('/api/cms/commerce/abandoned-cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ email, currency, locale, items }),
      }).catch(() => {
        /* best-effort — capture must never disrupt checkout */
      });
    }, 1500);
    return () => {
      clearTimeout(id);
      controller.abort();
    };
  }, [email, items, currency, locale, reference]);

  const shippingMajor = allVirtual ? 0 : (quote?.shipping ?? 0) / 100;
  const surchargeMajor = allVirtual ? 0 : (quote?.surcharge ?? 0) / 100;
  const discountMajor = (coupon?.discount ?? 0) / 100;
  const giftWrapMajor = giftWrap ? giftWrapFee : 0;
  const totalMajor = Math.max(0, subtotal - discountMajor + shippingMajor + surchargeMajor + giftWrapMajor);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPlacing(true);
    setError(null);
    try {
      const res = await fetch('/api/cms/commerce/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer: {
            name: form.name,
            email: form.email,
            phone: form.phone || undefined,
            // Neither a digital-only order nor a store collection needs an address.
            ...(allVirtual || collectsInStore
              ? {}
              : {
                  address1: form.address1,
                  city: form.city,
                  postal: form.postal,
                  country: form.country,
                }),
          },
          ...(collectsInStore
            ? { delivery: 'pickup', pickupLocationId: pickupLocationId || undefined }
            : {}),
          notes: form.notes || undefined,
          couponCode: coupon?.code,
          locale,
          acceptTerms,
          marketingOptIn,
          createAccount,
          accountPassword: createAccount ? accountPassword : undefined,
          giftCardCodes: giftCardCodes.length ? giftCardCodes : undefined,
          shippingMethodId: shippingMethodId ?? undefined,
          lockerId: locker?.id,
          lockerName: locker?.name,
          giftWrap,
          giftMessage: giftWrap ? form.giftMessage || undefined : undefined,
          // A gift card line carries its amount and recipient (`checkoutLine`).
          items: items.map(checkoutLine),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.message || t('error'));
      }
      const { reference, redirectUrl, clientSecret } = data.data as {
        reference: string;
        redirectUrl: string | null;
        clientSecret: string | null;
      };
      // Three shapes, decided by the provider rather than by anything here:
      // a hosted gateway (PayPal) returns a redirect, an in-page one (Stripe)
      // returns a client secret, and offline settlement returns neither.
      if (redirectUrl) {
        window.location.href = redirectUrl;
        return;
      }
      if (clientSecret) {
        // The cart is NOT cleared yet — the customer has not paid, and losing
        // it behind a failed card would lose the order too.
        setPending({ reference, clientSecret });
        return;
      }
      clear();
      setReference(reference);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'));
    } finally {
      setPlacing(false);
    }
  }

  // ── Card payment (order placed, money not yet taken) ──────────────────────
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (pending && publishableKey) {
    return (
      <section className="bg-soft-pearl pt-24 md:pt-32 pb-24">
        <div className="max-w-xl mx-auto px-6">
          <Eyebrow className="mb-4">{t('title')}</Eyebrow>
          <p className="mb-6 font-body text-text-muted">
            {t('orderRef')}: <span className="font-mono text-midnight-navy">{pending.reference}</span>
          </p>
          <StripeCardPanel
            clientSecret={pending.clientSecret}
            publishableKey={publishableKey}
            returnUrl={`${window.location.origin}/order?ref=${encodeURIComponent(pending.reference)}`}
            labels={{
              heading: t('payHeading'),
              pay: t('payNow'),
              paying: t('payProcessing'),
              confirming: t('payProcessing'),
              genericError: t('error'),
            }}
            onSucceeded={() => {
              // Only now is the cart safe to empty: the money has moved, and
              // the webhook will mark the order paid and take the stock.
              clear();
              setPending(null);
              setReference(pending.reference);
            }}
          />
        </div>
      </section>
    );
  }

  // ── Confirmation ──────────────────────────────────────────────────────────
  if (reference) {
    return (
      <section className="bg-soft-pearl pt-24 md:pt-32 pb-24">
        <div className="max-w-2xl mx-auto px-6 text-center">
          <Eyebrow className="mb-4">{t('title')}</Eyebrow>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-midnight-navy">
            {t('orderPlaced')}
          </h1>
          <p className="mt-4 font-body text-text-muted">
            {t('orderRef')}: <span className="font-mono text-midnight-navy">{reference}</span>
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link href="/order" className="font-body text-sm font-medium text-warm-gold-deep hover:underline">
              {t('trackOrder')}
            </Link>
            <span className="hidden text-text-muted sm:inline">·</span>
            <Link href="/shop" className="font-body text-sm font-medium text-warm-gold-deep hover:underline">
              {t('backToShop')}
            </Link>
          </div>
        </div>
      </section>
    );
  }

  // ── Empty cart ────────────────────────────────────────────────────────────
  if (items.length === 0) {
    return (
      <section className="bg-soft-pearl pt-24 md:pt-32 pb-24">
        <div className="max-w-2xl mx-auto px-6 text-center">
          <h1 className="font-display text-3xl font-semibold text-midnight-navy">{t('title')}</h1>
          <p className="mt-4 font-body text-text-muted">{t('empty')}</p>
          <div className="mt-8">
            <Link href="/shop" className="font-body text-sm font-medium text-warm-gold-deep hover:underline">
              {t('backToShop')}
            </Link>
          </div>
        </div>
      </section>
    );
  }

  // ── Form + summary ────────────────────────────────────────────────────────
  return (
    <section className="bg-soft-pearl pt-20 md:pt-28 pb-24">
      <div className="max-w-5xl mx-auto px-6">
        <Eyebrow className="mb-3">{t('title')}</Eyebrow>
        <h1 className="mb-8 font-display text-3xl sm:text-4xl font-semibold tracking-tight text-midnight-navy">
          {t('title')}
        </h1>

        <form onSubmit={submit} className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_360px]">
          {/* Fields */}
          <div className="flex flex-col gap-6">
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 font-display text-lg font-semibold text-midnight-navy">{t('contact')}</legend>
              <label className={labelClass}>
                {t('name')} *
                <input className={inputClass} required value={form.name} onChange={set('name')} />
              </label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className={labelClass}>
                  {t('email')} *
                  <input type="email" className={inputClass} required value={form.email} onChange={set('email')} />
                </label>
                <label className={labelClass}>
                  {t('phone')}
                  <input className={inputClass} value={form.phone} onChange={set('phone')} />
                </label>
              </div>
            </fieldset>

            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 font-display text-lg font-semibold text-midnight-navy">
                {allVirtual ? t('notes') : canPickup ? t('delivery') : t('shipping')}
              </legend>

              {/* Delivery method (§8) — only when store pickup is configured. */}
              {canPickup ? (
                <div className="flex flex-col gap-2">
                  {(['ship', 'pickup'] as const).map((option) => (
                    <label
                      key={option}
                      className="flex cursor-pointer items-center gap-2 font-body text-sm text-text-primary"
                    >
                      <input
                        type="radio"
                        name="delivery"
                        className="h-4 w-4 accent-warm-gold-deep"
                        checked={delivery === option}
                        onChange={() => setDelivery(option)}
                      />
                      {option === 'ship'
                        ? t('deliveryShip')
                        : pickup && pickup.charge > 0
                          ? t('deliveryPickupWithFee', { fee: formatPrice(pickup.charge, currency, locale) })
                          : t('deliveryPickup')}
                    </label>
                  ))}
                </div>
              ) : null}

              {/* A digital-only order collects no delivery address. */}
              {allVirtual ? (
                <p className="font-body text-sm text-text-muted">{t('digitalNoShipping')}</p>
              ) : collectsInStore ? (
                <>
                  {pickup && pickup.locations.length > 1 ? (
                    <label className={labelClass}>
                      {t('pickupLocation')} *
                      <select
                        className={inputClass}
                        value={pickupLocationId}
                        onChange={(e) => setPickupLocationId(e.target.value)}
                      >
                        {pickup.locations.map((loc) => (
                          <option key={loc.id} value={loc.id}>
                            {loc.name}
                            {loc.address ? ` — ${loc.address}` : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {/* The chosen store's details, so the customer knows where + when. */}
                  {(() => {
                    const loc =
                      pickup?.locations.find((l) => l.id === pickupLocationId) ?? pickup?.locations[0];
                    if (!loc) return <p className="font-body text-sm text-text-muted">{t('pickupNote')}</p>;
                    return (
                      <div className="rounded-sm border border-border-soft bg-white px-3 py-2 font-body text-sm text-text-muted">
                        <span className="block text-text-primary">{loc.name}</span>
                        {loc.address ? <span className="block">{loc.address}</span> : null}
                        {loc.hours ? <span className="block text-xs">{loc.hours}</span> : null}
                      </div>
                    );
                  })()}
                </>
              ) : (
                <>
                  <label className={labelClass}>
                    {t('address1')} *
                    <input className={inputClass} required value={form.address1} onChange={set('address1')} />
                  </label>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <label className={labelClass}>
                      {t('city')} *
                      <input className={inputClass} required value={form.city} onChange={set('city')} />
                    </label>
                    <label className={labelClass}>
                      {t('postal')} *
                      <input className={inputClass} required value={form.postal} onChange={set('postal')} />
                    </label>
                    <label className={labelClass}>
                      {t('country')} *
                      <input className={inputClass} required value={form.country} onChange={set('country')} />
                    </label>
                  </div>
                </>
              )}
              <label className={labelClass}>
                {t('notes')}
                <textarea className={inputClass} rows={3} value={form.notes} onChange={set('notes')} />
              </label>
            </fieldset>

            {/* How it arrives, when the shop offers more than one way. */}
            <ShippingMethodPicker
              country={form.country}
              postal={form.postal}
              subtotalCents={Math.round(subtotal * 100)}
              currency={currency}
              locale={locale}
              value={shippingMethodId}
              locker={locker}
              onChange={(next) => {
                setShippingMethodId(next.methodId);
                setLocker(next.locker);
              }}
            />

            {/* A gift card pays part or all of the order. */}
            <GiftCardField
              codes={giftCardCodes}
              amountDue={Math.round(totalMajor * 100)}
              currency={currency}
              locale={locale}
              onChange={setGiftCardCodes}
            />

            {/* Shop account — a guest can keep this order in an account. */}
            {account?.offerAccount ? (
              <fieldset className="flex flex-col gap-3">
                <legend className="mb-1 font-display text-lg font-semibold text-midnight-navy">
                  {t('accountTitle')}
                </legend>
                <label className="flex cursor-pointer items-center gap-2 font-body text-sm text-text-primary">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-warm-gold-deep"
                    checked={createAccount}
                    onChange={(e) => setCreateAccount(e.target.checked)}
                  />
                  {t('createAccount')}
                </label>
                {createAccount ? (
                  <label className={labelClass}>
                    {t('accountPassword')}
                    <input
                      className={inputClass}
                      type="password"
                      autoComplete="new-password"
                      value={accountPassword}
                      onChange={(e) => setAccountPassword(e.target.value)}
                    />
                    <span className="font-body text-xs text-text-muted">{t('accountHint')}</span>
                  </label>
                ) : null}
              </fieldset>
            ) : null}

            {/* Gift options (§9) */}
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 font-display text-lg font-semibold text-midnight-navy">{t('giftOptions')}</legend>
              <label className="flex cursor-pointer items-center gap-2 font-body text-sm text-text-primary">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-warm-gold-deep"
                  checked={giftWrap}
                  onChange={(e) => setGiftWrap(e.target.checked)}
                />
                {giftWrapFee > 0
                  ? t('giftWrapWithFee', { fee: formatPrice(giftWrapFee, currency, locale) })
                  : t('giftWrap')}
              </label>
              {giftWrap ? (
                <label className={labelClass}>
                  {t('giftMessage')}
                  <textarea
                    className={inputClass}
                    rows={2}
                    maxLength={500}
                    value={form.giftMessage}
                    onChange={set('giftMessage')}
                  />
                </label>
              ) : null}
            </fieldset>
          </div>

          {/* Summary */}
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-sm border border-border-soft bg-white p-5">
              <h2 className="mb-4 font-display text-lg font-semibold text-midnight-navy">{t('summary')}</h2>
              <ul className="flex flex-col gap-3">
                {items.map((i) => (
                  <li key={i.key} className="flex justify-between gap-3 font-body text-sm">
                    <span className="min-w-0">
                      <span className="text-text-primary">{i.title}</span>
                      {i.optionsLabel ? <span className="block text-xs text-text-muted">{i.optionsLabel}</span> : null}
                      <span className="text-xs text-text-muted">× {i.quantity}</span>
                    </span>
                    <span className="whitespace-nowrap text-text-primary">
                      {formatPrice(i.unitPrice * i.quantity, i.currency, locale)}
                    </span>
                  </li>
                ))}
              </ul>

              {/* Coupon */}
              <div className="mt-4 border-t border-border-soft pt-4">
                {coupon ? (
                  <div className="flex items-center justify-between font-body text-sm">
                    <span className="font-mono text-warm-gold-deep">{coupon.code}</span>
                    <button
                      type="button"
                      onClick={removeCoupon}
                      className="text-xs text-text-muted hover:text-red-600"
                    >
                      {t('removeCoupon')}
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input
                      className={inputClass}
                      placeholder={t('coupon')}
                      value={couponInput}
                      onChange={(e) => setCouponInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          applyCoupon();
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={couponChecking || !couponInput.trim()}
                      onClick={applyCoupon}
                    >
                      {t('apply')}
                    </Button>
                  </div>
                )}
                {couponError ? <p className="mt-1 font-body text-xs text-red-600">{couponError}</p> : null}
              </div>

              <dl className="mt-3 flex flex-col gap-1 font-body text-sm">
                <div className="flex justify-between">
                  <dt className="text-text-muted">{t('subtotal')}</dt>
                  <dd className="text-text-primary">{formatPrice(subtotal, currency, locale)}</dd>
                </div>
                {discountMajor > 0 ? (
                  <div className="flex justify-between">
                    <dt className="text-text-muted">{t('discount')}</dt>
                    <dd className="text-warm-gold-deep">−{formatPrice(discountMajor, currency, locale)}</dd>
                  </div>
                ) : null}
                {allVirtual ? null : (
                  <div className="flex justify-between">
                    <dt className="text-text-muted">{collectsInStore ? t('pickupLine') : t('shipping')}</dt>
                    <dd className="text-text-primary">
                      {/* Shipping needs a destination; pickup is priced immediately. */}
                      {collectsInStore || country ? formatPrice(shippingMajor, currency, locale) : '—'}
                    </dd>
                  </div>
                )}
                {surchargeMajor > 0 ? (
                  <div className="flex justify-between">
                    <dt className="text-text-muted">{t('surcharge')}</dt>
                    <dd className="text-text-primary">{formatPrice(surchargeMajor, currency, locale)}</dd>
                  </div>
                ) : null}
                {giftWrapMajor > 0 ? (
                  <div className="flex justify-between">
                    <dt className="text-text-muted">{t('giftWrapLine')}</dt>
                    <dd className="text-text-primary">{formatPrice(giftWrapMajor, currency, locale)}</dd>
                  </div>
                ) : null}
              </dl>
              <div className="mt-3 flex items-center justify-between border-t border-border-soft pt-3">
                <span className="font-body text-sm text-text-muted">{t('total')}</span>
                <span className="font-display text-lg font-semibold text-midnight-navy">
                  {formatPrice(totalMajor, currency, locale)}
                </span>
              </div>
              <p className="mt-1 font-body text-xs text-text-muted">
                {allVirtual || collectsInStore || country ? t('vatIncluded') : t('enterCountry')}
              </p>

              {/* Consent (§9): terms required, marketing opt-in optional. */}
              <div className="mt-4 flex flex-col gap-2">
                <label className="flex cursor-pointer items-start gap-2 font-body text-xs text-text-primary">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-warm-gold-deep"
                    checked={acceptTerms}
                    onChange={(e) => setAcceptTerms(e.target.checked)}
                  />
                  <span>
                    {t.rich('acceptTerms', {
                      terms: (chunks) => (
                        <Link href="/legal/terms" target="_blank" className="text-warm-gold-deep underline">
                          {chunks}
                        </Link>
                      ),
                    })}
                  </span>
                </label>
                {newsletterEnabled ? (
                  <label className="flex cursor-pointer items-start gap-2 font-body text-xs text-text-muted">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 accent-warm-gold-deep"
                      checked={marketingOptIn}
                      onChange={(e) => setMarketingOptIn(e.target.checked)}
                    />
                    {t('marketingOptIn')}
                  </label>
                ) : null}
              </div>

              {error ? <p className="mt-4 font-body text-sm text-red-600">{error}</p> : null}

              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={placing || !acceptTerms}
                className="mt-5 w-full"
              >
                {placing ? t('placing') : t('placeOrder')}
              </Button>
            </div>
          </aside>
        </form>
      </div>
    </section>
  );
}
