/**
 * The activity filter on the audit screen.
 *
 * ## Why grouping by action rather than by subject
 *
 * The screen's only filter used to be "Subject", whose options were the raw
 * `subject_type` values — `admin_user`, `seo_redirect`, `form_submission`. That
 * is both the wrong vocabulary and the wrong axis. Somebody opening this screen
 * is asking "show me the sign-ins", and the rows that answer it are spread
 * across several subject types (`email` for a failed login, `admin_user` for a
 * password reset) while `admin_user` simultaneously holds edits that have
 * nothing to do with signing in.
 *
 * Grouping by what HAPPENED puts the filter on the axis of the question.
 *
 * Prefix matching rather than an exhaustive list of actions: a new
 * `auth.something` is grouped correctly the day it ships. `audit-groups.test.ts`
 * reads every `logAudit` action out of the source and fails if any of them
 * falls outside every group — an ungrouped action is invisible to every filter,
 * which reads as "nothing happened" and is worse than having no filter at all.
 *
 * Plain data, no `server-only`: the page renders the options from the same
 * table the query filters with.
 */
export interface AuditActionGroup {
  key: string;
  label: string;
  /** Matched as `action.startsWith(prefix)`. Order matters — first match wins. */
  prefixes: string[];
}

/**
 * Order is the order of the dropdown, and the order of matching.
 *
 * `user.password.` sits in the sign-in group and therefore has to be tested
 * before the `user.` prefix in the accounts group — somebody asking to see
 * password resets is asking a security question, and finding them filed under
 * "changed a display name" is the confusion this exists to remove.
 */
export const AUDIT_ACTION_GROUPS: AuditActionGroup[] = [
  {
    key: 'signin',
    label: 'Sign-ins & security',
    prefixes: ['auth.', 'user.password.'],
  },
  {
    key: 'users',
    label: 'Users, roles & tokens',
    prefixes: ['user.', 'role.', 'api_token.'],
  },
  {
    key: 'content',
    label: 'Content & media',
    // `lock.` lives here rather than in a group of its own: taking a document
    // off somebody is a content event, and it is what the person who was pushed
    // out will come to this screen looking for.
    prefixes: ['document.', 'media.', 'submission.', 'pm.', 'lock.'],
  },
  {
    key: 'shop',
    label: 'Shop',
    prefixes: ['order.', 'review.', 'reviews.', 'abandoned_cart.', 'customer.', 'giftcard.', 'shipping.'],
  },
  {
    key: 'bookings',
    label: 'Bookings',
    prefixes: ['booking.'],
  },
  {
    key: 'site',
    label: 'Site configuration',
    prefixes: ['settings.', 'seo.', 'redirect.', 'cookies.', 'scripts.', 'secret.', 'cron.'],
  },
];

/** The group an action belongs to, or `null` when nothing claims it. */
export function auditActionGroup(action: string): string | null {
  for (const group of AUDIT_ACTION_GROUPS) {
    if (group.prefixes.some((p) => action.startsWith(p))) return group.key;
  }
  return null;
}

export interface AuditGroupFilter {
  include: string[];
  /** Prefixes claimed by an EARLIER group, which this one must not swallow. */
  exclude: string[];
}

/**
 * SQL `LIKE` patterns for one group.
 *
 * `exclude` exists because SQL has no notion of the "first match wins" ordering
 * `auditActionGroup` relies on. Filtering the users group as plain
 * `action LIKE 'user.%'` also returned `user.password.reset`, which the label
 * logic reports as a sign-in event — the screen and its own data disagreeing
 * about where a row belongs. Every group therefore excludes what the groups
 * above it already claimed.
 *
 * An unknown key yields nothing and filters nothing: a stale bookmark should
 * show the unfiltered log, not an empty table that looks like the audit trail
 * has been wiped.
 */
export function auditGroupFilter(key: string): AuditGroupFilter {
  const index = AUDIT_ACTION_GROUPS.findIndex((g) => g.key === key);
  if (index === -1) return { include: [], exclude: [] };

  const include = AUDIT_ACTION_GROUPS[index].prefixes.map((p) => `${p}%`);
  const exclude = AUDIT_ACTION_GROUPS.slice(0, index)
    .flatMap((g) => g.prefixes)
    // Only the earlier prefixes that could actually collide with one of ours;
    // the rest would be dead weight in the query.
    .filter((earlier) =>
      AUDIT_ACTION_GROUPS[index].prefixes.some(
        (own) => earlier.startsWith(own) || own.startsWith(earlier),
      ),
    )
    .map((p) => `${p}%`);

  return { include, exclude };
}

/**
 * Whether an action belongs to a group, by the same include/exclude rule the
 * SQL uses. Kept beside `auditActionGroup` so the two can be asserted equal.
 */
export function matchesAuditGroup(action: string, key: string): boolean {
  const { include, exclude } = auditGroupFilter(key);
  if (!include.length) return false;
  const like = (pattern: string) => action.startsWith(pattern.slice(0, -1));
  return include.some(like) && !exclude.some(like);
}
