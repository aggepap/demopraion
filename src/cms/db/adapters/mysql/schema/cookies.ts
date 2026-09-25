/**
 * Cookie consent catalog — the categories + services declared in the cookie
 * policy / consent UI. Admin-managed so the declaration stays accurate without
 * a code change. `name`/`description`/`purpose` are per-locale JSON maps.
 */
import { boolean, index, int, json, mysqlTable, timestamp, varchar } from 'drizzle-orm/mysql-core';

export const cookieCategories = mysqlTable('cookie_categories', {
  id: int('id').autoincrement().primaryKey(),
  key: varchar('key', { length: 64 }).notNull().unique(),
  name: json('name').$type<Record<string, string>>().notNull(),
  description: json('description').$type<Record<string, string>>(),
  /** Strictly-necessary categories the user can't opt out of. */
  required: boolean('required').notNull().default(false),
  sortOrder: int('sort_order').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const cookieServices = mysqlTable('cookie_services', {
  id: int('id').autoincrement().primaryKey(),
  categoryId: int('category_id')
    .notNull()
    .references(() => cookieCategories.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 128 }).notNull(),
  provider: varchar('provider', { length: 128 }),
  purpose: json('purpose').$type<Record<string, string>>(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/**
 * What each visitor actually decided, and when.
 *
 * The decision used to live in one browser's `localStorage` and nowhere else
 * (F-065). That is enough to make the site behave correctly for that visitor, and
 * useless as a record: consent has to be demonstrable after the fact, and a value in
 * someone else's browser demonstrates nothing to anyone.
 *
 * No account, no email, no raw IP — a consent record is not an excuse to start
 * identifying people. What is kept is what a regulator would ask for: which
 * categories were accepted, the wording that was on screen, and when. `visitorRef`
 * is the random id the banner stores alongside the decision, so a later change of
 * mind can be tied to the earlier one without knowing who either belongs to.
 */
export const cookieConsents = mysqlTable(
  'cookie_consents',
  {
    id: int('id').autoincrement().primaryKey(),
    /** Random, browser-generated. Not derived from anything about the person. */
    visitorRef: varchar('visitor_ref', { length: 64 }).notNull(),
    /** `accepted` | `rejected` | `custom` — the shape of the choice. */
    decision: varchar('decision', { length: 16 }).notNull(),
    /** Category key → granted, for every non-required category on offer. */
    categories: json('categories').$type<Record<string, boolean>>().notNull(),
    /** The catalogue revision the visitor was actually shown. */
    policyVersion: varchar('policy_version', { length: 64 }),
    locale: varchar('locale', { length: 8 }),
    ua: varchar('ua', { length: 255 }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    visitorIdx: index('idx_cookie_consents_visitor').on(t.visitorRef),
    createdIdx: index('idx_cookie_consents_created').on(t.createdAt),
  }),
);

export type CookieCategory = typeof cookieCategories.$inferSelect;
export type NewCookieCategory = typeof cookieCategories.$inferInsert;
export type CookieService = typeof cookieServices.$inferSelect;
export type NewCookieService = typeof cookieServices.$inferInsert;

export type CookieConsent = typeof cookieConsents.$inferSelect;
export type NewCookieConsent = typeof cookieConsents.$inferInsert;
