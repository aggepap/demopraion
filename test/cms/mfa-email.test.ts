/**
 * The email that carries a sign-in code.
 *
 * Three decisions here are different from every other mail this codebase sends,
 * and each is a bug if it drifts back to the house default:
 *
 *  1. It is transactional, so it must NOT consult the suppression list and must
 *     NOT carry an unsubscribe link. Someone who once unsubscribed from a
 *     marketing mail would otherwise be locked out of their own admin account,
 *     and the link would be an invitation to unsubscribe from the only thing
 *     standing between them and their password.
 *  2. It RETHROWS on failure, unlike `booking/emails.ts` and `orders.ts`, which
 *     record and swallow. An undelivered receipt is a nuisance; an undelivered
 *     login code is a silent lockout, so the caller has to be able to say
 *     "that did not send — use your app or a recovery code".
 *  3. The code is the whole payload, so the recipient's own name — the one
 *     field an attacker with a signup form could influence — is escaped.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { GraphMail } from '@/cms/core/email';
import { MFA_EMAIL_CODE_TTL_MINUTES, sendMfaCodeEmail } from '@/cms/modules/auth/mfa-email';

function recorder() {
  const sent: GraphMail[] = [];
  return {
    sent,
    send: async (mail: GraphMail) => {
      sent.push(mail);
    },
  };
}

const base = { to: 'admin@example.com', name: 'Admin', code: '123456', locale: 'el' as const };

describe('sendMfaCodeEmail', () => {
  test('sends the code to the account holder, not the default inbox', async () => {
    // `sendGraphMail` falls back to CONTACT_RECIPIENT_EMAIL when `to` is unset,
    // which would mail every admin's sign-in code to the contact-form mailbox.
    const r = recorder();
    await sendMfaCodeEmail(base, r.send);
    assert.equal(r.sent.length, 1);
    assert.equal(r.sent[0].to, 'admin@example.com');
  });

  test('puts the code in the body and in the subject', async () => {
    // In the subject because that is what a phone's notification shows, which
    // is where the code is actually read from most of the time.
    const r = recorder();
    await sendMfaCodeEmail(base, r.send);
    assert.match(r.sent[0].html, /123456/);
    assert.match(r.sent[0].subject, /123456/);
  });

  test('says how long the code lasts', async () => {
    const r = recorder();
    await sendMfaCodeEmail(base, r.send);
    assert.match(r.sent[0].html, new RegExp(String(MFA_EMAIL_CODE_TTL_MINUTES)));
  });

  test('writes Greek for el and English for en', async () => {
    const el = recorder();
    await sendMfaCodeEmail(base, el.send);
    assert.match(el.sent[0].html, /[Ͱ-Ͽ]/, 'el body should contain Greek');

    const en = recorder();
    await sendMfaCodeEmail({ ...base, locale: 'en' }, en.send);
    assert.ok(!/[Ͱ-Ͽ]/.test(en.sent[0].html), 'en body should contain no Greek');
  });

  test('falls back to a real language for an unknown locale', async () => {
    const r = recorder();
    await sendMfaCodeEmail({ ...base, locale: 'fr' }, r.send);
    assert.match(r.sent[0].html, /123456/);
    assert.ok(r.sent[0].subject.length > 0);
  });

  test('escapes the recipient name', async () => {
    const r = recorder();
    await sendMfaCodeEmail({ ...base, name: '<script>alert(1)</script>' }, r.send);
    assert.ok(!r.sent[0].html.includes('<script>'), 'name must not be interpolated raw');
    assert.match(r.sent[0].html, /&lt;script&gt;/);
  });

  test('carries no unsubscribe link', async () => {
    const r = recorder();
    await sendMfaCodeEmail(base, r.send);
    assert.ok(!/unsubscribe/i.test(r.sent[0].html), 'a login code is not unsolicited mail');
  });

  test('always includes a plain-text alternative', async () => {
    // Some corporate mail clients strip HTML entirely. A code-only email that
    // renders as a blank message is a lockout.
    const r = recorder();
    await sendMfaCodeEmail(base, r.send);
    assert.match(r.sent[0].text ?? '', /123456/);
  });

  test('rethrows when delivery fails', async () => {
    /*
     * The deliberate divergence from `safeSend` in `orders.ts`. Swallowing this
     * leaves the user staring at a code prompt for a mail that is never coming,
     * with nothing on screen to say so.
     */
    const boom = async () => {
      throw new Error('Graph sendMail failed (503): upstream');
    };
    await assert.rejects(sendMfaCodeEmail(base, boom), /Graph sendMail failed/);
  });
});
