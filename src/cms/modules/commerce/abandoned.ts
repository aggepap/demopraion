/**
 * Abandoned-cart capture + recovery (addendum §9).
 *
 * Flow: the checkout form captures `{ email, cart }` (best-effort, debounced)
 * → a reminder email with a tokenised recovery link is sent later by a job
 * (cron- or admin-triggered) → clicking the link repopulates the cart and
 * returns to checkout. If an order with the same email lands first, the record
 * flips to `converted` and no reminder goes out.
 *
 * Sending has NO scheduler in this stack, so `processReminders` is exposed via
 * a route guarded by a shared secret (`COMMERCE_CRON_SECRET`) OR an admin
 * session — call it from an external cron or the admin "Send reminders" button.
 */
import 'server-only';

import { and, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  badRequest,
  createRoute,
  idParam,
  isSuppressed,
  logAudit,
  noContent,
  notFound,
  ok,
  paginated,
  sendGraphMail,
  suppressedAmong,
  unsubscribeUrl,
} from '../../core';
import { emailColor } from '../../core/email/brand';
import { localeOrDefault, localePrefix } from '../../core/paths';
import { authorizeCronRequest } from '../../core/cron/policy';
import { getDb, schema } from '../../db';
import type { AbandonedStatus } from '../../db/adapters/mysql/schema/abandoned';
import { SITE_URL } from '../../../lib/seo/schemas';
import { PERMISSIONS, requireApiPerm } from '../auth';
import { getProduct, resolvePrice } from './read';

export type { AbandonedStatus } from '../../db/adapters/mysql/schema/abandoned';

/** How long after capture (minutes) a cart is "abandoned". Env-tunable. */
function reminderDelayMinutes(): number {
  const raw = Number(process.env.COMMERCE_ABANDONED_DELAY_MINUTES);
  return Number.isFinite(raw) && raw > 0 ? raw : 60;
}

/**
 * How long a recovery token stays usable after the cart was captured.
 *
 * The token used to have no lifetime at all: `recoverCart` looked the row up,
 * stamped `recoveredAt`, and left the token working — so a link that leaked into
 * an access log, a browser history, or a forwarded email kept returning that
 * shopper's cart for as long as the row existed. Nothing was single-use and
 * nothing expired.
 *
 * A window rather than one-shot use, because one-shot punishes the honest case:
 * people click a link, get distracted, and come back to the same email. Fourteen
 * days is far longer than the reminder is useful (it is sent an hour after
 * capture) and short enough that a leaked link is not a standing key.
 */
const RECOVERY_TTL_MS = 14 * 24 * 60 * 60_000;

/**
 * Most reminders this site will send in any rolling 24 hours.
 *
 * A ceiling exists because capture is public and unauthenticated: it accepts any
 * address, rate-limited only per IP (20/min), which is ~1,200 distinct addresses
 * an hour from one source. Each becomes one reminder. Without a cap, a scripted
 * flood turns this site into a bulk mailer to strangers overnight — and the
 * damage does not land on marketing mail, it lands on the *transactional* mail
 * sharing the same Graph tenant: order confirmations, booking payment links,
 * status updates. Those are what stop being delivered when a sending domain's
 * reputation goes.
 *
 * 200/day is far above a real shop's abandoned-cart volume and far below the
 * volume that damages a domain. Reached, the job simply stops for the day and
 * says so — the carts stay `pending` and go out tomorrow.
 */
function reminderDailyMax(): number {
  const raw = Number(process.env.COMMERCE_ABANDONED_DAILY_MAX);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 200;
}

/**
 * How many reminders have gone out in the last 24 hours, for the ceiling above.
 *
 * Counted from `reminder_sent_at` rather than a separate counter so the number
 * cannot drift from what actually happened, and so restarting the process does
 * not reset the day.
 */
