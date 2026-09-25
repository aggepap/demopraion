/**
 * Human wording for audit actions.
 *
 * The log stored and displayed machine keys verbatim — `auth.login.fail`,
 * `cookies.service.upsert` — which is precisely the wrong audience: the audit
 * screen exists so a person can see who did what, and it was showing them
 * identifiers meant for code.
 *
 * Unknown keys fall back to a generic humanisation rather than an empty cell,
 * so a newly added action is readable the day it ships and only gets a bespoke
 * phrase when someone writes one.
 */
const ACTION_LABELS: Record<string, string> = {
  'auth.login.success': 'Signed in',
  'auth.login.fail': 'Failed sign-in attempt',
  'auth.login.locked': 'Sign-in blocked (too many attempts)',
  'auth.logout': 'Signed out',
  // Distinct from a deliberate sign-out: "was I signed out, or did I sign out?"
  // is exactly the question this log gets opened to settle.
  'auth.logout.idle': 'Signed out automatically (inactive)',

  'auth.2fa.challenged': 'Asked for a two-factor code',
  'auth.2fa.success': 'Passed two-factor',
  'auth.2fa.fail': 'Failed two-factor code',
  'auth.2fa.locked': 'Two-factor blocked (too many attempts)',
  'auth.2fa.enrolled': 'Set up two-factor authentication',
  'auth.2fa.enroll_required': 'Required to set up two-factor',
  'auth.2fa.disabled': 'Turned off two-factor authentication',
  'auth.2fa.recovery_used': 'Signed in with a recovery code',
  'auth.2fa.recovery_regenerated': 'Generated new recovery codes',
  'auth.2fa.admin_reset': "Reset another user's two-factor",
  'auth.2fa.bypass.success': 'Signed in with the recovery PIN',
  'auth.2fa.bypass.fail': 'Failed recovery PIN attempt',
  'auth.2fa.bypass.locked': 'Recovery PIN blocked (too many attempts)',

  'user.password.reset': "Reset a user's password",

  'document.create': 'Created content',
  'document.update': 'Edited content',
  'document.delete': 'Deleted content',
  'document.restore': 'Restored an earlier version',
  // Written by the scheduler, not a person: the status catching up with a
  // publish date that has passed.
  'document.publish_scheduled': 'Published a scheduled document',
  'lock.takeover': 'Took over editing from someone',

  'media.upload': 'Uploaded a file',
  'media.update': 'Changed a file’s alt text',
  'media.delete': 'Deleted a file',

  'user.create': 'Created a user',
  'user.update': 'Edited a user',
  'user.delete': 'Deleted a user',
  'role.create': 'Created a role',
  'role.update': 'Edited a role',
  'role.delete': 'Deleted a role',

  'settings.update': 'Changed settings',
  'secret.set': 'Saved an integration credential',
  'secret.clear': 'Removed an integration credential',
  'cron.run': 'Ran a scheduled job',
  'reviews.location': 'Changed a Google reviews location',
  'review.hide': 'Hid or showed a review',
  'giftcard.issue': 'Issued a gift card',
  'giftcard.status': 'Voided or restored a gift card',
  'giftcard.send': 'Emailed a gift card',
  'order.shipment': 'Created a shipment',
  'order.refund': 'Refunded a payment',
  'shipping.zone.save': 'Added a shipping zone',
  'shipping.zone.update': 'Edited a shipping zone',
  'shipping.zone.delete': 'Deleted a shipping zone',
  'shipping.method.create': 'Added a shipping method',
  'shipping.method.update': 'Edited a shipping method',
  'shipping.method.delete': 'Deleted a shipping method',
  'customer.export': 'A customer downloaded their data',
  'customer.delete': 'A customer deleted their account',
  'submission.update': 'Updated a form submission',

  'booking.create': 'Created a booking',
  'booking.update': 'Edited a booking',
  'booking.status': 'Changed a booking status',
  'booking.payment_link': 'Sent a payment link',
  'booking.payment': 'Recorded a payment',
  'booking.slot.update': 'Changed booking availability',

  'redirect.create': 'Added a redirect',
  'redirect.update': 'Edited a redirect',
  'redirect.delete': 'Deleted a redirect',
  'seo.404.update': 'Updated a 404 entry',
  'seo.404.delete': 'Deleted a 404 entry',
  'seo.meta.upsert': 'Saved an SEO override',
  'seo.meta.delete': 'Deleted an SEO override',

  'cookies.category.create': 'Added a cookie category',
  'cookies.category.update': 'Edited a cookie category',
  'cookies.category.delete': 'Deleted a cookie category',
  'cookies.service.create': 'Added a cookie service',
  'cookies.service.update': 'Edited a cookie service',
  'cookies.service.delete': 'Deleted a cookie service',

  'scripts.create': 'Added a script snippet',
  'scripts.update': 'Edited a script snippet',
  'scripts.delete': 'Deleted a script snippet',

  'order.create': 'Created an order',
  'order.edit': 'Edited an order',
  'order.status': 'Changed an order status',
  'review.status': 'Changed a review status',
  'review.delete': 'Deleted a review',
};

/** `some.new.action` → "Some new action". */
function humanize(action: string): string {
  const words = action.replace(/[._]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function auditActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? humanize(action);
}

/**
 * Human wording for what an action was done *to*.
 *
 * The Action column was translated and the Subject column beside it was not, so a row
 * read "Deleted a redirect · seo_redirect #688" — half plain English, half a table name.
 * The screen exists so someone can answer "who changed what" without knowing the schema,
 * and the half that names the thing was the half written in schema.
 *
 * `document` is deliberately generic: the row's action already says what kind of content
 * it was, and the subject type does not distinguish an article from an answer.
 */
const SUBJECT_LABELS: Record<string, string> = {
  admin_role: 'Role',
  admin_user: 'User',
  booking: 'Booking',
  booking_slot: 'Availability date',
  cron: 'Scheduled job',
  cookie_category: 'Cookie category',
  cookie_service: 'Cookie service',
  document: 'Content',
  email: 'Email address',
  form_submission: 'Form submission',
  media_file: 'File',
  order: 'Order',
  review: 'Review',
  customer: 'Customer',
  review_location: 'Google reviews location',
  gift_card: 'Gift card',
  secret: 'Integration credential',
  seo_meta: 'SEO override',
  seo_not_found: '404 entry',
  seo_redirect: 'Redirect',
  settings: 'Settings',
};

export function auditSubjectLabel(subjectType: string): string {
  return SUBJECT_LABELS[subjectType] ?? humanize(subjectType);
}
