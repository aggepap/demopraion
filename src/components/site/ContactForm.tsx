'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';

type Status = 'idle' | 'sending' | 'sent' | 'error';
type FieldName = 'name' | 'email' | 'message';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const inputClass =
  'w-full rounded-sm border border-border-soft bg-white px-4 py-3 text-base text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-midnight-navy aria-[invalid=true]:border-error';

/**
 * The contact form. Posts `kind: 'contact'` to /api/contact, which validates it
 * again server-side, stores it (Admin → Submissions) and emails it.
 *
 * `_hp` is a honeypot: hidden from people, filled in by bots, and silently
 * accepted-then-dropped by the endpoint.
 */
export function ContactForm() {
  const t = useTranslations('contact.form');
  const locale = useLocale();
  const [status, setStatus] = useState<Status>('idle');
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const value = (key: string) => String(data.get(key) ?? '').trim();

    const next: Partial<Record<FieldName, string>> = {};
    if (!value('name')) next.name = t('required');
    if (!EMAIL.test(value('email'))) next.email = t('invalidEmail');
    if (!value('message')) next.message = t('required');
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setStatus('sending');
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'contact',
          locale,
          name: value('name'),
          email: value('email'),
          phone: value('phone'),
          message: value('message'),
          _hp: value('_hp'),
        }),
      });
      if (!res.ok) throw new Error(`contact form: HTTP ${res.status}`);
      form.reset();
      setStatus('sent');
    } catch (err) {
      console.error(err);
      setStatus('error');
    }
  }

  if (status === 'sent') {
    return (
      <p role="status" className="rounded-sm border border-border-soft bg-bone-cream p-6 text-text-primary">
        {t('success')}
      </p>
    );
  }

  const field = (name: FieldName | 'phone', label: string, input: (describedBy?: string) => React.ReactNode) => {
    const error = name === 'phone' ? undefined : errors[name];
    const errorId = error ? `${name}-error` : undefined;
    return (
      <div className="flex flex-col gap-2">
        <label htmlFor={name} className="text-sm font-medium text-text-primary">
          {label}
        </label>
        {input(errorId)}
        {error ? (
          <p id={errorId} className="text-sm text-error">
            {error}
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
      {field('name', t('name'), (d) => (
        <input id="name" name="name" autoComplete="name" required aria-invalid={Boolean(errors.name)} aria-describedby={d} className={inputClass} />
      ))}
      {field('email', t('email'), (d) => (
        <input id="email" name="email" type="email" autoComplete="email" required aria-invalid={Boolean(errors.email)} aria-describedby={d} className={inputClass} />
      ))}
      {field('phone', t('phone'), () => (
        <input id="phone" name="phone" type="tel" autoComplete="tel" className={inputClass} />
      ))}
      {field('message', t('message'), (d) => (
        <textarea id="message" name="message" rows={6} required aria-invalid={Boolean(errors.message)} aria-describedby={d} className={inputClass} />
      ))}

      {/* Honeypot — not for people. */}
      <div aria-hidden="true" className="hidden">
        <label>
          Leave this empty
          <input name="_hp" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      {status === 'error' ? (
        <p role="alert" className="text-sm text-error">
          {t('error')}
        </p>
      ) : null}

      <div>
        <Button type="submit" variant="primary" size="md" disabled={status === 'sending'}>
          {status === 'sending' ? t('submitting') : t('submit')}
        </Button>
      </div>
    </form>
  );
}