export async function remindersSentSince(since: Date): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)` })
    .from(schema.abandonedCarts)
    .where(gte(schema.abandonedCarts.reminderSentAt, since));
  return Number(row?.n ?? 0);
}

/** Pure: how many of `due` may be sent given the ceiling and today's tally. */
export function reminderBudget(sentToday: number, dailyMax: number): number {
  return Math.max(0, dailyMax - sentToday);
}

/**
 * A captured cart line — the full client `CartItem` (extra fields pass through
 * so the recovery link restores variations / quantity rules faithfully). Only
 * the fields used here are typed.
 */
export interface AbandonedItem {
  slug: string;
  title: string;
  quantity: number;
  unitPrice: number;
  currency?: string;
  imageUrl?: string;
  optionsLabel?: string;
  [key: string]: unknown;
}

/** Sum of `unitPrice × quantity` in minor units (cents). Pure. */
export function cartSubtotalMinor(items: AbandonedItem[]): number {
  return items.reduce((sum, i) => sum + Math.round(Number(i.unitPrice) * 100) * Math.max(1, Math.floor(i.quantity)), 0);
}

export interface CaptureCartInput {
  email: string;
  items: AbandonedItem[];
  currency: string;
  locale?: string;
}

/**
 * Rebuild the captured lines from the catalogue, keeping only real products.
 *
 * This endpoint is public and unauthenticated, it accepts any email address
 * with no proof the sender owns it, and what it stores is later mailed to that
 * address by the reminder job. With the client's own `title` text kept as-is,
 * that chain is a way to send a stranger arbitrary wording from this site's own
 * domain — the message is HTML-escaped, so not an injection, but the words in
 * it were still the sender's to choose, and they arrive carrying the site's
 * reputation.
 *
 * Taking the title from the published product document removes the choice. An
 * item whose slug names no published product is dropped rather than kept as
 * free text, which also stops the table filling with invented carts.
 *
 * `optionsLabel` is not carried over: it is decoration on the reminder, and
 * there is no cheap server-side value to replace it with.
 */
/**
 * An image reference we are willing to store and later hand back to a browser.
 *
 * `imageUrl` arrives through `captureBody`'s `.passthrough()` and is written into
 * an `<img src>` by `CartDrawer` when the cart is recovered. Capture is public
 * and unauthenticated, so an arbitrary absolute URL there means anyone can make a
 * recovering shopper's browser call out to a host of their choosing — the visitor's
 * IP and referrer, handed over on page load. Site-relative paths only: that covers
 * `/api/cms/media/file/<uuid>`, which is the only shape this app ever produces.
 *
 * `//evil.example` is rejected deliberately — it starts with `/` but is
 * protocol-relative, i.e. absolute.
 */
export function safeImageUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return undefined;
  return trimmed;
}

/**
 * Re-resolve every line against the catalogue.
 *
 * The product was already fetched here to get an authoritative `title`; the price
 * and quantity were taken from the request unchanged and fed straight into
 * `cartSubtotalMinor`. Capture needs no authentication, so anyone could store a
 * cart claiming any value they liked, and the figure an admin reads in the
 * abandoned-cart report was simply whatever the caller typed. The document is
 * right here — there is no reason to believe the client over it.
 *
 * Checkout was never at risk (it re-prices from the catalogue independently), so
 * this is about the report telling the truth, and about not storing a number the
 * business might act on.
 */
async function catalogItems(items: AbandonedItem[], locale: string): Promise<AbandonedItem[]> {
  const out: AbandonedItem[] = [];
  for (const item of items) {
    const doc = await getProduct(item.slug, locale);
    if (!doc) continue;
    const data = doc.data as Record<string, unknown>;
    const title = typeof data.title === 'string' && data.title.trim() ? data.title.trim() : doc.slug;
    const variationId = typeof item.variationId === 'string' ? item.variationId : undefined;

    const rest: AbandonedItem = {
      ...item,
      title,
      // Server-side price for the variation actually named, never the posted one.
      unitPrice: resolvePrice(data, variationId),
      quantity: Math.min(9999, Math.max(1, Math.floor(Number(item.quantity) || 1))),
    };
    const image = safeImageUrl(item.imageUrl);
    if (image) rest.imageUrl = image;
    else delete rest.imageUrl;
    delete rest.optionsLabel;
    out.push(rest);
  }
  return out;
}

/**
 * Upsert the shopper's in-progress cart. One live record per email: a repeat
 * capture updates the snapshot but never resets the status (so a reminded cart
 * isn't re-reminded, and a converted one stays converted).
 *
 * An address on the suppression list is not stored at all. The only purpose of
 * the record is the reminder, which will never be sent to them — so keeping their
 * cart and email would be holding personal data for a message that cannot go out,
 * from someone who explicitly asked not to be contacted. The caller can't tell:
 * checkout fires this and ignores the response by design.
 */
