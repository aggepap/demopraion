import 'server-only';

import { escapeHtml, sendGraphMail, type GraphMail } from '../../core/email';

/**
 * The email that carries a sign-in code.
 *
 * This mail breaks three of the house conventions on purpose, and each one is a
 * bug if it drifts back:
 *
 *  - **No suppression check, no unsubscribe link.** `email/suppression.ts`
 *    governs *unsolicited* mail. A login code is transactional: someone who
 *    once unsubscribed from a marketing send would otherwise be locked out of
 *    their own account, and an unsubscribe link here is an invitation to
 *    disable the only thing standing between an attacker and a leaked password.
 *  - **It rethrows.** `booking/emails.ts` and `orders.ts` record-and-swallow,
 *    which is right for a receipt: the booking is already real. Here the send
 *    IS the feature, and a silent failure leaves the user watching a code
 *    prompt for a mail that is never coming.
 *  - **The code is in the subject** as well as the body, because on a phone the
 *    notification preview is where it actually gets read.
 *
 * `send` is injectable for the same reason `verifyCaptchaToken` takes a
 * `fetchImpl`: the failure paths are the ones worth testing, and they should
 * not need a mailbox.
 */

/** How long an emailed code stays usable. Long enough for slow mail, short enough to matter. */
export const MFA_EMAIL_CODE_TTL_MINUTES = 10;

interface MfaCodeMail {
  to: string;
  name: string;
  code: string;
  locale: string;
}

interface Labels {
  subject: (code: string) => string;
  heading: string;
  intro: (name: string) => string;
  expiry: (minutes: number) => string;
  ignore: string;
}

const LABELS: Record<string, Labels> = {
  el: {
    subject: (code) => `${code} — κωδικός σύνδεσης`,
    heading: 'Κωδικός σύνδεσης',
    intro: (name) => `Γεια σου ${name}, ο κωδικός σύνδεσης για τον λογαριασμό σου είναι:`,
    expiry: (minutes) => `Ο κωδικός λήγει σε ${minutes} λεπτά.`,
    ignore:
      'Αν δεν προσπάθησες να συνδεθείς, αγνόησε αυτό το μήνυμα και άλλαξε τον κωδικό πρόσβασής σου.',
  },
  en: {
    subject: (code) => `${code} — your sign-in code`,
    heading: 'Sign-in code',
    intro: (name) => `Hi ${name}, your sign-in code is:`,
    expiry: (minutes) => `The code expires in ${minutes} minutes.`,
    ignore: "If you did not try to sign in, ignore this message and change your password.",
  },
};

export async function sendMfaCodeEmail(
  { to, name, code, locale }: MfaCodeMail,
  send: (mail: GraphMail) => Promise<void> = sendGraphMail,
): Promise<void> {
  // An unrecognised locale falls back rather than throwing: the account's
  // `locale` column is free-form enough that a bad value must not be a lockout.
  const t = LABELS[locale] ?? LABELS.el;
  // Escaped even though it comes from our own users table — an admin's display
  // name is editable, and the one field in this mail that isn't a constant.
  const safeName = escapeHtml(name);

  const html = `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#111;">
<h1 style="font-size:18px;margin:0 0 12px;">${escapeHtml(t.heading)}</h1>
<p style="margin:0 0 16px;">${t.intro(safeName)}</p>
<p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:0 0 16px;">${escapeHtml(code)}</p>
<p style="margin:0 0 8px;color:#555;">${escapeHtml(t.expiry(MFA_EMAIL_CODE_TTL_MINUTES))}</p>
<p style="margin:0;color:#555;">${escapeHtml(t.ignore)}</p>
</body></html>`;

  // Always sent: some corporate clients strip HTML outright, and a code-only
  // message that renders blank is indistinguishable from one that never arrived.
  const text = [
    t.heading,
    '',
    `${t.intro(name)} ${code}`,
    t.expiry(MFA_EMAIL_CODE_TTL_MINUTES),
    t.ignore,
  ].join('\n');

  await send({ subject: t.subject(code), html, text, to });
}
