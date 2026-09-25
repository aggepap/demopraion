'use client';

import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import { useCart } from '@/components/shop/cart/CartProvider';
import { Button } from '@/components/ui/Button';
import { formatPrice, fromMinor, toMinor } from '@/lib/money';

/**
 * The buy box of a gift card product: the amount, who it is for, an optional
 * message and the day it should arrive.
 *
 * The limits here are the shop's gift card settings, passed down by the page.
 * They make the form honest, not safe — checkout checks the amount again.
 */

/** What the shop sells gift cards for (from Settings → Ecommerce → Gift cards). */
export interface GiftCardOffer {
  enabled: boolean;
  /** Minor units. */
  presets: number[];
  allowCustom: boolean;
  minAmount: number;
  maxAmount: number;
}

const CUSTOM = 'custom';

const fieldClass =
  'w-full rounded-sm border border-border-soft bg-white px-3 py-2 font-body text-sm text-text-primary focus:border-warm-gold-deep focus:outline-none';

export function GiftCardBuyBox({
  slug,
  title,
  currency,
  locale,
  offer,
  imageUrl,
}: {
  slug: string;
  title: string;
  currency: string;
  locale: string;
  offer: GiftCardOffer;
  imageUrl?: string;
}) {
  const t = useTranslations('shop.giftCard');
  const tCart = useTranslations('cart');
  const { addItem, open } = useCart();
  const id = useId();

  const [choice, setChoice] = useState<string>(() =>
    offer.presets[0] !== undefined ? String(offer.presets[0]) : offer.allowCustom ? CUSTOM : '',
  );
  const [custom, setCustom] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [message, setMessage] = useState('');
  const [sendAt, setSendAt] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!offer.enabled) {
    return <p className="mt-6 font-body text-sm text-text-muted">{t('unavailable')}</p>;
  }

  const money = (minor: number) => formatPrice(fromMinor(minor), currency, locale);
  const range = { min: money(offer.minAmount), max: money(offer.maxAmount) };
  const amount = choice === CUSTOM ? toMinor(Number(custom.replace(',', '.'))) : Number(choice);
  const today = new Date().toISOString().slice(0, 10);

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!choice) return setError(t('chooseAmount'));
    const allowed =
      Number.isSafeInteger(amount) &&
      amount > 0 &&
      (offer.presets.includes(amount) ||
        (offer.allowCustom && amount >= offer.minAmount && amount <= offer.maxAmount));
    if (!allowed) return setError(t('invalidAmount', range));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail.trim())) return setError(t('emailRequired'));
    setError(null);

    const recipient = recipientName.trim() || recipientEmail.trim();
    addItem({
      slug,
      title,
      optionsLabel: t('cartFor', { recipient }),
      unitPrice: fromMinor(amount),
      currency,
      imageUrl,
      locale,
      virtual: true,
      minQty: 1,
      maxQty: 1,
      giftCard: {
        amount,
        recipientName: recipientName.trim(),
        recipientEmail: recipientEmail.trim(),
        message: message.trim(),
        sendAt,
      },
    });
    open();
  }

  return (
    <form onSubmit={add} noValidate className="mt-6 flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-body text-sm font-medium text-text-primary">{t('amount')}</legend>
        <div className="flex flex-wrap gap-2">
          {offer.presets.map((preset) => (
            <label
              key={preset}
              className="flex cursor-pointer items-center gap-2 rounded-sm border border-border-soft px-3 py-2 font-body text-sm has-[:checked]:border-warm-gold-deep"
            >
              <input
                type="radio"
                name={`${id}-amount`}
                value={preset}
                checked={choice === String(preset)}
                onChange={() => setChoice(String(preset))}
              />
              {money(preset)}
            </label>
          ))}
          {offer.allowCustom ? (
            <label className="flex cursor-pointer items-center gap-2 rounded-sm border border-border-soft px-3 py-2 font-body text-sm has-[:checked]:border-warm-gold-deep">
              <input
                type="radio"
                name={`${id}-amount`}
                value={CUSTOM}
                checked={choice === CUSTOM}
                onChange={() => setChoice(CUSTOM)}
              />
              {t('customAmount')}
            </label>
          ) : null}
        </div>
        {offer.allowCustom ? (
          <label className="flex flex-col gap-1 font-body text-sm text-text-muted">
            <span>
              {t('customAmount')} ({currency}) — {t('customRange', range)}
            </span>
            <input
              type="number"
              inputMode="decimal"
              min={fromMinor(offer.minAmount)}
              max={fromMinor(offer.maxAmount)}
              step="0.01"
              value={custom}
              onFocus={() => setChoice(CUSTOM)}
              onChange={(e) => setCustom(e.target.value)}
              className={fieldClass}
            />
          </label>
        ) : null}
      </fieldset>

      <label className="flex flex-col gap-1 font-body text-sm text-text-muted">
        {t('recipientName')}
        <input
          type="text"
          maxLength={191}
          autoComplete="off"
          value={recipientName}
          onChange={(e) => setRecipientName(e.target.value)}
          className={fieldClass}
        />
      </label>
      <label className="flex flex-col gap-1 font-body text-sm text-text-muted">
        {t('recipientEmail')}
        <input
          type="email"
          required
          maxLength={255}
          autoComplete="off"
          value={recipientEmail}
          onChange={(e) => setRecipientEmail(e.target.value)}
          className={fieldClass}
        />
      </label>
      <label className="flex flex-col gap-1 font-body text-sm text-text-muted">
        {t('message')}
        <textarea
          rows={3}
          maxLength={500}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className={fieldClass}
        />
      </label>
      <label className="flex flex-col gap-1 font-body text-sm text-text-muted">
        {t('sendAt')}
        <input
          type="date"
          min={today}
          value={sendAt}
          onChange={(e) => setSendAt(e.target.value)}
          aria-describedby={`${id}-send-hint`}
          className={fieldClass}
        />
        <span id={`${id}-send-hint`} className="text-xs">
          {t('sendAtHint')}
        </span>
      </label>

      {error ? (
        <p role="alert" className="font-body text-sm text-red-600">
          {error}
        </p>
      ) : null}

      <p className="font-body text-xs text-text-muted">{t('note')}</p>

      <Button type="submit" variant="primary" size="sm" className="w-full sm:w-auto">
        {tCart('addToCart')}
      </Button>
    </form>
  );
}