export async function captureCart(
  input: CaptureCartInput,
  /** Site facts the core cannot read itself; the capture route binder supplies them. */
  site: { defaultLocale: string },
): Promise<{ token: string }> {
  const db = getDb();
  if (await isSuppressed(input.email)) return { token: '' };

  // Stored on the cart: it decides the reminder's language and its link prefix.
  const locale = localeOrDefault(input.locale, site.defaultLocale);
  const items = await catalogItems(input.items, locale);
  if (!items.length) throw badRequest('None of these items is available.');
  const subtotal = cartSubtotalMinor(items);

  const [existing] = await db
    .select({ id: schema.abandonedCarts.id, token: schema.abandonedCarts.token })
    .from(schema.abandonedCarts)
    .where(and(eq(schema.abandonedCarts.email, input.email), inArray(schema.abandonedCarts.status, ['pending', 'reminded'])))
    .limit(1);

  if (existing) {
    await db
      .update(schema.abandonedCarts)
      .set({ items, currency: input.currency, locale, subtotal })
      .where(eq(schema.abandonedCarts.id, existing.id));
    return { token: existing.token };
  }

  const token = crypto.randomUUID();
  await db.insert(schema.abandonedCarts).values({
    token,
    email: input.email,
    items,
    currency: input.currency,
    locale,
    subtotal,
  });
  return { token };
}

/** The recovery link a reminder points at, prefixed for the cart's locale (`defaultLocale` is unprefixed). */
export function recoverUrl(token: string, locale: string | null | undefined, defaultLocale: string): string {
  return `${SITE_URL}${localePrefix(locale, defaultLocale)}/cart/recover?token=${encodeURIComponent(token)}`;
}

/** Fetch a cart by its recovery token and mark it recovered (best-effort). */
export async function recoverCart(
  token: string,
): Promise<{ items: AbandonedItem[]; currency: string; locale: string | null } | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.abandonedCarts)
    .where(eq(schema.abandonedCarts.token, token))
    .limit(1);
  if (!row) return null;

  /*
   * An expired token is indistinguishable from a wrong one.
   *
   * Returning null rather than a distinct "expired" answer keeps this from
   * confirming that a given token was ever real — the same reasoning
   * `redeemPaymentToken` applies to booking links.
   */
  const issuedAt = row.reminderSentAt ?? row.createdAt;
  if (Date.now() - issuedAt.getTime() > RECOVERY_TTL_MS) return null;

  if (row.status !== 'converted') {
    await db
      .update(schema.abandonedCarts)
      .set({ recoveredAt: new Date() })
      .where(eq(schema.abandonedCarts.id, row.id));
  }
  return { items: (row.items as AbandonedItem[]) ?? [], currency: row.currency, locale: row.locale };
}

/** Mark any open cart for `email` as converted (called after an order lands). */
export async function markConvertedByEmail(email: string): Promise<void> {
  const db = getDb();
  await db
    .update(schema.abandonedCarts)
    .set({ status: 'converted' })
    .where(and(eq(schema.abandonedCarts.email, email), inArray(schema.abandonedCarts.status, ['pending', 'reminded'])));
}

// ── Reminder job ──────────────────────────────────────────────────────────────

const EMAIL_COPY: Record<
  'el' | 'en',
  { subject: string; intro: string; cta: string; outro: string; unsubscribe: string }
> = {
  el: {
    subject: 'Ξεχάσατε κάτι στο καλάθι σας;',
    intro: 'Τα προϊόντα σας σας περιμένουν. Ολοκληρώστε την παραγγελία σας όποτε θέλετε.',
    cta: 'Επιστροφή στο καλάθι',
    outro: 'Αν ολοκληρώσατε ήδη την αγορά σας, αγνοήστε αυτό το μήνυμα.',
    unsubscribe: 'Δεν θέλετε τέτοιες υπενθυμίσεις; Διαγραφή',
  },
  en: {
    subject: 'You left something in your cart',
    intro: 'Your items are waiting. Pick up where you left off whenever you like.',
    cta: 'Return to your cart',
    outro: 'If you already completed your purchase, please ignore this message.',
    unsubscribe: 'Don’t want reminders like this? Unsubscribe',
  },
};

