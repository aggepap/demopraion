/**
 * How a permission key is said out loud.
 *
 * These labels lived inside the roles screen, which meant the server could not use them:
 * a refusal read "You cannot grant a permission you do not hold yourself:
 * cms.roles.manage" — a code key, to a person who has been choosing from a list that says
 * "Manage roles" the whole time. The vocabulary of the permission system belongs next to
 * the permissions, not inside one component that happens to render them.
 *
 * Safe to import from either side: no server-only dependencies.
 */

/** The wildcard. Held apart from the rest because it makes them irrelevant. */
export const FULL_ACCESS = '*';

/** Without this a role cannot open the admin at all — the shell requires it. */
export const ACCESS_PERMISSION = 'cms.access';

/** Areas in a fixed order, labelled for the person choosing rather than for the key. */
export const AREA_LABELS: Record<string, string> = {
  access: 'Access',
  content: 'Content',
  media: 'Media',
  seo: 'SEO',
  forms: 'Form submissions',
  settings: 'Settings & cookies',
  users: 'Users',
  roles: 'Roles',
  tokens: 'API tokens',
  audit: 'Audit log',
  scripts: 'Scripts',
  newsletter: 'Newsletter',
  'commerce.orders': 'Orders',
  'commerce.customers': 'Customer accounts',
  'commerce.reviews': 'Product reviews',
  'booking.reservations': 'Bookings',
  'booking.schedule': 'Booking availability',
};

export const VERB_LABELS: Record<string, string> = {
  read: 'View',
  write: 'Edit',
  publish: 'Publish',
  manage: 'Manage',
};

/** `cms.commerce.orders.read` → area `commerce.orders`, verb `read`. */
export function splitPermissionKey(key: string): { area: string; verb: string } {
  const parts = key.replace(/^cms\./, '').split('.');
  if (parts.length === 1) return { area: parts[0], verb: '' };
  return { area: parts.slice(0, -1).join('.'), verb: parts[parts.length - 1] };
}

export function permissionLabel(key: string): string {
  if (key === FULL_ACCESS) return 'Full access';
  const { area, verb } = splitPermissionKey(key);
  const areaLabel = AREA_LABELS[area] ?? area;
  if (!verb) return areaLabel;
  return `${VERB_LABELS[verb] ?? verb} ${areaLabel.toLowerCase()}`;
}

/**
 * What each permission unlocks, in the words of the screens it opens.
 *
 * Shown behind an "i" beside each box on the Roles screen. The label says the area
 * and the verb; it does not say that "Edit content" is useless without "View content",
 * that "View submissions" shows visitors' contact details, or that "Manage scripts"
 * means running code in every visitor's browser — which is what someone building a
 * role actually needs to know. Each sentence was checked against where the key is
 * enforced (the route guards and the admin pages that call `requirePerm`).
 */
const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  [FULL_ACCESS]:
    'Everything in the admin, including permissions added in later updates. Give it only to the people who run the site.',
  'cms.access':
    'Lets the person sign in and open the admin at all. Without it every screen refuses them, whatever else the role allows.',
  'cms.content.read':
    'Open the content lists and editors and preview drafts, without being able to save changes.',
  'cms.content.write':
    'Create and edit content, and import it in bulk. Needs View content to open the editor; making changes live needs Publish content.',
  'cms.content.publish':
    'Publish, unpublish and schedule content, which is what makes changes live on the site. Without it, edits wait as drafts.',
  'cms.media.read': 'Open the Media library and browse the uploaded files.',
  'cms.media.write': 'Upload files to the Media library, edit their details such as alt text, and delete them.',
  'cms.seo.read': 'Open the SEO screen: redirects, the 404 monitor and per-path meta overrides.',
  'cms.seo.write':
    'Add, change and delete redirects and per-path meta overrides, and tidy the 404 monitor. A wrong redirect affects every visitor to that address.',
  'cms.forms.read':
    'Open Submissions and read what visitors sent through the site’s forms, including their contact details.',
  'cms.forms.write': 'Change a submission’s status (new, handled, archived, spam) and write internal notes on it.',
  'cms.settings.read': 'Open Settings and Cookies and see how the site is configured.',
  'cms.settings.write':
    'Change site settings, cookie categories, shipping and stored service credentials. These apply to the whole live site.',
  'cms.users.manage':
    'Open Users: add, edit, disable and delete admin accounts, and reset their passwords and two-factor. Only accounts whose permissions the person holds themselves can be changed. Choosing an account’s role also needs Manage roles.',
  'cms.roles.manage':
    'Open Roles to create and change roles, and give roles to accounts. Nobody can grant a permission they do not hold themselves.',
  'cms.tokens.manage':
    'Connect and revoke Praion.ai keys in Settings, when that module is on. A connected key can rewrite published pages.',
  'cms.audit.read': 'Open the Audit log: who signed in, and who changed what and when.',
  'cms.scripts.manage':
    'Add and change script snippets: JavaScript that runs in every visitor’s browser. Give it only to people you would trust with the site’s code.',
  'cms.commerce.orders.read':
    'Open Orders, Gift cards and Abandoned carts, including customers’ names, addresses and what they bought.',
  'cms.commerce.orders.write':
    'Create, edit and refund orders and change their status, issue gift cards and delete abandoned carts.',
  'cms.commerce.customers.read': 'Open Customers: the shoppers who have an account on the site.',
  'cms.commerce.customers.write':
    'Disable or re-enable a customer account and re-send its confirmation email. Nobody in the admin can see or set a customer’s password.',
  'cms.commerce.reviews.read': 'Open Reviews: product reviews waiting for approval and those already shown.',
  'cms.commerce.reviews.write': 'Approve, reject and delete product reviews, and hide or show synced Google reviews.',
  'cms.newsletter.read': 'Open Newsletter: every subscriber’s address and the consent they gave.',
  'cms.newsletter.write': 'Unsubscribe and resubscribe people, and permanently delete a subscriber with their consent record.',
  'cms.booking.reservations.read': 'Open Reservations: booking requests and bookings, with the customers’ details.',
  'cms.booking.reservations.write':
    'Accept, decline and change reservations, send payment links and refund payments.',
  'cms.booking.schedule.read': 'Open Availability: the booking calendar with each date’s places and closed dates.',
  'cms.booking.schedule.write': 'Change how many places a date has, or close a date to bookings.',
};

/** Plain explanation of a permission, or '' for a key nobody has described. */
export function permissionDescription(key: string): string {
  return PERMISSION_DESCRIPTIONS[key] ?? '';
}
