import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { getPaymentProvider, isModuleEnabled, isOnlineProvider } from '@/cms/core';
// Side effect: attaches Stripe and PayPal to the provider registry.
import '@/cms/core/payments/register';
import {
  amountDueFor,
  bookedDatesText,
  getBookingPaymentProvider,
  getSurchargeBps,
  redeemPaymentToken,
  surchargeAmount,
} from '@/cms/modules/booking';
import { BookingPayClient } from '@/components/booking/BookingPayClient';
import { Eyebrow } from '@/components/ui/Eyebrow';
import type { Locale } from '@/lib/i18n/config';
import { formatPrice } from '@/lib/money';
import config from '@/site.config';

interface PageProps {
  params: Promise<{ locale: Locale; reference: string }>;
  searchParams: Promise<{ t?: string; return?: string }>;
}

export const dynamic = 'force-dynamic';

// A payment page must never be indexed, and never appear in a sitemap: the URL
// carries a bearer credential.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function BookingPayPage({ params, searchParams }: PageProps) {
  const { locale, reference } = await params;
  const { t: token, return: returned } = await searchParams;
  setRequestLocale(locale);

  if (!(await isModuleEnabled(config, 'booking'))) notFound();

  // Unknown reference, wrong token, expired link and already-paid all land here
  // identically. Distinguishing them would tell someone probing which of their
  // guesses was closest.
  const reservation = token ? await redeemPaymentToken(reference, token) : null;

  // Back from a hosted provider. A successful payment destroys the token, so by
  // design there is nothing left to look up — and saying more than "thank you"
  // to someone holding a spent credential would be saying too much. The webhook
  // is what actually confirms the booking; this is only the landing.
  if (!reservation && returned === '1') {
    const t = await getTranslations({ locale, namespace: 'bookingLookup' });
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-12 sm:px-6">
        <h1 className="font-display text-3xl font-semibold">{t('payThanksTitle')}</h1>
        <p className="mt-3 text-neutral-700">{t('payThanksBody')}</p>
      </main>
    );
  }

  if (!reservation) notFound();

  const t = await getTranslations({ locale, namespace: 'bookingLookup' });

  const provider = getPaymentProvider(await getBookingPaymentProvider());
  const amountDue = amountDueFor(reservation);
  const surcharge = surchargeAmount(amountDue, await getSurchargeBps(provider.key));

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-12 sm:px-6">
      <Eyebrow>{reservation.bookingTitle}</Eyebrow>
      <h1 className="mt-2 font-display text-3xl font-semibold">{t('title')}</h1>

      <dl className="mt-6 grid grid-cols-2 gap-2 rounded-sm border border-neutral-200 bg-white p-6 text-sm">
        <dt className="text-neutral-600">{t('reference')}</dt>
        <dd className="font-mono">{reservation.reference}</dd>
        <dt className="text-neutral-600">{t('date')}</dt>
        <dd>{bookedDatesText(reservation, locale)}</dd>
        <dt className="text-neutral-600">{t('persons')}</dt>
        <dd>{reservation.persons}</dd>
        <dt className="text-neutral-600">{t('total')}</dt>
        <dd>{formatPrice(reservation.total / 100, reservation.currency, locale)}</dd>
      </dl>

      <BookingPayClient
        reference={reservation.reference}
        token={token!}
        locale={locale}
        currency={reservation.currency}
        amountDue={amountDue}
        surcharge={surcharge}
        chargeable={amountDue + surcharge}
        isDeposit={reservation.depositAmount > 0 && reservation.depositAmount < reservation.total}
        online={isOnlineProvider(provider)}
        // Browser-safe by design; the secret key never leaves the server.
        publishableKey={process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? null}
        labels={{
          amountDue: t('payAmountDue'),
          depositDue: t('payDepositDue'),
          surcharge: t('paySurcharge'),
          totalCharged: t('payTotalCharged'),
          payNow: t('payNow'),
          paying: t('payProcessing'),
          bankTransfer: t('payBankTransfer', { reference: reservation.reference }),
          genericError: t('payError'),
          returned: t('payThanksBody'),
        }}
      />
    </main>
  );
}
