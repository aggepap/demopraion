'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';

/**
 * Guest review submission. Posts to the module-gated public endpoint; the
 * review lands `pending` and only appears after moderation, so on success we
 * show a "thanks — awaiting approval" note rather than optimistically rendering
 * the review. Includes the same honeypot the quote form uses.
 */
export function ReviewForm({ productSlug, locale }: { productSlug: string; locale: string }) {
  const t = useTranslations('reviews');
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [form, setForm] = useState({
    authorName: '',
    email: '',
    title: '',
    body: '',
    orderReference: '',
    _hp: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (rating < 1) {
      setError(t('errorRating'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/cms/commerce/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, productSlug, rating, locale }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (!res.ok || data?.ok === false) throw new Error('failed');
      setDone(true);
    } catch {
      setError(t('errorSubmit'));
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-sm border border-green-300 bg-green-50 px-4 py-3 font-body text-sm text-green-800">
        {t('submitted')}
      </div>
    );
  }

  const shown = hover || rating;

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <h3 className="font-display text-lg font-semibold text-midnight-navy">{t('writeReview')}</h3>

      {/* Interactive rating */}
      <div className="flex flex-col gap-1.5">
        <span className="font-body text-sm font-medium text-text-primary">
          {t('rating')}
          <span className="ml-1 text-warm-gold-deep" aria-hidden>*</span>
        </span>
        <div className="flex items-center gap-1" role="radiogroup" aria-label={t('rating')}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={`${n}`}
              onClick={() => setRating(n)}
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(0)}
              className={`text-2xl leading-none transition-colors ${
                n <= shown ? 'text-warm-gold-deep' : 'text-border-soft hover:text-warm-gold'
              }`}
            >
              ★
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label={t('name')}
          required
          value={form.authorName}
          onChange={(e) => set('authorName', e.target.value)}
          maxLength={191}
        />
        <Input
          label={t('email')}
          type="email"
          required
          hint={t('emailHint')}
          value={form.email}
          onChange={(e) => set('email', e.target.value)}
          maxLength={254}
        />
      </div>

      <Input
        label={t('reviewTitle')}
        value={form.title}
        onChange={(e) => set('title', e.target.value)}
        maxLength={191}
      />

      {/*
        Optional, and the only way to earn the "verified purchase" badge — the
        server grants it when this reference and the email above resolve to a real
        order containing this product. Left blank, the review still publishes; it
        just carries no badge. The hint says so, because a field that silently
        decides whether you get a trust marker is worth explaining.
      */}
      <Input
        label={t('orderReference')}
        hint={t('orderReferenceHint')}
        value={form.orderReference}
        onChange={(e) => set('orderReference', e.target.value.toUpperCase())}
        maxLength={32}
        autoComplete="off"
        spellCheck={false}
      />
      <Textarea
        label={t('yourReview')}
        required
        rows={5}
        value={form.body}
        onChange={(e) => set('body', e.target.value)}
        maxLength={4000}
      />

      {/* Honeypot — hidden from users, catches bots. */}
      <input
        type="text"
        name="company"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        value={form._hp}
        onChange={(e) => set('_hp', e.target.value)}
        className="hidden"
      />

      {error ? <p className="font-body text-sm text-red-700">{error}</p> : null}

      <div>
        <Button type="submit" variant="primary" size="sm" disabled={submitting}>
          {submitting ? t('submitting') : t('submit')}
        </Button>
      </div>
      <p className="font-body text-xs text-text-muted">{t('moderationNote')}</p>
    </form>
  );
}
