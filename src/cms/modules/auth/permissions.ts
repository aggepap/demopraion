/**
 * Permission keys for the CMS admin.
 *
 * v2 fixes the v1 read/write split (BACKEND.md §13.3): every area that can be
 * read has a distinct `*.read` key that GET routes actually use, so a
 * read-only role genuinely works. Convention: `cms.<area>.<verb>`. Roles with
 * `*` are superadmin; a trailing `.*` is a prefix wildcard.
 */
export const PERMISSIONS = {
  access: 'cms.access',

  contentRead: 'cms.content.read',
  contentWrite: 'cms.content.write',
  /** Publish/unpublish/schedule — separable from ordinary edits. */
  contentPublish: 'cms.content.publish',

  mediaRead: 'cms.media.read',
  mediaWrite: 'cms.media.write',

  seoRead: 'cms.seo.read',
  seoWrite: 'cms.seo.write',

  formsRead: 'cms.forms.read',
  formsWrite: 'cms.forms.write',

  settingsRead: 'cms.settings.read',
  settingsWrite: 'cms.settings.write',

  usersManage: 'cms.users.manage',
  rolesManage: 'cms.roles.manage',

  /**
   * Import and revoke machine-to-machine API credentials (the PM bridge).
   *
   * Deliberately not folded into `usersManage`: accepting a credential that can
   * rewrite every published page is a different privilege from managing editors,
   * and collapsing the two would hide that from whoever assigns roles.
   */
  tokensManage: 'cms.tokens.manage',

  auditRead: 'cms.audit.read',

  /**
   * Script snippets — JavaScript that runs on the public site for every visitor.
   *
   * Its own key rather than `settingsWrite`: whoever holds it can run any code in
   * a visitor's browser, which is a larger privilege than changing a setting, and
   * whoever assigns roles should see that as a separate decision. Placing a
   * snippet's shortcode in a page needs only `contentWrite`.
   */
  scriptsManage: 'cms.scripts.manage',

  /** Commerce orders (gated by the commerce module too). */
  ordersRead: 'cms.commerce.orders.read',
  ordersWrite: 'cms.commerce.orders.write',

  /**
   * Shop customer accounts (gated by the `customers` module too).
   *
   * Its own pair rather than a reuse of `orders*`: an order is one purchase,
   * while this list is every shopper the site holds an account for. `write`
   * covers disabling an account and re-sending a confirmation email — it never
   * grants reading or setting a password, which nobody in the admin can do.
   */
  customersRead: 'cms.commerce.customers.read',
  customersWrite: 'cms.commerce.customers.write',

  /** Product review moderation (gated by the commerce module too). */
  reviewsRead: 'cms.commerce.reviews.read',
  reviewsWrite: 'cms.commerce.reviews.write',

  /**
   * Newsletter subscribers (gated by the newsletter module too).
   *
   * Its own pair rather than a reuse of `forms*`: a form submission is one
   * person's enquiry, while this list is every address the site holds and the
   * consent behind each. Who may read one is not automatically who may read
   * the other, and `newsletterWrite` also erases.
   */
  newsletterRead: 'cms.newsletter.read',
  newsletterWrite: 'cms.newsletter.write',

  /** Booking requests and reservations (gated by the booking module too). */
  reservationsRead: 'cms.booking.reservations.read',
  reservationsWrite: 'cms.booking.reservations.write',

  /** The availability calendar — per-date capacity and blackout dates. */
  scheduleRead: 'cms.booking.schedule.read',
  scheduleWrite: 'cms.booking.schedule.write',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/**
 * Wildcard-aware permission check.
 * - `*` grants everything.
 * - `cms.seo.*` grants any key under `cms.seo.`.
 * - `pm:*` grants any key under `pm:` — API-token scopes use `:`, not `.`.
 * - Exact keys grant only that key.
 *
 * The wildcard test is on a trailing `*` rather than a literal `.*` so the same
 * function serves both namespaces; the separator stays in the prefix either way,
 * which is what keeps `cms.seo.*` from matching `cms.seoextra`.
 */
export function hasPerm(granted: readonly string[], required: string): boolean {
  if (!granted || granted.length === 0) return false;
  for (const g of granted) {
    if (g === '*') return true;
    if (g === required) return true;
    if (g.length > 1 && g.endsWith('*')) {
      const prefix = g.slice(0, -1); // keeps the trailing separator
      if (required.startsWith(prefix)) return true;
    }
  }
  return false;
}

export function hasAnyPerm(granted: readonly string[], required: readonly string[]): boolean {
  return required.some((r) => hasPerm(granted, r));
}

/** The full permission list — handy for seeding a superadmin-equivalent role. */
export const ALL_PERMISSIONS: PermissionKey[] = Object.values(PERMISSIONS);
