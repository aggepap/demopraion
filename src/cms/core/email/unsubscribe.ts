/**
 * Signed unsubscribe links.
 *
 * ## Why a signature rather than a stored token
 *
 * An unsubscribe link has to be usable months after it was sent, by someone with
 * no session, from an email client that may rewrite it. A stored token would mean
 * a row per sent message kept alive indefinitely, and a row that gets pruned is an
 * unsubscribe link that stops working — which is the one failure this feature
 * cannot have. An HMAC over the address needs no storage and cannot expire.
 *
 * It also must not be forgeable into *someone else's* unsubscribe: without a
 * signature, `?email=rival@example.com` would let anyone silence a competitor's
 * cart reminders, or — more realistically — let a crawler walk a list of guessed
 * addresses and suppress them all. The MAC binds the link to an address we
 * actually mailed.
 *
 * ## Key choice
 *
 * `ADMIN_SESSION_SECRET`, domain-separated by a purpose string in the MAC input.
 * A dedicated variable would be cleaner in the abstract, but every new required
 * env var is a deploy that can half-work, and this secret is already mandatory for
 * the admin to function at all — so it is guaranteed present wherever mail is
 * sent. The purpose prefix is what keeps an unsubscribe MAC from ever being
 * mistaken for a session token or vice versa.
 *
 * Pure `node:crypto`, no `server-only`, so `test/core/unsubscribe.test.ts` can
 * exercise it directly.
 */
import { createHmac } from 'node:crypto';

import { timingSafeEquals } from '../tokens/crypto';

/** Domain separation. Bump the version if the MAC input ever changes shape. */
const PURPOSE = 'unsubscribe:v1';

/** Truncated to 32 base64url chars (~192 bits) — plenty, and keeps the link short
 *  enough that no mail client wraps it into uselessness. */
const SIGNATURE_LENGTH = 32;

function secret(): string {
  const raw = process.env.ADMIN_SESSION_SECRET;
  if (!raw || raw.length < 32) {
    throw new Error(
      'ADMIN_SESSION_SECRET is missing or shorter than 32 characters, so unsubscribe links ' +
        'cannot be signed. Mail that cannot carry a working unsubscribe link must not be sent.',
    );
  }
  return raw;
}

/**
 * Addresses are compared and stored lowercase, so the MAC has to be computed over
 * the same normalised form — otherwise `A@x.com` and `a@x.com` produce different
 * signatures for what the suppression list treats as one address.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** The MAC for an address, base64url, truncated. */
export function unsubscribeSignature(email: string): string {
  return createHmac('sha256', secret())
    .update(`${PURPOSE}:${normalizeEmail(email)}`, 'utf8')
    .digest('base64url')
    .slice(0, SIGNATURE_LENGTH);
}

/** Constant-time check that `signature` was issued for `email`. */
export function unsubscribeSignatureMatches(email: string, signature: string | null): boolean {
  if (!signature) return false;
  try {
    return timingSafeEquals(signature, unsubscribeSignature(email));
  } catch {
    // A missing secret must not read as "valid".
    return false;
  }
}

/**
 * The unsubscribe URL for an address.
 *
 * `origin` is passed in rather than read here so this module stays pure and the
 * caller — which already knows the site origin for the recovery link in the same
 * email — decides.
 */
export function unsubscribeUrl(origin: string, email: string, locale?: string): string {
  const params = new URLSearchParams({
    e: normalizeEmail(email),
    s: unsubscribeSignature(email),
  });
  if (locale) params.set('locale', locale);
  return `${origin}/api/cms/commerce/unsubscribe?${params.toString()}`;
}