function esc(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * The reminder body. Exported so `test/commerce/abandoned.test.ts` can assert the
 * unsubscribe link is in it — the whole point of that link is that it is present
 * on *every* send, which is a claim worth a test rather than a code review.
 */
export function reminderHtml(cart: typeof schema.abandonedCarts.$inferSelect, defaultLocale: string): string {
  // The cart's own locale, or the site's main language for a cart stored without one.
  const locale: 'el' | 'en' = localeOrDefault(cart.locale, defaultLocale) === 'el' ? 'el' : 'en';
  const c = EMAIL_COPY[locale];
  const url = recoverUrl(cart.token, locale, defaultLocale);
  const items = (cart.items as AbandonedItem[]) ?? [];
  const rows = items
    .map(
      (i) =>
        `<li style="margin:4px 0;">${esc(i.title)}${i.optionsLabel ? ` — ${esc(i.optionsLabel)}` : ''} × ${Math.max(1, Math.floor(i.quantity))}</li>`,
    )
    .join('');
  /*
   * The unsubscribe link. This is the only unsolicited mail the site sends, and
   * it had no way to opt out of — which is both a consent problem and a
   * deliverability one, since complaints earned here are charged against the
   * transactional mail sharing the tenant.
   *
   * It is a link in the body rather than a `List-Unsubscribe` header because
   * Graph's `sendMail` will not carry one: custom `internetMessageHeaders` must
   * "name them starting with 'x-'" (Microsoft's own wording on the `message`
   * resource), and `List-Unsubscribe` does not. Setting it needs the raw-MIME
   * send path instead — worth doing, but it changes how every message is
   * transmitted and cannot be verified without a live Graph credential, so it is
   * deliberately not bundled in here.
   */
  const optOut = unsubscribeUrl(SITE_URL, cart.email, locale);

  return (
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a;">` +
    `<p>${esc(c.intro)}</p>` +
    (rows ? `<ul style="padding-left:18px;">${rows}</ul>` : '') +
    `<p style="margin:20px 0;"><a href="${esc(url)}" style="background:${emailColor('midnight-navy')};color:#fff;padding:10px 18px;border-radius:4px;text-decoration:none;">${esc(c.cta)}</a></p>` +
    `<p style="color:#777;font-size:12px;">${esc(c.outro)}</p>` +
    `<p style="color:#777;font-size:12px;"><a href="${esc(optOut)}" style="color:#777;">${esc(c.unsubscribe)}</a></p>` +
    `</div>`
  );
}

/** Carts eligible for a reminder: pending, older than the delay, not yet reminded. */
export async function findDueForReminder(limit = 50): Promise<(typeof schema.abandonedCarts.$inferSelect)[]> {
  const db = getDb();
  const cutoff = new Date(Date.now() - reminderDelayMinutes() * 60_000);
  return db
    .select()
    .from(schema.abandonedCarts)
    .where(
      and(
        eq(schema.abandonedCarts.status, 'pending'),
        isNull(schema.abandonedCarts.reminderSentAt),
        lt(schema.abandonedCarts.createdAt, cutoff),
      ),
    )
    .orderBy(schema.abandonedCarts.createdAt)
    .limit(limit);
}

/**
 * Send due reminders (best-effort per cart).
 *
 * Two gates stand in front of the send, both because capture is public and
 * accepts any address:
 *
 * - **Suppression.** Anyone who used the unsubscribe link is skipped, and their
 *   cart is marked `reminded` so it stops being due. Filtered as one query for
 *   the whole batch rather than per cart.
 * - **A daily ceiling.** See `reminderDailyMax`. When it is reached the run stops
 *   and leaves the remaining carts `pending`, so they go out on the next run
 *   rather than being silently consumed.
 *
 * Returns what happened rather than just a count, so the admin button and a cron
 * log can both say why nothing was sent.
 */
export async function processReminders(site: { defaultLocale: string }): Promise<{
  sent: number;
  skippedSuppressed: number;
  cappedBy: number;
}> {
  const due = await findDueForReminder();
  const db = getDb();

  const suppressed = await suppressedAmong(due.map((c) => c.email));
  const sendable = due.filter((c) => !suppressed.has(c.email.trim().toLowerCase()));
  const skippedSuppressed = due.length - sendable.length;

  // Retire suppressed carts so they are not re-evaluated on every run. Their
  // reminder is deliberately never sent; the row records that it was considered.
  for (const cart of due) {
    if (!suppressed.has(cart.email.trim().toLowerCase())) continue;
    await db
      .update(schema.abandonedCarts)
      .set({ status: 'reminded', reminderSentAt: new Date() })
      .where(eq(schema.abandonedCarts.id, cart.id));
  }

  const dailyMax = reminderDailyMax();
  const sentToday = await remindersSentSince(new Date(Date.now() - 24 * 60 * 60_000));
  const budget = reminderBudget(sentToday, dailyMax);
  const batch = sendable.slice(0, budget);
  const cappedBy = sendable.length - batch.length;
  if (cappedBy > 0) {
    console.warn('[commerce/abandoned] daily reminder ceiling reached', {
      dailyMax,
      sentToday,
      deferred: cappedBy,
    });
  }

  let sent = 0;
  for (const cart of batch) {
    const locale: 'el' | 'en' = localeOrDefault(cart.locale, site.defaultLocale) === 'el' ? 'el' : 'en';
    try {
      await sendGraphMail({
        to: cart.email,
        subject: EMAIL_COPY[locale].subject,
        html: reminderHtml(cart, site.defaultLocale),
      });
      sent++;
    } catch (err) {
      console.error('[commerce/abandoned] reminder send failed', { id: cart.id }, err);
    }
    // Mark reminded regardless of send outcome so a broken address isn't retried forever.
    await db
      .update(schema.abandonedCarts)
      .set({ status: 'reminded', reminderSentAt: new Date() })
      .where(eq(schema.abandonedCarts.id, cart.id));
  }
  return { sent, skippedSuppressed, cappedBy };
}

// ── Admin read ────────────────────────────────────────────────────────────────

export interface AbandonedSummary {
  id: number;
  email: string;
  itemCount: number;
  subtotal: number;
  currency: string;
  status: AbandonedStatus;
  locale: string | null;
  reminderSentAt: Date | null;
  recoveredAt: Date | null;
  createdAt: Date;
}

export interface ListAbandonedOptions {
  status?: AbandonedStatus;
  page?: number;
  pageSize?: number;
}

export async function listAbandoned(opts: ListAbandonedOptions = {}): Promise<{
  items: AbandonedSummary[];
  page: number;
  pageSize: number;
  total: number;
}> {
  const db = getDb();
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));
  const where = opts.status ? eq(schema.abandonedCarts.status, opts.status) : undefined;

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(schema.abandonedCarts)
    .where(where);

  const rows = await db
    .select()
    .from(schema.abandonedCarts)
    .where(where)
    .orderBy(desc(schema.abandonedCarts.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return {
    items: rows.map((r) => ({
      id: r.id,
      email: r.email,
      itemCount: Array.isArray(r.items) ? r.items.length : 0,
      subtotal: r.subtotal,
      currency: r.currency,
      status: r.status,
      locale: r.locale,
      reminderSentAt: r.reminderSentAt,
      recoveredAt: r.recoveredAt,
      createdAt: r.createdAt,
    })),
    page,
    pageSize,
    total: Number(total),
  };
}

/**
 * One cart, by id — read before a delete so the audit entry can say what went.
 */
export async function getAbandonedCart(id: number) {
  const [row] = await getDb()
    .select()
    .from(schema.abandonedCarts)
    .where(eq(schema.abandonedCarts.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * Delete one captured cart.
 *
 * The table had no delete path of any kind — not through the API, not through
 * the admin — which made every captured cart permanent. Two consequences, and
 * the smaller one is the test suite's: a spec that captures a cart cannot undo
 * it, so residue accumulated across runs until unrelated specs matched two rows
 * instead of one and failed on a strict-mode violation.
 *
 * The larger one is that this table holds an email address and a shopping
 * history belonging to someone who never completed a purchase, and there was no
 * way to honour a request to erase it short of a manual `DELETE` against the
 * database. `unsubscribe` stops the mail; it does not remove the record.
 */
export async function deleteAbandonedCart(id: number): Promise<void> {
  await getDb().delete(schema.abandonedCarts).where(eq(schema.abandonedCarts.id, id));
}

// ── Route factories ───────────────────────────────────────────────────────────

const captureBody = z.object({
  email: z.string().trim().email().max(254),
  currency: z.string().trim().max(3),
  locale: z.string().trim().max(8).optional(),
  items: z
    .array(
      // Passthrough keeps the rest of the client CartItem (variationId, sku,
      // qty rules, virtual…) so recovery restores the exact line.
      z
        .object({
          slug: z.string().trim().max(191),
          title: z.string().trim().max(255),
          quantity: z.coerce.number().int().positive().max(9999),
          unitPrice: z.coerce.number().min(0),
        })
        .passthrough(),
    )
    .min(1)
    .max(100),
});

/** Public POST — capture the checkout cart. Rate-limited; best-effort. */
export function createCaptureRoute(opts: {
  /** The site's default locale (`config.defaultLocale`), stored on a cart captured without one. */
  defaultLocale: string;
}) {
  return createRoute({
    rateLimit: { scope: 'commerce-abandoned', max: 20, windowMs: 60_000 },
    input: captureBody,
    handler: async ({ input }) => ok(await captureCart(input, { defaultLocale: opts.defaultLocale })),
  });
}

const recoverQuery = z.object({ token: z.string().trim().min(1).max(36) });

/**
 * Public GET — fetch a cart by recovery token (repopulates the client cart).
 *
 * Rate-limited like its capture sibling. The token is a 122-bit UUID, so this
 * is not the thing standing between an attacker and someone's cart — but it was
 * the one route in this file with no cap, which made it the cheapest way to
 * hammer the database from outside, and an uncapped endpoint is also where a
 * future weaker token would go unnoticed.
 */
export function createRecoverRoute() {
  return createRoute({
    rateLimit: { scope: 'commerce-recover', max: 60, windowMs: 60_000 },
    query: recoverQuery,
    handler: async ({ query }) => {
      const cart = query?.token ? await recoverCart(query.token) : null;
      return ok(cart ?? { items: [], currency: 'EUR', locale: null });
    },
  });
}

const listQuery = z.object({
  status: z.enum(['pending', 'reminded', 'converted']).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

/** GET /api/cms/abandoned-carts — admin list. */
export function abandonedListRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.ordersRead),
    query: listQuery,
    handler: async ({ query }) => {
      const result = await listAbandoned(query ?? {});
      return paginated(result.items, { page: result.page, pageSize: result.pageSize, total: result.total });
    },
  });
}

/**
 * DELETE /api/cms/abandoned-carts/:id — remove one captured cart.
 *
 * `ordersWrite`, matching the reminder job: the two things an admin can do to a
 * captured cart are mail it and drop it, and neither belongs to a read-only
 * role. 404 on an id that is already gone, like every other delete here, so a
 * caller can tell "I removed it" from "there was nothing to remove".
 */
export function abandonedDeleteRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.ordersWrite),
    handler: async ({ params, auth }) => {
      const id = idParam(params.id);
      const before = await getAbandonedCart(id);
      if (!before) throw notFound('Abandoned cart not found.');
      await deleteAbandonedCart(id);
      await logAudit({
        userId: auth.userId,
        action: 'abandoned_cart.delete',
        subjectType: 'abandoned_cart',
        subjectId: id,
        // The row is gone; without this the log would record that *something*
        // was deleted and nothing about whose cart it was. Stored on the row —
        // the audit list route does not select `before`, so reading it back
        // currently means querying `audit_logs` directly.
        before: { email: before.email, subtotal: before.subtotal, status: before.status },
      });
      return noContent();
    },
  });
}

