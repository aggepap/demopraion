import 'server-only';

import { emailColor, escapeHtml, formatMoney, sendGraphMail } from '../../../core/email';

/**
 * The email that carries a gift card.
 *
 * It contains the code, which is money — so it goes only to the recipient the
 * buyer named, and the subject says who it is from rather than what it is
 * worth, because a subject line is visible on a lock screen.
 */

const LABELS = {
  el: {
    subject: 'Έχεις μια δωροκάρτα!',
    intro: 'Κάποιος σου χάρισε μια δωροκάρτα.',
    code: 'Ο κωδικός σου',
    howTo: 'Πληκτρολόγησέ τον στο ταμείο, στο πεδίο «Κωδικός δωροκάρτας».',
    value: 'Αξία',
  },
  en: {
    subject: 'You have a gift card!',
    intro: 'Somebody has given you a gift card.',
    code: 'Your code',
    howTo: 'Type it at checkout, in the “Gift card code” field.',
    value: 'Value',
  },
};

export async function sendGiftCardEmail(
  card: {
    code: string;
    recipientEmail: string | null;
    message: string | null;
    amount: number;
    currency: string;
  },
  locale: string
): Promise<void> {
  if (!card.recipientEmail || !card.code) return;
  const L = locale === 'en' ? LABELS.en : LABELS.el;

  await sendGraphMail({
    to: card.recipientEmail,
    subject: L.subject,
    html:
      `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6;color:${emailColor('midnight-navy')};">` +
      `<p>${escapeHtml(L.intro)}</p>` +
      (card.message ? `<blockquote>${escapeHtml(card.message)}</blockquote>` : '') +
      `<p><strong>${escapeHtml(L.code)}:</strong> ` +
      `<code style="font-size:18px;letter-spacing:2px;">${escapeHtml(card.code)}</code></p>` +
      `<p>${escapeHtml(L.value)}: ${escapeHtml(formatMoney(card.amount, card.currency, locale))}</p>` +
      `<p style="font-size:13px;color:#6b7280;">${escapeHtml(L.howTo)}</p>` +
      `</div>`,
  });
}
