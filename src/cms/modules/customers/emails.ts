import 'server-only';

import { emailColor, escapeHtml, sendGraphMail } from '../../core/email';
import { localePrefix, siteOrigin } from '../../core/paths';

/**
 * The three emails an account sends: confirm your address, reset your password,
 * and "somebody tried to register with your address".
 *
 * Greek and English only, as everywhere else in this CMS. Sending is
 * best-effort at the call site — a mail failure must not make a registration
 * look like it failed, because the account was created either way.
 */

type Labels = {
  verifySubject: string;
  verifyBody: string;
  verifyCta: string;
  resetSubject: string;
  resetBody: string;
  resetCta: string;
  existsSubject: string;
  existsBody: string;
  changedSubject: string;
  changedBody: string;
  ignore: string;
};

const EL: Labels = {
  verifySubject: 'Επιβεβαίωσε το email σου',
  verifyBody: 'Καλώς ήρθες! Πάτα το κουμπί για να επιβεβαιώσεις τη διεύθυνσή σου.',
  verifyCta: 'Επιβεβαίωση email',
  resetSubject: 'Νέος κωδικός πρόσβασης',
  resetBody: 'Ζητήθηκε νέος κωδικός για τον λογαριασμό σου. Ο σύνδεσμος ισχύει για μία ώρα.',
  resetCta: 'Ορισμός νέου κωδικού',
  existsSubject: 'Ο λογαριασμός σου υπάρχει ήδη',
  existsBody:
    'Κάποιος προσπάθησε να δημιουργήσει λογαριασμό με αυτή τη διεύθυνση. Αν ήσουν εσύ, μπορείς απλώς να συνδεθείς ή να ορίσεις νέο κωδικό.',
  changedSubject: 'Ο κωδικός σου άλλαξε',
  changedBody:
    'Ο κωδικός του λογαριασμού σου μόλις άλλαξε. Αν δεν το έκανες εσύ, ζήτησε αμέσως νέο κωδικό.',
  ignore: 'Αν δεν το ζήτησες εσύ, αγνόησε αυτό το email.',
};

const EN: Labels = {
  verifySubject: 'Confirm your email',
  verifyBody: 'Welcome! Use the button below to confirm your address.',
  verifyCta: 'Confirm email',
  resetSubject: 'Set a new password',
  resetBody: 'A new password was requested for your account. The link is valid for one hour.',
  resetCta: 'Set a new password',
  existsSubject: 'You already have an account',
  existsBody:
    'Someone tried to create an account with this address. If it was you, simply sign in or set a new password.',
  changedSubject: 'Your password was changed',
  changedBody:
    'The password for your account was just changed. If that was not you, ask for a new password immediately.',
  ignore: 'If you did not ask for this, you can ignore this email.',
};

const labelsFor = (locale: string): Labels => (locale === 'en' ? EN : EL);

function accountUrl(path: string, locale: string, defaultLocale: string, token?: string): string {
  const query = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${siteOrigin()}${localePrefix(locale, defaultLocale)}/account/${path}${query}`;
}

function layout(body: string, cta: { href: string; label: string }, footer: string): string {
  return (
    `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6;color:${emailColor('midnight-navy')};">` +
    `<p>${escapeHtml(body)}</p>` +
    `<p><a href="${cta.href}" style="display:inline-block;padding:10px 18px;background:${emailColor('midnight-navy')};color:#fff;border-radius:4px;text-decoration:none;">${escapeHtml(cta.label)}</a></p>` +
    `<p style="font-size:13px;color:#6b7280;">${escapeHtml(footer)}</p>` +
    `</div>`
  );
}

export async function sendVerifyEmail(opts: {
  to: string;
  token: string;
  locale: string;
  defaultLocale: string;
}): Promise<void> {
  const L = labelsFor(opts.locale);
  await sendGraphMail({
    to: opts.to,
    subject: L.verifySubject,
    html: layout(
      L.verifyBody,
      {
        href: accountUrl('verify', opts.locale, opts.defaultLocale, opts.token),
        label: L.verifyCta,
      },
      L.ignore
    ),
  });
}

export async function sendResetEmail(opts: {
  to: string;
  token: string;
  locale: string;
  defaultLocale: string;
}): Promise<void> {
  const L = labelsFor(opts.locale);
  await sendGraphMail({
    to: opts.to,
    subject: L.resetSubject,
    html: layout(
      L.resetBody,
      { href: accountUrl('reset', opts.locale, opts.defaultLocale, opts.token), label: L.resetCta },
      L.ignore
    ),
  });
}

/**
 * Sent when somebody registers with an address that already has an account.
 *
 * The registration endpoint answers exactly as it does for a new address, so
 * nobody can use it to discover who shops here; this email is how the actual
 * owner finds out, which is the only person entitled to know.
 */
export async function sendAlreadyRegisteredEmail(opts: {
  to: string;
  locale: string;
  defaultLocale: string;
}): Promise<void> {
  const L = labelsFor(opts.locale);
  await sendGraphMail({
    to: opts.to,
    subject: L.existsSubject,
    html: layout(
      L.existsBody,
      { href: accountUrl('login', opts.locale, opts.defaultLocale), label: L.existsSubject },
      L.ignore
    ),
  });
}

/** Told after the fact, in the customer's own language — the one email here
 *  that is a warning rather than an invitation. */
export async function sendPasswordChangedEmail(opts: {
  to: string;
  locale: string;
  defaultLocale: string;
}): Promise<void> {
  const L = labelsFor(opts.locale);
  await sendGraphMail({
    to: opts.to,
    subject: L.changedSubject,
    html: layout(
      L.changedBody,
      { href: accountUrl('forgot', opts.locale, opts.defaultLocale), label: L.resetCta },
      L.ignore
    ),
  });
}