/**
 * POST /api/cms/abandoned-carts/remind — run the reminder job. Authorised by a
 * shared secret header (for cron) OR an admin `ordersWrite` session.
 */
export function abandonedRemindRoute(opts: {
  /** The site's default locale (`config.defaultLocale`) — reminders for carts without a locale use it. */
  defaultLocale: string;
}) {
  return createRoute({
    /*
     * Rate-limited like its siblings, which it was not.
     *
     * The guard below is a shared-secret comparison reachable by anyone who can
     * send a header. `authorizeCronRequest` (constant-time) keeps the comparison from leaking where a
     * guess went wrong, but nothing capped the number of guesses — and every
     * accepted call sends real email, so an uncapped endpoint is a cost and
     * deliverability problem as well as a guessing one. A cron job needs a
     * handful of calls a minute at most, and so does a person pressing the button.
     */
    rateLimit: { scope: 'commerce-remind', max: 5, windowMs: 60_000 },
    guard: async (req) => {
      // Under the same rule as `CMS_CRON_SECRET`: a secret shorter than
      // `CRON_SECRET_MIN_LENGTH` authorises nothing, so a guessable one cannot
      // send the reminder emails.
      if (authorizeCronRequest(req.headers.get('x-cron-secret'), process.env.COMMERCE_CRON_SECRET)) {
        return { userId: null as number | null };
      }
      return requireApiPerm(PERMISSIONS.ordersWrite);
    },
    handler: async () => ok(await processReminders({ defaultLocale: opts.defaultLocale })),
  });
}
