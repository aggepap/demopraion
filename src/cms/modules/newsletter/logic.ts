/**
 * Newsletter decisions that do not touch the database.
 *
 * Separated from `subscribers.ts` for the same reason every other module here
 * does it: these are the parts worth testing, and none of them need a
 * connection. What they have in common is that a row cannot be repaired
 * afterwards if they are wrong — a mis-normalised address is a duplicate
 * subscriber that an unsubscribe will miss, and an empty consent record is a
 * row that claims consent while holding none.
 */
import { z } from 'zod';

import { normalizeEmail } from '../../core/email/unsubscribe';
import type { NewsletterSubscriber } from '../../db/adapters/mysql/schema/forms';

/** `source_page_slug` on the subscribers table. */
const MAX_SOURCE = 191;
/** `locale`. */
const MAX_LOCALE = 8;
/** `consent_text` is TEXT, but there is no reason for this to be long. */
const MAX_CONSENT = 255;

/**
 * What a signup form may send.
 *
 * `_hp` is the honeypot and is accepted rather than rejected: the route drops a
 * filled one and answers 200, so a bot cannot learn which field caught it. A
 * 422 naming `_hp` would be a map to getting past it.
 *
 * The address is normalised in the schema rather than at the call site, so
 * every caller gets the same key — `email` is UNIQUE, and `A@B.gr` arriving as
 * a second row is an address an unsubscribe will not silence.
 */
export const newsletterSubscribeBody = z.object({
  email: z
    .string()
    .trim()
    .min(1)
    .max(254)
    .email()
    .transform(normalizeEmail),
  /** Which placement earned the signup — `footer`, `sidebar`, `article:<slug>`. */
  source: z.string().trim().max(MAX_SOURCE).optional(),
  locale: z.string().trim().max(MAX_LOCALE).optional(),
  _hp: z.string().optional(),
});

export type NewsletterSubscribeInput = z.infer<typeof newsletterSubscribeBody>;

/**
 * The consent record written alongside the address.
 *
 * Six months after the fact, "they subscribed" answers nothing. Which placement
 * they used is the difference between a complaint that can be answered and one
 * that cannot, and it is the only context this form collects — there is no
 * separate consent checkbox to quote, because the forms ask for an address and
 * nothing else.
 */
export function consentTextFor(source: string | null | undefined): string {
  const where = source?.trim();
  const text = where ? `Newsletter signup (${where})` : 'Newsletter signup';
  return text.slice(0, MAX_CONSENT);
}

/**
 * What a signup turned out to be.
 *
 * Two of the three are a success. `resubscribed` is somebody who had asked to
 * leave and has come back through the form — that is a signup, and telling them
 * they were "already subscribed" would be both wrong and discouraging.
 */
export type SubscribeOutcome = 'subscribed' | 'already-subscribed' | 'resubscribed';

/** Every outcome except the one the forms show a different message for. */
export function isSubscribeSuccess(outcome: SubscribeOutcome): boolean {
  return outcome !== 'already-subscribed';
}

/**
 * Which of the three a signup is, given whatever row already existed.
 *
 * Separated from the write so the decision can be read on its own — the
 * difference between `already-subscribed` and `resubscribed` is one nullable
 * column, and getting it backwards is invisible until a returning subscriber is
 * turned away.
 */
export function subscribeOutcome(
  existing: { unsubscribedAt: Date | null } | null | undefined,
): SubscribeOutcome {
  if (!existing) return 'subscribed';
  return existing.unsubscribedAt ? 'resubscribed' : 'already-subscribed';
}

export type SubscriberStatus = 'active' | 'unsubscribed';

/** A subscriber as the admin screen sees one. */
export interface SubscriberView {
  id: number;
  email: string;
  locale: string;
  status: SubscriberStatus;
  /** The placement that earned the signup. */
  source: string | null;
  consentText: string;
  /** ISO strings: this is serialised to a client component. */
  subscribedAt: string;
  unsubscribedAt: string | null;
}

/**
 * A stored row, narrowed to what the screen is for.
 *
 * `ip_hash` and `ua` are deliberately absent. They are collected to investigate
 * a flood of fake signups, which is a different job from managing a mailing
 * list — putting them in a list response hands them to every role that can read
 * it, for a screen that has no use for them.
 */
export function subscriberView(row: NewsletterSubscriber): SubscriberView {
  return {
    id: row.id,
    email: row.email,
    locale: row.locale,
    status: row.unsubscribedAt ? 'unsubscribed' : 'active',
    source: row.sourcePageSlug,
    consentText: row.consentText,
    subscribedAt: row.consentGivenAt.toISOString(),
    unsubscribedAt: row.unsubscribedAt ? row.unsubscribedAt.toISOString() : null,
  };
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/** Clamp paging, so a query string cannot ask for the whole table in one go. */
export function subscriberPage(opts: { page?: number; pageSize?: number }): {
  page: number;
  pageSize: number;
} {
  // `??` for absence and a finiteness check for junk — an `||` chain here
  // treats an explicit `pageSize=0` as "unset" and hands back the default,
  // which is the opposite of clamping it.
  const int = (value: number | undefined, fallback: number) =>
    value === undefined || !Number.isFinite(value) ? fallback : Math.trunc(value);

  return {
    page: Math.max(1, int(opts.page, 1)),
    pageSize: Math.min(MAX_PAGE_SIZE, Math.max(1, int(opts.pageSize, DEFAULT_PAGE_SIZE))),
  };
}
