/**
 * Shared email formatting. Pure — no mailer, no DB, no `server-only`.
 *
 * Extracted because `orders.ts` already had a private copy and the booking
 * module needed the same two functions; a third copy of an HTML escaper is how
 * one of them ends up subtly not escaping.
 */

/** Escape a value for interpolation into email HTML. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Minor units → a formatted amount, locale-aware.
 *
 * Falls back to a plain string rather than throwing: an unknown currency code
 * must not be the reason a customer never receives their receipt.
 */
export function formatMoney(minor: number, currency: string, locale = 'el'): string {
  const intlLocale = locale === 'el' ? 'el-GR' : locale === 'en' ? 'en-US' : locale;
  try {
    return new Intl.NumberFormat(intlLocale, { style: 'currency', currency }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

/** A calendar date (`YYYY-MM-DD`) as a person would read it. */
export function formatDate(date: string, locale = 'el'): string {
  const intlLocale = locale === 'el' ? 'el-GR' : locale === 'en' ? 'en-US' : locale;
  try {
    return new Intl.DateTimeFormat(intlLocale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${date}T00:00:00Z`));
  } catch {
    return date;
  }
}

/**
 * The one body a Microsoft Graph message carries.
 *
 * `sendMail` accepts a single body, so a mail with both parts sends the HTML; one
 * with only text sends that, as `Text`. The sender used to send `html` whatever it
 * was given, so a text-only mail went out blank. Neither part is refused rather
 * than delivered empty.
 */
export function graphMailBody(mail: { html?: string; text?: string }): {
  contentType: 'HTML' | 'Text';
  content: string;
} {
  if (mail.html) return { contentType: 'HTML', content: mail.html };
  if (mail.text) return { contentType: 'Text', content: mail.text };
  throw new Error('An email needs an HTML or a text body.');
}
