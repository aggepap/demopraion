/**
 * The unsubscribe endpoint behind the link in the abandoned-cart reminder.
 *
 * ## Why GET only confirms, and POST does the work
 *
 * Mail clients and security scanners prefetch links. If a GET performed the
 * unsubscribe, Outlook's link-scanner could quietly opt someone out of mail they
 * wanted, and the person would never know why it stopped. So GET renders a page
 * with one button, and the button POSTs. That is also the shape RFC 8058
 * one-click unsubscribe expects, so if the `List-Unsubscribe` header is ever added
 * (it needs Graph's raw-MIME send path — `sendMail` refuses non-`x-` custom
 * headers) this POST is already the right target for it.
 *
 * ## Why the response is self-contained HTML
 *
 * The alternative is a route under `[locale]` with its own page, layout and
 * message keys. This page is reached once, from an email, by someone who wants one
 * sentence of confirmation — the whole interaction is two strings and a button,
 * and putting it here keeps it out of the sitemap, out of the i18n message files,
 * and reachable even if the marketing site is mid-deploy. It carries `noindex`
 * because a URL containing an email address must never be indexed.
 */
import 'server-only';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createRoute, escapeHtml, normalizeEmail, suppressEmail, unsubscribeSignatureMatches } from '../../core';
import { getBrand } from '../../core/brand';

const query = z.object({
  /** The address, lowercased when the link was built. */
  e: z.string().trim().email().max(254),
  /** HMAC over the address — see `core/email/unsubscribe.ts`. */
  s: z.string().trim().min(1).max(64),
  locale: z.string().trim().max(8).optional(),
});

const COPY = {
  el: {
    title: 'Διαγραφή από τις υπενθυμίσεις',
    confirm: 'Θέλετε να σταματήσουμε να στέλνουμε υπενθυμίσεις καλαθιού στο',
    button: 'Επιβεβαίωση διαγραφής',
    done: 'Έγινε. Δεν θα λαμβάνετε άλλες υπενθυμίσεις καλαθιού.',
    doneNote: 'Τα email για τις παραγγελίες σας δεν επηρεάζονται.',
    invalid: 'Ο σύνδεσμος δεν είναι έγκυρος ή έχει αλλοιωθεί.',
  },
  en: {
    title: 'Unsubscribe from reminders',
    confirm: 'Stop sending cart reminders to',
    button: 'Confirm unsubscribe',
    done: 'Done. You won’t receive any more cart reminders.',
    doneNote: 'Emails about your orders are not affected.',
    invalid: 'This link is not valid, or has been altered.',
  },
} as const;

type Locale = keyof typeof COPY;
const localeOf = (raw: string | undefined): Locale => (raw === 'en' ? 'en' : 'el');

/** A minimal, dependency-free page in the site's colours. `noindex` because the URL carries an address. */
async function page(locale: Locale, bodyHtml: string, status = 200): Promise<NextResponse> {
  const c = COPY[locale];
  const p = (await getBrand()).palette;
  const html =
    `<!doctype html><html lang="${locale}"><head>` +
    `<meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex,nofollow">` +
    `<title>${escapeHtml(c.title)}</title>` +
    `<style>` +
    `body{font-family:Arial,Helvetica,sans-serif;color:${p['text-primary']};background:${p['bone-cream']};` +
    `display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px}` +
    `main{background:${p['soft-pearl']};border:1px solid ${p['border-soft']};border-radius:6px;padding:28px;max-width:30rem}` +
    `h1{font-size:1.15rem;margin:0 0 12px}p{font-size:.95rem;line-height:1.6;margin:0 0 14px}` +
    `button{background:${p['midnight-navy']};color:${p['soft-pearl']};border:0;border-radius:4px;padding:10px 18px;` +
    `font-size:.95rem;cursor:pointer}small{color:${p['text-muted']}}` +
    `</style></head><body><main>${bodyHtml}</main></body></html>`;
  return new NextResponse(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow' },
  });
}

function invalidPage(locale: Locale): Promise<NextResponse> {
  const c = COPY[locale];
  return page(locale, `<h1>${escapeHtml(c.title)}</h1><p>${escapeHtml(c.invalid)}</p>`, 400);
}

/**
 * `GET /api/cms/commerce/unsubscribe` — show the confirmation.
 *
 * `sameOrigin: false`: the request arrives from an email client, which sends
 * either no `Origin` or its own. The signature is what authorises this endpoint,
 * not the referring page.
 */
export function unsubscribeConfirmRoute() {
  return createRoute({
    sameOrigin: false,
    rateLimit: { scope: 'commerce-unsubscribe', max: 30, windowMs: 60_000 },
    query,
    handler: async ({ query: q }) => {
      const locale = localeOf(q?.locale);
      if (!q || !unsubscribeSignatureMatches(q.e, q.s)) return invalidPage(locale);

      const c = COPY[locale];
      const email = escapeHtml(normalizeEmail(q.e));
      // The form re-submits the same signed pair, so POST verifies independently
      // rather than trusting that a GET happened first.
      return page(
        locale,
        `<h1>${escapeHtml(c.title)}</h1>` +
          `<p>${escapeHtml(c.confirm)} <strong>${email}</strong>?</p>` +
          `<form method="post">` +
          `<input type="hidden" name="e" value="${email}">` +
          `<input type="hidden" name="s" value="${escapeHtml(q.s)}">` +
          `<input type="hidden" name="locale" value="${locale}">` +
          `<button type="submit">${escapeHtml(c.button)}</button>` +
          `</form>`,
      );
    },
  });
}

/**
 * `POST /api/cms/commerce/unsubscribe` — record the suppression.
 *
 * Accepts a form body (what the confirmation page sends) as well as the query
 * string, so an RFC 8058 `List-Unsubscribe-Post` client works against the same
 * route. Not `input`-validated by the factory because that parses JSON; the body
 * here is `application/x-www-form-urlencoded`.
 */
export function unsubscribeSubmitRoute() {
  return createRoute({
    sameOrigin: false,
    rateLimit: { scope: 'commerce-unsubscribe', max: 30, windowMs: 60_000 },
    handler: async ({ req }) => {
      const url = new URL(req.url);
      let email = url.searchParams.get('e') ?? '';
      let signature = url.searchParams.get('s') ?? '';
      let rawLocale = url.searchParams.get('locale') ?? undefined;

      const contentType = req.headers.get('content-type') ?? '';
      if (contentType.includes('form')) {
        const form = await req.formData().catch(() => null);
        if (form) {
          email = String(form.get('e') ?? email);
          signature = String(form.get('s') ?? signature);
          rawLocale = String(form.get('locale') ?? rawLocale ?? '') || rawLocale;
        }
      }

      const locale = localeOf(rawLocale);
      if (!unsubscribeSignatureMatches(email, signature)) return invalidPage(locale);

      await suppressEmail(email, 'unsubscribe');

      const c = COPY[locale];
      return page(
        locale,
        `<h1>${escapeHtml(c.title)}</h1>` +
          `<p>${escapeHtml(c.done)}</p>` +
          `<p><small>${escapeHtml(c.doneNote)}</small></p>`,
      );
    },
  });
}
