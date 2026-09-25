import 'server-only';

import { and, desc, eq, isNotNull, isNull, like, or, sql } from 'drizzle-orm';

import { getDb, schema } from '../../db';
import { likeTerm } from '../../core/db/like';
import {
  consentTextFor,
  subscribeOutcome,
  subscriberPage,
  subscriberView,
  type SubscribeOutcome,
  type SubscriberView,
} from './logic';

export interface SubscribeInput {
  email: string;
  source?: string;
  /** Resolved by the caller — the visitor's locale or the site default, never guessed here. */
  locale: string;
  ua?: string | null;
}

/**
 * Record a newsletter signup. Idempotent on the address.
 *
 * `email` is UNIQUE, so a second signup from the same person is an update, not
 * an error — and it deliberately clears `unsubscribed_at`: someone who left and
 * comes back through the form has re-consented, and leaving the old timestamp
 * would keep them suppressed while the UI thanked them for subscribing.
 *
 * `consent_given_at` is refreshed for a returning subscriber, because the
 * consent worth holding is the most recent one — that is the act a later
 * complaint is answered with. It is deliberately NOT touched for somebody who
 * is already on the list and simply retyped their address: overwriting the date
 * they agreed with the date they happened to fill the form in again would lose
 * the only record of when consent was actually given.
 */
export async function subscribe(input: SubscribeInput): Promise<SubscribeOutcome> {
  const db = getDb();
  const now = new Date();
  const consentText = consentTextFor(input.source);

  /*
   * Read before writing, because the caller needs to know which of the three
   * this was and an upsert cannot say.
   *
   * The insert below keeps its `onDuplicateKeyUpdate`: two signups for the same
   * address racing each other both read nothing here, and the second must land
   * as an update rather than a duplicate-key error. In that race the outcome
   * reported to one of them is optimistic — which costs a message, not a row.
   */
  const [existing] = await db
    .select({ unsubscribedAt: schema.newsletterSubscribers.unsubscribedAt })
    .from(schema.newsletterSubscribers)
    .where(eq(schema.newsletterSubscribers.email, input.email))
    .limit(1);
  const outcome = subscribeOutcome(existing);

  // Already on the list and active: nothing to change. Refreshing the consent
  // timestamp here would overwrite the record of when they actually agreed
  // with the date they happened to retype their address.
  if (outcome === 'already-subscribed') return outcome;

  await db
    .insert(schema.newsletterSubscribers)
    .values({
      email: input.email,
      locale: input.locale,
      consentText,
      consentGivenAt: now,
      sourcePageSlug: input.source ?? null,
      ua: input.ua?.slice(0, 255) ?? null,
    })
    .onDuplicateKeyUpdate({
      set: {
        consentText,
        consentGivenAt: now,
        unsubscribedAt: null,
        locale: input.locale,
        sourcePageSlug: input.source ?? null,
        updatedAt: now,
      },
    });

  return outcome;
}

export type SubscriberFilter = 'all' | 'active' | 'unsubscribed';

export interface ListSubscribersOptions {
  status?: SubscriberFilter;
  /** Substring match against the address and the placement. */
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface ListSubscribersResult {
  items: SubscriberView[];
  page: number;
  pageSize: number;
  total: number;
  /** Counts for the filter tabs — the whole list, not the current page. */
  counts: { all: number; active: number; unsubscribed: number };
}

export async function listSubscribers(
  opts: ListSubscribersOptions = {},
): Promise<ListSubscribersResult> {
  const db = getDb();
  const { page, pageSize } = subscriberPage(opts);

  const conditions = [];
  if (opts.status === 'active') conditions.push(isNull(schema.newsletterSubscribers.unsubscribedAt));
  if (opts.status === 'unsubscribed')
    conditions.push(isNotNull(schema.newsletterSubscribers.unsubscribedAt));
  if (opts.search) {
    const term = likeTerm(opts.search);
    const match = or(
      like(schema.newsletterSubscribers.email, term),
      like(schema.newsletterSubscribers.sourcePageSlug, term),
    );
    if (match) conditions.push(match);
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(schema.newsletterSubscribers)
    .where(where);

  const rows = await db
    .select()
    .from(schema.newsletterSubscribers)
    .where(where)
    .orderBy(desc(schema.newsletterSubscribers.consentGivenAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  // One grouped scan rather than three counts: the tabs are always all shown,
  // so asking three times for the same partition is three table reads.
  const grouped = await db
    .select({
      unsubscribed: sql<number>`sum(case when ${schema.newsletterSubscribers.unsubscribedAt} is null then 0 else 1 end)`,
      all: sql<number>`count(*)`,
    })
    .from(schema.newsletterSubscribers);
  const allCount = Number(grouped[0]?.all ?? 0);
  const unsubscribed = Number(grouped[0]?.unsubscribed ?? 0);

  return {
    items: rows.map(subscriberView),
    page,
    pageSize,
    total: Number(total),
    counts: { all: allCount, active: allCount - unsubscribed, unsubscribed },
  };
}

/**
 * Unsubscribe or resubscribe one person.
 *
 * The row is kept either way. A deleted subscriber is one who can be re-added
 * by the next form submission with nothing to say they had asked not to be —
 * the timestamp is the record that they did.
 */
export async function setSubscribed(id: number, subscribed: boolean): Promise<SubscriberView | null> {
  const db = getDb();
  await db
    .update(schema.newsletterSubscribers)
    .set({ unsubscribedAt: subscribed ? null : new Date() })
    .where(eq(schema.newsletterSubscribers.id, id));
  return getSubscriber(id);
}

export async function getSubscriber(id: number): Promise<SubscriberView | null> {
  const [row] = await getDb()
    .select()
    .from(schema.newsletterSubscribers)
    .where(eq(schema.newsletterSubscribers.id, id))
    .limit(1);
  return row ? subscriberView(row) : null;
}

/**
 * Erase a subscriber outright.
 *
 * Separate from unsubscribing, and the rarer of the two: this is the erasure
 * request, not the "stop emailing me". It loses the consent record along with
 * the address, which is why the admin asks before doing it.
 */
export async function deleteSubscriber(id: number): Promise<void> {
  await getDb()
    .delete(schema.newsletterSubscribers)
    .where(eq(schema.newsletterSubscribers.id, id));
}
