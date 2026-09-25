/**
 * ─────────────────────────────────────────────────────────────────────────
 *  THE ONE PLACE THE NEWSLETTER FORMS SUBMIT THROUGH.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Every newsletter signup on the site funnels through this function: the
 * sidebar card on articles / answers / scenarios (`<NewsletterWidget>`) and
 * the footer band that runs across all pages (`<NewsletterBand>`).
 *
 * It used to be a stub that slept and resolved, so both forms reported success
 * and the address went nowhere. It now posts to `/api/newsletter`, which stores
 * the subscriber (and the consent behind them) in `newsletter_subscribers` —
 * the table the checkout opt-in already writes to. The admin manages the list
 * at `/admin/newsletter`.
 *
 * It throws on failure, which is what both callers were already written for:
 * each catches and renders an error rather than a false "you're subscribed".
 *
 * `source` says which placement earned the signup — `footer`, `sidebar`,
 * `article:<slug>` — and is stored on the row, so "is the footer band worth
 * keeping?" has an answer. `locale` is the language they were reading in, and
 * decides which language they are eventually written to in.
 *
 * The route answers 404 when the `newsletter` module is switched off in
 * Settings → Modules; that surfaces here as a thrown error and the forms show
 * their error state. In practice the forms are not rendered at all while the
 * module is off — see `NewsletterProvider`.
 *
 * Onward delivery to Brevo is a separate job and belongs on the server, reading
 * from the table — never from the browser, where the API key would be readable
 * by anyone who opens devtools. `newsletter_subscribers` carries
 * `mailchimp_id` / `mailchimp_status` / `last_synced_at` for exactly that.
 */

/** Mirrors `SubscribeOutcome` in the newsletter module — see the note below. */
export type NewsletterOutcome = 'subscribed' | 'already-subscribed' | 'resubscribed';

const OUTCOMES: readonly string[] = ['subscribed', 'already-subscribed', 'resubscribed'];

/**
 * Declared here rather than imported from `@/cms/modules/newsletter`.
 *
 * That module is `server-only`, and this file runs in the browser. Three string
 * literals are the cheaper duplication; the route's response is validated
 * against them below, so a drift shows up as an unrecognised status rather than
 * as a wrong message.
 */
export async function subscribeToNewsletter(
  email: string,
  source: string,
  locale?: string,
): Promise<NewsletterOutcome> {
  const res = await fetch('/api/newsletter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, source, locale }),
  });
  if (!res.ok) throw new Error(`Newsletter signup failed: ${res.status}`);

  /*
   * A 200 whose body cannot be read still means the address went in.
   *
   * Falling back to the plain signup is the safer of the two wrong answers:
   * showing an error for a signup that worked would have the visitor type it
   * again, while showing the ordinary thank-you for one that was actually a
   * repeat costs nothing.
   */
  const status = await res
    .json()
    .then((body: unknown) =>
      typeof body === 'object' && body !== null
        ? (body as { data?: { status?: unknown } }).data?.status
        : undefined,
    )
    .catch(() => undefined);

  return typeof status === 'string' && OUTCOMES.includes(status)
    ? (status as NewsletterOutcome)
    : 'subscribed';
}
