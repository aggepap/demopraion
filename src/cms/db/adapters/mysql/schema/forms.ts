/**
 * Form submissions + newsletter subscribers. Ported from v1 `schema/forms.ts`.
 * The forms module writes here; `form_type` is a generic string in v2 (sites
 * define their own form kinds) rather than a fixed enum.
 */
import {
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/mysql-core';

export const formEmailStatusValues = ['pending', 'sent', 'failed', 'skipped'] as const;
export type FormEmailStatus = (typeof formEmailStatusValues)[number];

export const formStatusValues = ['new', 'handled', 'archived', 'spam'] as const;
export type FormStatus = (typeof formStatusValues)[number];

export const formSubmissions = mysqlTable(
  'form_submissions',
  {
    id: int('id').autoincrement().primaryKey(),
    /** Site-defined form kind (e.g. `contact`, `audit`, `question`). */
    formType: varchar('form_type', { length: 64 }).notNull(),
    email: varchar('email', { length: 255 }).notNull(),
    payload: json('payload').$type<Record<string, unknown>>().notNull(),
    sourcePageSlug: varchar('source_page_slug', { length: 191 }),
    sourceLocale: varchar('source_locale', { length: 8 }),
    referrerUrl: varchar('referrer_url', { length: 512 }),
    ipHash: varchar('ip_hash', { length: 64 }),
    ua: varchar('ua', { length: 255 }),
    emailStatus: mysqlEnum('email_status', formEmailStatusValues).notNull().default('pending'),
    emailError: text('email_error'),
    status: mysqlEnum('status', formStatusValues).notNull().default('new'),
    notes: text('notes'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (t) => ({
    typeCreatedIdx: index('idx_form_submissions_type_created').on(t.formType, t.createdAt),
    statusIdx: index('idx_form_submissions_status').on(t.status),
    emailIdx: index('idx_form_submissions_email').on(t.email),
  }),
);

export const newsletterSubscribers = mysqlTable(
  'newsletter_subscribers',
  {
    id: int('id').autoincrement().primaryKey(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    locale: varchar('locale', { length: 8 }).notNull().default('el'),
    consentText: text('consent_text').notNull(),
    consentGivenAt: timestamp('consent_given_at').notNull().defaultNow(),
    doubleOptInAt: timestamp('double_opt_in_at'),
    unsubscribedAt: timestamp('unsubscribed_at'),
    sourcePageSlug: varchar('source_page_slug', { length: 191 }),
    mailchimpId: varchar('mailchimp_id', { length: 64 }),
    mailchimpStatus: varchar('mailchimp_status', { length: 32 }),
    lastSyncedAt: timestamp('last_synced_at'),
    ipHash: varchar('ip_hash', { length: 64 }),
    ua: varchar('ua', { length: 255 }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (t) => ({
    createdIdx: index('idx_newsletter_created').on(t.createdAt),
  }),
);

export type FormSubmission = typeof formSubmissions.$inferSelect;
export type NewFormSubmission = typeof formSubmissions.$inferInsert;
export type NewsletterSubscriber = typeof newsletterSubscribers.$inferSelect;
export type NewNewsletterSubscriber = typeof newsletterSubscribers.$inferInsert;
