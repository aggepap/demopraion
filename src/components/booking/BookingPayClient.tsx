'use client';

import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { formatPrice } from '@/lib/money';

/**
 * The payment surface behind a booking's pay link.
 *
 * Three shapes, decided by what the server's `start()` returns rather than by
 * anything this component knows about gateways:
 *   - a `clientSecret`  → mount Stripe's Payment Element in place
 *   - a `redirectUrl`   → send the customer to the provider (PayPal)
 *   - neither           → offline settlement, so show how to transfer
 *
 * The amount charged can exceed the amount due when a payment surcharge
 * applies; both are shown before the customer commits, because a figure that
 * first appears on a bank statement is one nobody agreed to.
 */

export interface BookingPayLabels {
  amountDue: string;
  depositDue: string;
  surcharge: string;
  totalCharged: string;
  payNow: string;
  paying: string;
  bankTransfer: string;
  genericError: string;
  returned: string;
}

export interface BookingPayClientProps {
  reference: string;
  token: string;
  locale: string;
  currency: string;
  /** Owed on the booking, before any surcharge. */
  amountDue: number;
  surcharge: number;
  /** What the card is actually charged (`amountDue + surcharge`). */
  chargeable: number;
  isDeposit: boolean;
  /** False for `manual` — no gateway, so no button. */
  online: boolean;
  publishableKey: string | null;
  labels: BookingPayLabels;
}

/**
 * Loaded once per publishable key and cached at module scope: `loadStripe`
 * injects a script tag, and calling it per render would add one each time.
 */
const stripeCache = new Map<string, Promise<Stripe | null>>();
function stripeFor(key: string): Promise<Stripe | null> {
  let promise = stripeCache.get(key);
  if (!promise) {
    promise = loadStripe(key);
    stripeCache.set(key, promise);
  }
  return promise;
}

export function BookingPayClient(props: BookingPayClientProps) {
  const { labels, currency, locale } = props;
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Captured on click rather than during render: this component server-renders
   * first, and `window` does not exist there.
   */
  const [returnUrl, setReturnUrl] = useState('');

  const money = useCallback(
    (minor: number) => formatPrice(minor / 100, currency, locale),
    [currency, locale]
  );

  /**
   * Ask the server to begin a payment.
   *
   * The amount is NOT sent — the server recomputes what is owed from the
   * reservation, so a tampered request cannot pay less than the booking costs.
   */
  const start = useCallback(async () => {
    setStarting(true);
    setError(null);
    setReturnUrl(
      `${window.location.origin}${window.location.pathname}?t=${encodeURIComponent(props.token)}&return=1`
    );
    try {
      const res = await fetch('/api/cms/booking/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference: props.reference, t: props.token }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setError(body?.message ?? labels.genericError);
        return;
      }

      const data = body.data as { clientSecret: string | null; redirectUrl: string | null };
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
        return;
      }
      if (data.clientSecret) {
        setClientSecret(data.clientSecret);
        return;
      }
      setError(labels.genericError);
    } catch {
      setError(labels.genericError);
    } finally {
      setStarting(false);
    }
  }, [props.reference, props.token, labels.genericError]);

  const stripePromise = props.publishableKey ? stripeFor(props.publishableKey) : null;

  return (
    <section className="border-warm-gold/40 bg-warm-gold/10 mt-6 rounded-sm border p-6">
      <p className="text-sm text-neutral-700">
        {props.isDeposit ? labels.depositDue : labels.amountDue}
      </p>
      <p className="font-display mt-1 text-3xl font-semibold">{money(props.amountDue)}</p>

      {props.surcharge > 0 && (
        <dl className="border-warm-gold/30 mt-3 flex flex-col gap-1 border-t pt-3 text-sm text-neutral-700">
          <div className="flex justify-between">
            <dt>{labels.surcharge}</dt>
            <dd>{money(props.surcharge)}</dd>
          </div>
          <div className="text-midnight-navy flex justify-between font-medium">
            <dt>{labels.totalCharged}</dt>
            <dd>{money(props.chargeable)}</dd>
          </div>
        </dl>
      )}

      {/* No gateway configured — the date is still held, only the money moves
          differently. */}
      {!props.online && <p className="mt-3 text-sm text-neutral-700">{labels.bankTransfer}</p>}

      {props.online && !clientSecret && (
        <div className="mt-4">
          <Button type="button" onClick={start} disabled={starting} size="sm">
            {starting ? labels.paying : labels.payNow}
          </Button>
        </div>
      )}

      {props.online && clientSecret && stripePromise && (
        <div className="mt-4">
          <Elements stripe={stripePromise} options={{ clientSecret }}>
            <StripeCardForm
              labels={labels}
              amount={money(props.chargeable)}
              returnUrl={returnUrl}
              onError={setError}
            />
          </Elements>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}

/**
 * The Element itself, plus confirmation.
 *
 * Separate because `useStripe`/`useElements` only work inside `<Elements>`.
 * `redirect: 'if_required'` keeps a plain card payment on this page and only
 * navigates when the bank demands 3-D Secure.
 */
function StripeCardForm({
  labels,
  amount,
  returnUrl,
  onError,
}: {
  labels: BookingPayLabels;
  amount: string;
  returnUrl: string;
  onError: (message: string) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const confirm = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!stripe || !elements) return;
      setBusy(true);
      onError('');

      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: returnUrl },
        redirect: 'if_required',
      });

      if (error) {
        // Stripe's own messages are customer-facing and localised; a generic
        // fallback covers the ones that are not (network, integration).
        onError(error.message ?? labels.genericError);
        setBusy(false);
        return;
      }
      // Succeeded without leaving the page. The reservation is NOT updated from
      // here — the webhook is what moves it, so this only reassures the
      // customer while that lands.
      if (paymentIntent && ['succeeded', 'processing'].includes(paymentIntent.status)) {
        setDone(true);
      }
      setBusy(false);
    },
    [stripe, elements, returnUrl, labels.genericError, onError]
  );

  if (done) {
    return <p className="text-sm text-neutral-700">{labels.returned}</p>;
  }

  return (
    <form onSubmit={confirm} className="flex flex-col gap-4">
      <PaymentElement />
      <Button type="submit" disabled={!stripe || busy} size="sm">
        {busy ? labels.paying : `${labels.payNow} — ${amount}`}
      </Button>
    </form>
  );
}
