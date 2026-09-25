'use client';

import { useLocale } from 'next-intl';
import { useId, useState, type FormEvent } from 'react';

import { useNewsletterEnabled } from '@/components/layout/NewsletterProvider';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { subscribeToNewsletter } from '@/lib/newsletter';

interface NewsletterBandProps {
  copy: {
    eyebrow: string;
    headline: string;
    description: string;
    emailLabel: string;
    emailPlaceholder: string;
    submitLabel: string;
    submittingLabel: string;
    successHeadline: string;
    successBody: string;
    /** Shown when the address is already on the list. Optional, and treated as
     *  a pair — without both, a repeat signup shows the ordinary thank-you, as
     *  it did before these existed. `messages/*.json` supplies both. */
    alreadyHeadline?: string;
    alreadyBody?: string;
    errorBody: string;
  };
  /**
   * Where the signup came from, stored on the subscriber (Admin → Newsletter).
   * `footer` unless a page places the band somewhere else, e.g. `home`.
   */
  source?: string;
}

/**
 * Newsletter signup band across the top of the footer, above the four link
 * columns — so it appears on every page of the site from one edit.
 *
 * A band rather than a fifth column: the grid is already four columns in
 * twelve, and an email field plus a button does not fit in a quarter of
 * that. Squeezed into a column it becomes a fifth row on mobile, below the
 * links, where nobody looks. Full width, it holds the field and the button
 * side by side on desktop and stacks cleanly on a phone.
 *
 * Expectations, honestly: the footer converts poorly — most readers never
 * reach it. This is the safety net that covers pricing, services, approach
 * and the legal pages, which have no newsletter card of their own. The
 * sidebar cards on the content pages do the real work.
 *
 * Submission goes through `subscribeToNewsletter`, which is a stub pending
 * the owner's Brevo workflow — see `src/lib/newsletter.ts`.
 */
export function NewsletterBand({ copy, source = 'footer' }: NewsletterBandProps) {
  const [email, setEmail] = useState('');
  const [hp, setHp] = useState('');
  const fieldId = useId();
  const [state, setState] = useState<'idle' | 'submitting' | 'success' | 'already' | 'error'>(
    'idle'
  );
  // Stored on the subscriber, so the list knows which language to write to them
  // in — the two placements sit on pages of both.
  const locale = useLocale();
  const newsletterEnabled = useNewsletterEnabled();

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (state === 'submitting' || state === 'success' || state === 'already') return;
    // A filled honeypot is a bot. Show the same success it would have got and
    // send nothing — a visible failure here is a map to getting past the trap.
    if (hp) {
      setState('success');
      return;
    }
    setState('submitting');
    try {
      const outcome = await subscribeToNewsletter(email, source, locale);
      // An address that was already on the list gets its own message — telling
      // somebody "you're subscribed" a second time reads as though the first
      // attempt had not worked. A return after unsubscribing is a real signup
      // and gets the ordinary thank-you.
      setState(outcome === 'already-subscribed' && copy.alreadyHeadline ? 'already' : 'success');
    } catch {
      setState('error');
    }
  };
  /*
   * The success block does double duty: the ordinary thank-you, and the
   * "you're already on the list" message.
   *
   * Which one is decided in `onSubmit`, where the already-state is only
   * entered if the site actually configured copy for it — the pair is optional
   * on `copy`, and a site whose settings row predates them shows the ordinary
   * thank-you rather than an empty box.
   */
  const notice =
    state === 'already'
      ? { headline: copy.alreadyHeadline, body: copy.alreadyBody }
      : state === 'success'
        ? { headline: copy.successHeadline, body: copy.successBody }
        : null;

  /*
   * Module off → no band at all.
   *
   * Placed after the hooks, never before: an early return above them would make
   * the hook order depend on a value that changes between sites. A signup box
   * whose endpoint answers 404 is worse than no box — it collects an address
   * and shows an error for it.
   */
  if (!newsletterEnabled) return null;

  return (
    <div className="border-t border-warm-gold/30 pt-10 pb-10">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] gap-6 lg:gap-12 lg:items-end">
        <div>
          <Eyebrow color="gold" className="mb-3">
            {copy.eyebrow}
          </Eyebrow>
          <p className="font-display text-xl md:text-2xl font-medium tracking-tight leading-tight text-soft-pearl mb-2">
            {copy.headline}
          </p>
          <p className="font-body text-sm leading-relaxed text-soft-pearl/70 max-w-xl">
            {copy.description}
          </p>
        </div>

        {notice ? (
          <div role="status" aria-live="polite" className="lg:pb-1">
            <p className="font-body text-sm leading-relaxed text-soft-pearl mb-1">
              <strong className="font-semibold">{notice.headline}</strong>
            </p>
            <p className="font-body text-sm leading-relaxed text-soft-pearl/70">
              {notice.body}
            </p>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            {/* Honeypot — same pattern as the contact forms. A field no person
                can see or tab into; a filled one means a bot, and the endpoint
                answers 200 without writing so the sender learns nothing. */}
            <div
              aria-hidden="true"
              style={{ position: 'absolute', left: '-10000px', top: 'auto', width: '1px', height: '1px', overflow: 'hidden' }}
            >
              <label htmlFor={`${fieldId}-hp`}>Website (leave blank)</label>
              <input
                id={`${fieldId}-hp`}
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={hp}
                onChange={(e) => setHp(e.target.value)}
              />
            </div>
            <div className="flex flex-col sm:flex-row sm:items-end gap-3">
              <label className="flex flex-col gap-1.5 flex-1 min-w-0">
                <span className="font-body text-xs uppercase tracking-wider-2 text-soft-pearl/60">
                  {copy.emailLabel}
                </span>
                <input
                  type="email"
                  required
                  maxLength={254}
                  autoComplete="email"
                  placeholder={copy.emailPlaceholder}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={state === 'submitting'}
                  className="bg-transparent border-b border-soft-pearl/30 focus:border-warm-gold outline-none font-body text-sm py-2 text-soft-pearl placeholder:text-soft-pearl/45 disabled:opacity-50"
                />
              </label>
              <button
                type="submit"
                disabled={state === 'submitting'}
                className="shrink-0 inline-flex items-center justify-center font-body font-medium tracking-wide rounded-sm px-6 py-3 text-sm bg-warm-gold text-midnight-navy hover:bg-warm-gold-dark transition-colors duration-200 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-gold focus-visible:ring-offset-2 focus-visible:ring-offset-midnight-navy"
              >
                {state === 'submitting' ? copy.submittingLabel : copy.submitLabel}
              </button>
            </div>

            {state === 'error' && (
              <p
                role="alert"
                className="font-body text-sm leading-relaxed text-soft-pearl border-l-2 border-warm-gold pl-3"
              >
                {copy.errorBody}
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
