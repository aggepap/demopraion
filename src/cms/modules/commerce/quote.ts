/**
 * Quote / product-inquiry flow.
 *
 * Alongside checkout, a customer can ask about a product (+ optional variant
 * and quantity) instead of buying it, and we capture the request. Requests are persisted to `form_submissions`
 * (formType = 'quote') — the same table every other site form uses — so they
 * show up wherever submissions are reviewed, with no new table.
 *
 * `createQuoteRoute` returns a public POST handler (via the core route factory:
 * same-origin + rate-limit + zod validation). Notification is left to the site
 * via the optional `notify` hook, so the module stays decoupled from any
 * particular mail recipient/template.
 */
import { z } from 'zod';

import { createRoute, ok } from '../../core';
import { getDb, schema } from '../../db';

export interface QuoteInput {
  email: string;
  name?: string;
  /** Slug of the product the quote is about. */
  productSlug?: string;
  /** Selected variant name, if any. */
  variant?: string;
  quantity?: number;
  message?: string;
  locale?: string;
  sourcePageSlug?: string;
}

export interface QuoteRequestMeta {
  ua?: string;
  referrer?: string;
}

/** Persist a quote request to `form_submissions`. Returns nothing; the row is
 *  the record of truth (reviewable alongside other form submissions). */
export async function submitQuote(input: QuoteInput, meta: QuoteRequestMeta = {}): Promise<void> {
  const { email, locale, sourcePageSlug, ...rest } = input;
  const db = getDb();
  await db.insert(schema.formSubmissions).values({
    formType: 'quote',
    email,
    payload: { ...rest },
    sourcePageSlug: sourcePageSlug ?? null,
    sourceLocale: locale ?? null,
    referrerUrl: meta.referrer ?? null,
    ua: meta.ua ?? null,
  });
}

const quoteBody = z.object({
  /** Honeypot — a non-empty value means a bot. */
  _hp: z.string().optional(),
  email: z.string().trim().email().max(254),
  name: z.string().trim().max(191).optional(),
  productSlug: z.string().trim().max(191).optional(),
  variant: z.string().trim().max(191).optional(),
  quantity: z.coerce.number().int().positive().max(9999).optional(),
  message: z.string().trim().max(4000).optional(),
  locale: z.string().trim().max(8).optional(),
  sourcePageSlug: z.string().trim().max(191).optional(),
});

export interface QuoteRouteOptions {
  /** Called after a quote is persisted — send a notification email, etc.
   *  Failures are swallowed so a mail outage never fails the submission. */
  notify?: (quote: QuoteInput) => Promise<void>;
  /** Rate-limit ceiling per IP per minute. Default 5. */
  maxPerMinute?: number;
}

/**
 * Build a public POST route handler for quote submissions. Mount it from a thin
 * site route, e.g. `export const POST = createQuoteRoute({ notify })`.
 */
export function createQuoteRoute(opts: QuoteRouteOptions = {}) {
  return createRoute({
    rateLimit: { scope: 'commerce-quote', max: opts.maxPerMinute ?? 5, windowMs: 60_000 },
    input: quoteBody,
    handler: async ({ input, req }) => {
      // Honeypot: pretend success so the bot can't tell it was caught.
      if (input._hp) return ok({ ok: true });

      const quote: QuoteInput = {
        email: input.email,
        name: input.name,
        productSlug: input.productSlug,
        variant: input.variant,
        quantity: input.quantity,
        message: input.message,
        locale: input.locale,
        sourcePageSlug: input.sourcePageSlug,
      };
      await submitQuote(quote, {
        ua: req.headers.get('user-agent') ?? undefined,
        referrer: req.headers.get('referer') ?? undefined,
      });

      if (opts.notify) {
        try {
          await opts.notify(quote);
        } catch (err) {
          console.error('[commerce/quote] notify failed', err);
        }
      }
      return ok({ ok: true });
    },
  });
}
