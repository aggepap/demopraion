'use client';

import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/Button';

/**
 * Stripe's Payment Element, for an order that has been placed but not yet paid.
 *
 * The order already exists by the time this renders — checkout created it and
 * the payment intent alongside it. So this collects the card and confirms; it
 * never creates anything. If the customer abandons the page here, the order
 * simply stays `pending` and holds no stock, which is exactly why the stock
 * decrement moved to the capture webhook.
 */

export interface StripeCardPanelLabels {
  heading: string;
  pay: string;
  paying: string;
  confirming: string;
  genericError: string;
}

export interface StripeCardPanelProps {
  clientSecret: string;
  publishableKey: string;
  /** Where Stripe returns the customer after an off-site 3-D Secure step. */
  returnUrl: string;
  labels: StripeCardPanelLabels;
  /** Called when payment succeeds without leaving the page. */
  onSucceeded: () => void;
}

const stripeCache = new Map<string, Promise<Stripe | null>>();
function stripeFor(key: string): Promise<Stripe | null> {
  let promise = stripeCache.get(key);
  if (!promise) {
    promise = loadStripe(key);
    stripeCache.set(key, promise);
  }
  return promise;
}

export function StripeCardPanel(props: StripeCardPanelProps) {
  return (
    <Elements
      stripe={stripeFor(props.publishableKey)}
      options={{ clientSecret: props.clientSecret }}
    >
      <CardForm {...props} />
    </Elements>
  );
}

function CardForm({ labels, returnUrl, onSucceeded }: StripeCardPanelProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!stripe || !elements) return;
      setBusy(true);
      setError(null);

      const result = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: returnUrl },
        // Keeps a straightforward card on this page; only a bank demanding
        // 3-D Secure sends the customer away, and they come back to returnUrl.
        redirect: 'if_required',
      });

      if (result.error) {
        setError(result.error.message ?? labels.genericError);
        setBusy(false);
        return;
      }
      // `processing` counts as done from the customer's side — the webhook is
      // what marks the order paid either way, so waiting here would only be a
      // spinner with nothing behind it.
      if (result.paymentIntent && ['succeeded', 'processing'].includes(result.paymentIntent.status)) {
        onSucceeded();
        return;
      }
      setBusy(false);
    },
    [stripe, elements, returnUrl, labels.genericError, onSucceeded],
  );

  return (
    <form onSubmit={confirm} className="flex flex-col gap-4">
      <h2 className="font-display text-xl font-semibold text-midnight-navy">{labels.heading}</h2>
      <PaymentElement />
      <Button type="submit" disabled={!stripe || busy}>
        {busy ? labels.paying : labels.pay}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}
